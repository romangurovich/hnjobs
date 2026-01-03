import express from 'express';
import cors from 'cors';
import { Client } from '@temporalio/client';
import { nanoid } from 'nanoid';

const app = express();
app.use(express.json());

// For local development, allow requests from the admin UI
app.use(cors({ origin: 'http://localhost:5175' })); // Assuming admin UI runs on 5175

const temporalClient = new Client();

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
