import express from 'express';
import cors from 'cors';
import { Client } from '@temporalio/client';
import { nanoid } from 'nanoid';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@hnjobs/api/src/router';
import { settings } from './config';

const app = express();
app.use(express.json({ limit: '1mb' }));

// For local development, allow requests from the admin UI
app.use(cors({ origin: settings.adminUiOrigin }));

const temporalClient = new Client();

// Create tRPC client for making API calls
const apiClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${settings.apiBaseUrl}/trpc`,
    }),
  ],
});

async function fetchWithRetry(url: string, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

app.get('/hn/latest-posts', async (req, res) => {
  try {
    console.log('Fetching latest "Who is hiring" thread ID...');
    const searchResponse = await fetch(
      'http://hn.algolia.com/api/v1/search_by_date?query=Ask%20HN:%20Who%20is%20hiring?&tags=story&hitsPerPage=1'
    );
    const searchData = await searchResponse.json() as any;
    
    if (!searchData.hits || searchData.hits.length === 0) {
      return res.status(404).json({ error: 'No "Who is hiring" thread found.' });
    }

    const threadId = searchData.hits[0].objectID;
    console.log(`Found thread ID: ${threadId}`);

    const threadResponse = await fetch(`https://hacker-news.firebaseio.com/v0/item/${threadId}.json`);
    const threadData = await threadResponse.json() as any;

    if (!threadData.kids || threadData.kids.length === 0) {
      return res.json({
        threadId,
        threadTitle: threadData.title,
        posts: [],
        stats: { total: 0, processed: 0 }
      });
    }

    const allPostIds: number[] = threadData.kids;

    // 1. Check which posts are already processed
    const checkResult = await apiClient.job.checkExisting.query({
      hnPostIds: allPostIds.map(String),
    });
    
    // Ensure all IDs are strings for consistent comparison, filter out null/undefined
    const existingIds = new Set(
      (checkResult.existingIds || [])
        .filter((id: any) => id != null)
        .map((id: any) => String(id))
    );
 
    // 2. Fetch post details in batches
    const BATCH_SIZE = 20;
    const posts: any[] = [];

    for (let i = 0; i < allPostIds.length; i += BATCH_SIZE) {
      const batchIds = allPostIds.slice(i, i + BATCH_SIZE);
      const batchPromises = batchIds.map(async (id: number) => {
        try {
          return await fetchWithRetry(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        } catch (e) {
          console.error(`Failed to fetch post ${id}`, e);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      posts.push(...batchResults.filter((p: any) => p !== null && !p.deleted && !p.dead));

      // Small delay to be nice to HN API
      await new Promise(r => setTimeout(r, 100));
    }

    const processedPosts = posts.map(p => ({
      ...p,
      isProcessed: existingIds.has(String(p.id))
    }));

    res.json({
      threadId,
      threadTitle: threadData.title,
      posts: processedPosts,
      stats: {
        total: processedPosts.length,
        processed: processedPosts.filter(p => p.isProcessed).length
      }
    });
  } catch (error) {
    console.error('Error fetching HN posts:', error);
    res.status(500).json({ error: 'Failed to fetch HN posts' });
  }
});

app.post('/trigger-workflow', async (req, res) => {
  console.log('Received /trigger-workflow request:', { 
    url: req.body.url, 
    hnPostId: req.body.hnPostId, 
    postTextLength: req.body.postText?.length 
  });
  const { url, hnPostId, postText } = req.body;

  if (!url && (!hnPostId || !postText)) {
    return res.status(400).json({ error: 'Either URL or HN Post data is required' });
  }

  try {
    const workflowId = `job-${nanoid()}`;
    console.log(`Starting workflow ${workflowId}`);

    if (hnPostId && postText) {
      await temporalClient.workflow.start('processHNPost', {
        taskQueue: 'hn-jobs',
        workflowId: workflowId,
        args: [hnPostId.toString(), postText],
      });
    } else if (url) {
      await temporalClient.workflow.start('crawlPageWorkflow', {
        taskQueue: 'hn-jobs',
        workflowId: workflowId,
        args: [url, null], // Standalone crawl has no post ID
      });
    }

    console.log(`Workflow started successfully! Workflow ID: ${workflowId}`);
    res.json({ workflowId });
  } catch (error) {
    console.error('Error starting workflow:', error);
    res.status(500).json({ error: 'Failed to start workflow' });
  }
});

const port = settings.port; // Different port from the main API proxy
app.listen(port, () => {
  console.log(`Admin API server listening on http://localhost:${port}`);
});
