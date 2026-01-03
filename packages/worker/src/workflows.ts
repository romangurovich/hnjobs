import { proxyActivities } from '@temporalio/workflow';
// Only import types from the activities file!
import type * as activities from './activities';

const { scrapePage, processPageContent } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

/**
 * A workflow that scrapes a page and eventually processes its content.
 */
export async function crawlAndProcessJob(url: string): Promise<any> {
  const content = await scrapePage(url);
  
  const jobData = await processPageContent(content);

  // In the future, we'll add more steps here:
  // - Call an activity to save to the database

  return jobData;
}
