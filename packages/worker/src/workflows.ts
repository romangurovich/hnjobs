import { proxyActivities } from '@temporalio/workflow';
// Only import types from the activities file!
import type * as activities from './activities';

const { scrapePage, processPageContent, persistJobData, extractUrlsFromText } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

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
        console.log(`Processing link: ${url}`);
        const rawContent = await scrapePage(url);
        const jobData = await processPageContent(rawContent);
        const savedJob = await persistJobData(jobData, rawContent, hnPostId, 'LINK');
        results.push(savedJob);
      } catch (error: any) {
        console.warn(`Failed to process link ${url}: ${error.message}`);
        // Continue to the next link
      }
    }
  }

  // If we processed some links successfully, return the results
  if (results.length > 0) {
    return results;
  }

  // Fallback: No valid job links found or all failed, parse the post content directly
  console.log(`No valid job links processed. Parsing post content directly for ID: ${hnPostId}`);
  try {
    const jobData = await processPageContent(postText);
    const savedJob = await persistJobData(jobData, postText, hnPostId, 'POST_CONTENT');
    return [savedJob];
  } catch (error: any) {
    console.error(`Failed to parse post content directly: ${error.message}`);
    throw error;
  }
}
