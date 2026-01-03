import { proxyActivities } from '@temporalio/workflow';
// Only import types from the activities file!
import type * as activities from './activities';

const { scrapePage, processPageContent, persistJobData, extractUrlsFromText } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

/**
 * A workflow that scrapes a single job page and persists the data.
 */
export async function scrapeAndPersistJob(url: string, hnPostId: string | null): Promise<any> {
  const rawContent = await scrapePage(url);
  const jobData = await processPageContent(rawContent);
  return await persistJobData(jobData, rawContent, hnPostId, 'LINK');
}

/**
 * A workflow that processes an HN post, finding all links or parsing content directly.
 */
export async function processHNPost(hnPostId: string, postText: string): Promise<any[]> {
  const urls = await extractUrlsFromText(postText);
  const results: any[] = [];
  
  if (urls && urls.length > 0) {
    console.log(`Found ${urls.length} potential job links. Processing each...`);
    
    for (const url of urls) {
      try {
        // Note: In a production app, we might want to start child workflows here
        // for better parallelism and error isolation.
        const result = await scrapeAndPersistJob(url, hnPostId);
        results.push(result);
      } catch (error: any) {
        console.warn(`Failed to process link ${url}: ${error.message}`);
      }
    }
  }

  if (results.length > 0) {
    return results;
  }

  // Fallback: Parse the post content directly
  console.log(`No valid job links processed. Parsing post content directly for ID: ${hnPostId}`);
  const jobData = await processPageContent(postText);
  const savedJob = await persistJobData(jobData, postText, hnPostId, 'POST_CONTENT');
  return [savedJob];
}
