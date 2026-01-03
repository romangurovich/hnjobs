import express from 'express';
import cors from 'cors';
import { Client } from '@temporalio/client';
import { nanoid } from 'nanoid';

const app = express();
app.use(express.json());

// For local development, allow requests from the admin UI
app.use(cors({ origin: 'http://localhost:5175' })); // Assuming admin UI runs on 5175

const temporalClient = new Client();

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
      return res.json({ threadId, posts: [] });
    }

    // Fetch the first 20 comments for preview
    const postIds = threadData.kids.slice(0, 20);
    const postPromises = postIds.map(async (id: number) => {
      const response = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      return response.json();
    });

    const posts = await Promise.all(postPromises);
    res.json({
      threadId,
      threadTitle: threadData.title,
      posts: posts.filter(p => p !== null && !p.deleted && !p.dead)
    });
  } catch (error) {
    console.error('Error fetching HN posts:', error);
    res.status(500).json({ error: 'Failed to fetch HN posts' });
  }
});

app.post('/trigger-workflow', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const workflowId = `job-${nanoid()}`;
    console.log(`Starting workflow ${workflowId} for URL: ${url}`);

    await temporalClient.workflow.start('crawlAndProcessJob', {
      taskQueue: 'hn-jobs',
      workflowId: workflowId,
      args: [url],
    });

    console.log(`Workflow started successfully! Workflow ID: ${workflowId}`);
    res.json({ workflowId });
  } catch (error) {
    console.error('Error starting workflow:', error);
    res.status(500).json({ error: 'Failed to start workflow' });
  }
});

const port = 8081; // Different port from the main API proxy
app.listen(port, () => {
  console.log(`Admin API server listening on http://localhost:${port}`);
});
