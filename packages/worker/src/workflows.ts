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
  source: 'LINK' | 'POST_CONTENT'
): Promise<any> {
  console.log(`[Post ${hnPostId}] Starting standalone enrichment. Source: ${source}`);
  const jobData = await processPageContent(content);
  return await persistJobData(jobData, content, hnPostId, source);
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

  const results: any[] = [];
  
  if (urls && urls.length > 0) {
    for (const url of urls) {
      try {
        // Step 2: Crawl the link
        const rawContent = await executeChild(crawlPageWorkflow, {
          args: [url, hnPostId],
          workflowId: `crawl-${hnPostId}-${url.slice(-10)}`,
        });

        // Step 3: Enrich and persist
        const result = await executeChild(enrichAndPersistWorkflow, {
          args: [rawContent, hnPostId, 'LINK'],
          workflowId: `enrich-${hnPostId}-${url.slice(-10)}`,
        });
        
        results.push(result);
      } catch (error: any) {
        console.warn(`[Post ${hnPostId}] Failed to process link ${url}: ${error.message}`);
      }
    }
  }

  // Fallback: If no links successfully processed, process post content directly
  if (results.length === 0) {
    const result = await executeChild(enrichAndPersistWorkflow, {
      args: [postText, hnPostId, 'POST_CONTENT'],
      workflowId: `enrich-fallback-${hnPostId}`,
    });
    results.push(result);
  }

  return results;
}
