import { Worker } from '@temporalio/worker';
import * as activities from './activities';

async function run() {
  // Step 1: Create a worker instance
  const worker = await Worker.create({
    workflowsPath: require.resolve('./workflows'),
    activities,
    taskQueue: 'hn-jobs',
  });

  // Step 2: Start the worker
  console.log('Worker started and polling the "hn-jobs" queue...');
  await worker.run();
}

run().catch((err) => {
  console.error('Error running worker:', err);
  process.exit(1);
});
