import { Client } from '@temporalio/client';
import { nanoid } from 'nanoid';

async function run() {
  // Get URL from command line arguments
  const url = process.argv[2];
  if (!url) {
    console.error('Please provide a URL as a command-line argument.');
    process.exit(1);
  }

  console.log(`Connecting to Temporal...`);
  const client = new Client();

  const workflowId = `job-${nanoid()}`;

  console.log(`Starting workflow ${workflowId} for URL: ${url}`);

  await client.workflow.start('crawlAndProcessJob', {
    taskQueue: 'hn-jobs',
    workflowId: workflowId,
    args: [url],
  });

  console.log(`Workflow started successfully! Workflow ID: ${workflowId}`);
}

run().catch((err) => {
  console.error('Error starting workflow:', err);
  process.exit(1);
});
