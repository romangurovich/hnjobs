import { Worker } from '@temporalio/worker';
import * as activities from './activities';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

async function run() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const bundlePath = join(__dirname, '../dist/workflow-bundle.js');
  
  let workflowBundle;
  try {
    const code = await readFile(bundlePath, 'utf8');
    workflowBundle = { code };
    console.log('Loaded workflow bundle from dist/workflow-bundle.js');
  } catch (err) {
    console.error('Failed to load workflow bundle. Make sure to run "bun run bundle" first.');
    process.exit(1);
  }

  // Step 1: Create a worker instance
  const worker = await Worker.create({
    workflowBundle,
    activities,
    taskQueue: 'hn-jobs',
  });

  // Step 2: Start the worker
  await worker.run();
  console.log('Worker started');
}

run().catch((err) => {
  console.error('Error running worker:', err);
  process.exit(1);
});
