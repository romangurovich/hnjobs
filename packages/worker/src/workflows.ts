import { proxyActivities, executeChild } from '@temporalio/workflow';
// Only import types from the activities file!
import type * as activities from './activities';

const { scrapePage, processPageContent, persistJobData, extractUrlsFromText } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

/**
 * STANDALONE WORKFLOW: Crawl a page to get content.
 */
export async function crawlPageWorkflow(url: string, hnPostId: string | null): Promise<string> {
  console.log(`[Post ${hnPostId}] Starting standalone crawl for: ${url}`);
  return await scrapePage(url);
}

/**
 * STANDALONE WORKFLOW: Process a post and get links.
 */
export async function extractLinksWorkflow(postText: string, hnPostId: string): Promise<string[]> {
  console.log(`[Post ${hnPostId}] Starting standalone link extraction`);
  return await extractUrlsFromText(postText);
}

/**
 * STANDALONE WORKFLOW: Process content of any kind and persist enhanced job data.
 */
export async function enrichAndPersistWorkflow(
  content: string, 
  hnPostId: string | null, 
  jobUrl: string | null,
  source: 'LINK' | 'POST_CONTENT'
): Promise<any> {
  console.log(`[Post ${hnPostId}] Starting standalone enrichment. Source: ${source}`);
  const jobData = await processPageContent(content);
  return await persistJobData(jobData, content, hnPostId, jobUrl, source);
}

/**
 * ORCHESTRATOR WORKFLOW: Processes an HN post.
 */
export async function processHNPost(hnPostId: string, postText: string): Promise<any[]> {
  // Step 1: Extract links
  const urls = await executeChild(extractLinksWorkflow, {
    args: [postText, hnPostId],
    workflowId: `links-${hnPostId}`,
  });

  if (urls && urls.length > 0) {
    console.log(`[Post ${hnPostId}] Found ${urls.length} potential job links. Processing in parallel...`);
    
    // Step 2 & 3: Process all links in parallel
    const processingPromises = urls.map(async (url, index) => {
      try {
        const uniqueId = `${hnPostId}-${index}`;
        
        // Crawl the link
        const rawContent = await executeChild(crawlPageWorkflow, {
          args: [url, hnPostId],
          workflowId: `crawl-${uniqueId}`,
        });

        // Enrich and persist (passing the URL here!)
        return await executeChild(enrichAndPersistWorkflow, {
          args: [rawContent, hnPostId, url, 'LINK'],
          workflowId: `enrich-${uniqueId}`,
        });
      } catch (error: any) {
        console.warn(`[Post ${hnPostId}] Failed to process link ${url}: ${error.message}`);
        return null;
      }
    });

    const results = await Promise.all(processingPromises);
    const successfulResults = results.filter(r => r !== null);

    if (successfulResults.length > 0) {
      return successfulResults;
    }
  }

  // Fallback: If no links successfully processed, process post content directly
  console.log(`[Post ${hnPostId}] No links processed. Falling back to post content...`);
  const result = await executeChild(enrichAndPersistWorkflow, {
    args: [postText, hnPostId, null, 'POST_CONTENT'],
    workflowId: `enrich-fallback-${hnPostId}`,
  });
  return [result];
}
