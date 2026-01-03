import { proxyActivities } from '@temporalio/workflow';
// Only import types from the activities file!
import type * as activities from './activities';

const { scrapePage, processPageContent, persistJobData, extractUrlsFromText } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

/**
 * A workflow that processes an HN post, finding links or parsing content directly.
 */
export async function processHNPost(hnPostId: string, postText: string): Promise<any> {
  const urls = await extractUrlsFromText(postText);
  
  if (urls && urls.length > 0) {
    // We found links! Process the first one for now.
    const url = urls[0]!;
    console.log(`Processing job via link: ${url}`);
    
    try {
      const rawContent = await scrapePage(url);
      const jobData = await processPageContent(rawContent);
      return await persistJobData(jobData, rawContent, hnPostId, 'LINK');
    } catch (error) {
      console.warn(`Failed to process link ${url}, falling back to post content parsing.`);
      // Fallback to parsing post content if link scraping fails
    }
  }

  // No links found or link processing failed, parse the post content directly
  console.log(`Processing job via post content for ID: ${hnPostId}`);
  const jobData = await processPageContent(postText);
  return await persistJobData(jobData, postText, hnPostId, 'POST_CONTENT');
}
