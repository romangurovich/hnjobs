import { bundleWorkflowCode } from '@temporalio/worker';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

async function bundle() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  
  console.log('Bundling workflows...');
  const { code } = await bundleWorkflowCode({
    workflowsPath: require.resolve('./workflows'),
  });

  const distDir = join(__dirname, '../dist');
  await mkdir(distDir, { recursive: true });
  await writeFile(join(distDir, 'workflow-bundle.js'), code);
  console.log('Workflow bundle created at dist/workflow-bundle.js');
}

bundle().catch((err) => {
  console.error('Failed to bundle workflows:', err);
  process.exit(1);
});
