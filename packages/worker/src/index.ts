import { Worker } from '@temporalio/worker';
import * as activities from './activities';

async function run() {
  // Step 1: Create a worker instance
  const worker = await Worker.create({
    workflowsPath: require.resolve('./workflows'),
    activities,
    taskQueue: 'hn-jobs',
    // It's recommended to configure the connection options in production
    // but for local development, the defaults are usually sufficient.
  });

  // Step 2: Start the worker
  // This will start polling for tasks on the 'hn-jobs' task queue.
  await worker.run();
  console.log('Worker started');
}

run().catch((err) => {
  console.error('Error running worker:', err);
  process.exit(1);
});
