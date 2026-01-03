import { proxyActivities } from '@temporalio/workflow';
// Only import types from the activities file!
import type * as activities from './activities';

const { scrapePage, processPageContent, persistJobData } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

/**
 * A workflow that scrapes a page, parses its content, and saves it to the database.
 */
export async function crawlAndProcessJob(url: string): Promise<any> {
  const rawContent = await scrapePage(url);
  
  const jobData = await processPageContent(rawContent);

  const result = await persistJobData(jobData, rawContent);

  return result;
}
