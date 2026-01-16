import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Client } from '@temporalio/client';
import { nanoid } from 'nanoid';
import { settings } from './config';

const app = express();
app.use(express.json({ limit: '1mb' }));

// For local development, allow requests from the admin UI
app.use(cors({ origin: settings.adminUiOrigin }));

// Auth middleware for protected routes
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7); // Remove 'Bearer ' prefix
  if (token !== settings.adminToken) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  next();
}

const temporalClient = new Client();

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
      'https://hn.algolia.com/api/v1/search_by_date?query=Ask%20HN%3A%20Who%20is%20hiring%3F&tags=story&hitsPerPage=5'
    );
    const searchData = await searchResponse.json() as any;
    
    if (!searchData.hits || searchData.hits.length === 0) {
      return res.status(404).json({ error: 'No "Who is hiring" thread found.' });
    }

    const hit = searchData.hits.find(
      (h: any) => typeof h.title === 'string' && /who is hiring\?/i.test(h.title)
    ) || searchData.hits[0];

    const threadId = hit.objectID;
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
    console.log(`Fetching details for ${allPostIds.length} posts...`);

    // 1. Check which posts are already processed
    const input = JSON.stringify({ hnPostIds: allPostIds.map(String) });
    const checkResponse = await fetch(`${settings.apiUrl}/trpc/job.checkExisting?input=${encodeURIComponent(input)}`);

    const checkResult = await checkResponse.json() as any;
    // tRPC response format: { result: { data: { existingIds: [...] } } }
    const existingIds = new Set(checkResult.result?.data?.existingIds || []);

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

app.post('/trigger-workflow', requireAuth, async (req, res) => {
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
        workflowExecutionTimeout: '30 minutes',
        workflowRunTimeout: '30 minutes',
      });
    } else if (url) {
      await temporalClient.workflow.start('crawlPageWorkflow', {
        taskQueue: 'hn-jobs',
        workflowId: workflowId,
        args: [url, null], // Standalone crawl has no post ID
        workflowExecutionTimeout: '30 minutes',
        workflowRunTimeout: '30 minutes',
      });
    }

    console.log(`Workflow started successfully! Workflow ID: ${workflowId}`);
    res.json({ workflowId });
  } catch (error) {
    console.error('Error starting workflow:', error);
    res.status(500).json({ error: 'Failed to start workflow' });
  }
});

app.post('/process-all-unprocessed', requireAuth, async (req, res) => {
  console.log('Received /process-all-unprocessed request');

  try {
    // 1. Fetch the latest "Who is hiring" thread
    const searchResponse = await fetch(
      'https://hn.algolia.com/api/v1/search_by_date?query=Ask%20HN%3A%20Who%20is%20hiring%3F&tags=story&hitsPerPage=5'
    );
    const searchData = await searchResponse.json() as any;

    if (!searchData.hits || searchData.hits.length === 0) {
      return res.status(404).json({ error: 'No "Who is hiring" thread found.' });
    }

    const hit = searchData.hits.find(
      (h: any) => typeof h.title === 'string' && /who is hiring\?/i.test(h.title)
    ) || searchData.hits[0];

    const threadId = hit.objectID;
    console.log(`Found thread ID: ${threadId}`);

    // 2. Get all post IDs from the thread
    const threadResponse = await fetch(`https://hacker-news.firebaseio.com/v0/item/${threadId}.json`);
    const threadData = await threadResponse.json() as any;

    if (!threadData.kids || threadData.kids.length === 0) {
      return res.json({ processed: 0, message: 'No posts found in thread' });
    }

    const allPostIds: number[] = threadData.kids;

    // 3. Check which posts are already processed
    const input = JSON.stringify({ hnPostIds: allPostIds.map(String) });
    const checkResponse = await fetch(`${settings.apiUrl}/trpc/job.checkExisting?input=${encodeURIComponent(input)}`);
    const checkResult = await checkResponse.json() as any;
    const existingIds = new Set(checkResult.result?.data?.existingIds || []);

    // 4. Get unprocessed post IDs
    const unprocessedIds = allPostIds.filter(id => !existingIds.has(String(id)));
    console.log(`Found ${unprocessedIds.length} unprocessed posts out of ${allPostIds.length} total`);

    if (unprocessedIds.length === 0) {
      return res.json({ processed: 0, message: 'All posts are already processed!' });
    }

    // 5. Fetch details and trigger workflows for unprocessed posts (in batches)
    const BATCH_SIZE = 20;
    const startedWorkflows: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < unprocessedIds.length; i += BATCH_SIZE) {
      const batchIds = unprocessedIds.slice(i, i + BATCH_SIZE);
      
      // Fetch post details
      const batchPromises = batchIds.map(async (id: number) => {
        try {
          return await fetchWithRetry(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        } catch (e) {
          console.error(`Failed to fetch post ${id}`, e);
          return null;
        }
      });

      const posts = (await Promise.all(batchPromises)).filter(
        (p: any) => p !== null && !p.deleted && !p.dead && p.text
      );

      // Trigger workflows for each post
      for (const p of posts) {
        const post = p as { id: number; text: string };
        try {
          const workflowId = `job-batch-${nanoid()}`;
          
          // Strip HTML from post text
          const plainText = post.text
            .replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_: string, href: string, content: string) => `${content} (${href})`)
            .replace(/<p>/gi, '\n\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]*>?/gm, '')
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&#x27;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');

          await temporalClient.workflow.start('processHNPost', {
            taskQueue: 'hn-jobs',
            workflowId: workflowId,
            args: [post.id.toString(), plainText],
            workflowExecutionTimeout: '30 minutes',
            workflowRunTimeout: '30 minutes',
          });

          startedWorkflows.push(workflowId);
          console.log(`Started workflow ${workflowId} for post ${post.id}`);
        } catch (error: any) {
          console.error(`Failed to start workflow for post ${post.id}:`, error.message);
          errors.push(`Post ${post.id}: ${error.message}`);
        }
      }

      // Small delay between batches to avoid overwhelming Temporal
      if (i + BATCH_SIZE < unprocessedIds.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(`Successfully started ${startedWorkflows.length} workflows`);
    res.json({
      processed: startedWorkflows.length,
      total: unprocessedIds.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Started processing ${startedWorkflows.length} posts`
    });
  } catch (error: any) {
    console.error('Error processing all posts:', error);
    res.status(500).json({ error: error.message || 'Failed to process posts' });
  }
});

app.post('/clear-all-jobs', requireAuth, async (req, res) => {
  console.log('Received /clear-all-jobs request');

  try {
    const response = await fetch(`${settings.apiUrl}/trpc/job.clearAll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const responseText = await response.text();
    
    // Check if response is HTML (error page) instead of JSON
    if (responseText.startsWith('<!DOCTYPE') || responseText.startsWith('<html')) {
      console.error('API returned HTML instead of JSON:', responseText.substring(0, 200));
      throw new Error('API returned an error page. Make sure the API server is running.');
    }

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse API response:', responseText.substring(0, 200));
      throw new Error('Invalid response from API');
    }

    if (!response.ok) {
      console.error('Failed to clear jobs:', result);
      throw new Error(result.error?.message || 'Failed to clear jobs from database');
    }

    console.log('All jobs cleared successfully');
    res.json({ success: true, result: result.result?.data });
  } catch (error: any) {
    console.error('Error clearing jobs:', error);
    res.status(500).json({ error: error.message || 'Failed to clear jobs' });
  }
});

const port = 8081; // Different port from the main API proxy
app.listen(port, () => {
  console.log(`Admin API server listening on http://localhost:${port}`);
});
