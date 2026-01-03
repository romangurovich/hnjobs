import { proxyActivities, executeChild } from '@temporalio/workflow';
// Only import types from the activities file!
import type * as activities from './activities';

const { scrapePage, processPageContent, persistJobData, extractUrlsFromText } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

/**
 * STANDALONE WORKFLOW: Crawl a page to get content.
 */
export async function crawlPageWorkflow(url: string): Promise<string> {
  console.log(`Starting standalone crawl for: ${url}`);
  return await scrapePage(url);
}

/**
 * STANDALONE WORKFLOW: Parse text and persist as an enriched job.
 */
export async function enrichJobWorkflow(
  content: string, 
  hnPostId: string | null, 
  source: 'LINK' | 'POST_CONTENT'
): Promise<any> {
  console.log(`Starting standalone enrichment. Source: ${source}`);
  const jobData = await processPageContent(content);
  return await persistJobData(jobData, content, hnPostId, source);
}

/**
 * ORCHESTRATOR WORKFLOW: Processes an HN post.
 */
export async function processHNPost(hnPostId: string, postText: string): Promise<any[]> {
  const urls = await extractUrlsFromText(postText);
  const results: any[] = [];
  
  if (urls && urls.length > 0) {
    for (const url of urls) {
      try {
        // Step 1: Crawl the link (as a child workflow)
        const rawContent = await executeChild(crawlPageWorkflow, {
          args: [url],
          workflowId: `crawl-${hnPostId}-${url.slice(-10)}`,
        });

        // Step 2: Enrich and persist (as a child workflow)
        const result = await executeChild(enrichJobWorkflow, {
          args: [rawContent, hnPostId, 'LINK'],
          workflowId: `enrich-${hnPostId}-${url.slice(-10)}`,
        });
        
        results.push(result);
      } catch (error: any) {
        console.warn(`Failed to process link ${url}: ${error.message}`);
      }
    }
  }

  // Fallback: If no links, process post content directly
  if (results.length === 0) {
    const result = await executeChild(enrichJobWorkflow, {
      args: [postText, hnPostId, 'POST_CONTENT'],
      workflowId: `enrich-fallback-${hnPostId}`,
    });
    results.push(result);
  }

  return results;
}
