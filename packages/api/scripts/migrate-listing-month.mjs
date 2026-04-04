#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, '..');
const wranglerConfigPath = path.join(apiDir, 'wrangler.toml');

const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: bun run scripts/migrate-listing-month.mjs [--local|--remote]

Safely adds the jobs.listing_month column when missing, creates its index,
and backfills existing rows from jobs.created_at.

Examples:
  bun run scripts/migrate-listing-month.mjs --local
  bun run scripts/migrate-listing-month.mjs --remote
`);
  process.exit(0);
}

const targetFlag = args.has('--remote') ? '--remote' : '--local';

const wranglerConfig = readFileSync(wranglerConfigPath, 'utf8');
const databaseNameMatch = wranglerConfig.match(/database_name\s*=\s*"([^"]+)"/);

if (!databaseNameMatch?.[1]) {
  throw new Error(`Could not find database_name in ${wranglerConfigPath}`);
}

const databaseName = databaseNameMatch[1];

function runD1(sql, options = {}) {
  const { quiet = false } = options;

  if (!quiet) {
    console.log(`\n> ${sql}`);
  }

  let result = '';

  try {
    result = execFileSync(
      'bunx',
      ['wrangler', 'd1', 'execute', databaseName, targetFlag, '--command', sql],
      {
        cwd: apiDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr ?? '') : '';
    const stdout = error instanceof Error && 'stdout' in error ? String(error.stdout ?? '') : '';
    const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
    throw new Error(details || `Failed to run D1 command: ${sql}`);
  }

  if (!quiet && result.trim()) {
    console.log(result.trim());
  }

  return result;
}

console.log(`Running listing_month migration against ${databaseName} (${targetFlag === '--remote' ? 'remote' : 'local'})`);

const tableInfo = runD1('PRAGMA table_info(jobs);', { quiet: true });
const hasListingMonthColumn = /\blisting_month\b/.test(tableInfo);

if (!hasListingMonthColumn) {
  runD1('ALTER TABLE jobs ADD COLUMN listing_month TEXT;');
} else {
  console.log('\n> Column jobs.listing_month already exists, skipping ALTER TABLE');
}

runD1('CREATE INDEX IF NOT EXISTS idx_jobs_listing_month ON jobs(listing_month);');
runD1(`
  UPDATE jobs
  SET listing_month = substr(created_at, 1, 7)
  WHERE listing_month IS NULL
    AND created_at IS NOT NULL;
`);
runD1(`
  SELECT
    COUNT(*) AS total_jobs,
    SUM(CASE WHEN listing_month IS NOT NULL THEN 1 ELSE 0 END) AS jobs_with_listing_month,
    SUM(CASE WHEN listing_month IS NULL THEN 1 ELSE 0 END) AS jobs_missing_listing_month
  FROM jobs;
`);

console.log('\nlisting_month migration complete.');
