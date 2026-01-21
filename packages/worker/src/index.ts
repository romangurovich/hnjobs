import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';
import { settings } from './config';

async function run() {
  // Step 1: Connect to Temporal server
  console.log(`Connecting to Temporal at ${settings.temporalAddress}...`);
  const connection = await NativeConnection.connect({
    address: settings.temporalAddress,
  });

  // Step 2: Create a worker instance
  const worker = await Worker.create({
    connection,
    namespace: settings.temporalNamespace,
    workflowsPath: require.resolve('./workflows'),
    activities,
    taskQueue: 'hn-jobs',
  });

  // Step 3: Start the worker
  console.log(`Worker started and polling the "hn-jobs" queue in namespace "${settings.temporalNamespace}"...`);
  await worker.run();
}

run().catch((err) => {
  console.error('Error running worker:', err);
  process.exit(1);
});
