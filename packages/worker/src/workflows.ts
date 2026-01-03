import { proxyActivities } from '@temporalio/workflow';
// Only import types from the activities file!
import type * as activities from './activities';

const { scrapePage } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

/**
 * A workflow that scrapes a page and eventually processes its content.
 */
export async function crawlAndProcessJob(url: string): Promise<string> {
  const content = await scrapePage(url);
  
  // In the future, we'll add more steps here:
  // - Call an activity to parse with an LLM
  // - Call an activity to save to the database

  return `Processed content for ${url}: ${content.substring(0, 100)}...`;
}
