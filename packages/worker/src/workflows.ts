import { proxyActivities, executeChild } from '@temporalio/workflow';
// Only import types from the activities file!
import type * as activities from './activities';

const { 
  scrapePage, 
  processPageContent, 
  persistJobData, 
  extractUrlsFromText,
  analyzePageType 
} = proxyActivities<typeof activities>({
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
 * STANDALONE WORKFLOW: Crawl, Analyze, and Process a potential job link.
 * Handles both single postings and list pages.
 */
export async function handlePotentialJobLinkWorkflow(url: string, hnPostId: string | null): Promise<any[]> {
  console.log(`[Post ${hnPostId}] Handling potential job link: ${url}`);
  
  // 1. Crawl the initial page
  const content = await executeChild(crawlPageWorkflow, {
    args: [url, hnPostId],
    workflowId: `crawl-initial-${hnPostId}-${url.slice(-10)}`,
  });

  // 2. Analyze the page type
  const analysis = await analyzePageType(content, url);

  if (analysis.is_job_list && analysis.job_links.length > 0) {
    console.log(`[Post ${hnPostId}] Identified as job list with ${analysis.job_links.length} links. Processing...`);
    
    // 3. It's a list! Process all sub-links in parallel
    const subPromises = analysis.job_links.map(async (subUrl, index) => {
      try {
        const uniqueId = `${hnPostId}-sub-${index}`;
        const subContent = await executeChild(crawlPageWorkflow, {
          args: [subUrl, hnPostId],
          workflowId: `crawl-${uniqueId}`,
        });

        return await executeChild(enrichAndPersistWorkflow, {
          args: [subContent, hnPostId, subUrl, 'LINK'],
          workflowId: `enrich-${uniqueId}`,
        });
      } catch (error: any) {
        console.warn(`[Post ${hnPostId}] Failed to process sub-link ${subUrl}: ${error.message}`);
        return null;
      }
    });

    const results = await Promise.all(subPromises);
    return results.filter(r => r !== null);
  }

  // 4. It's a single post, process it directly
  console.log(`[Post ${hnPostId}] Identified as single job posting.`);
  const result = await executeChild(enrichAndPersistWorkflow, {
    args: [content, hnPostId, url, 'LINK'],
    workflowId: `enrich-direct-${hnPostId}-${url.slice(-10)}`,
  });
  return [result];
}

/**
 * ORCHESTRATOR WORKFLOW: Processes an HN post.
 */
export async function processHNPost(hnPostId: string, postText: string): Promise<any[]> {
  // Step 1: Extract links from the HN post
  const urls = await executeChild(extractLinksWorkflow, {
    args: [postText, hnPostId],
    workflowId: `links-${hnPostId}`,
  });

  const results: any[] = [];
  
  if (urls && urls.length > 0) {
    console.log(`[Post ${hnPostId}] Found ${urls.length} potential job links. Processing each...`);
    
    // Step 2: Handle each link (which might be a list or a direct post)
    const processingPromises = urls.map(async (url) => {
      try {
        const subResults = await executeChild(handlePotentialJobLinkWorkflow, {
          args: [url, hnPostId],
          // Generate a unique ID for this potential job link handler
          workflowId: `handler-${hnPostId}-${url.slice(-10)}`,
        });
        return subResults;
      } catch (error: any) {
        console.warn(`[Post ${hnPostId}] handler failed for ${url}: ${error.message}`);
        return [];
      }
    });

    const allSubResults = await Promise.all(processingPromises);
    results.push(...allSubResults.flat());
  }

  // Fallback: If no jobs successfully processed from links, process post content directly
  if (results.length === 0) {
    console.log(`[Post ${hnPostId}] No links processed. Falling back to post content...`);
    const result = await executeChild(enrichAndPersistWorkflow, {
      args: [postText, hnPostId, null, 'POST_CONTENT'],
      workflowId: `enrich-fallback-${hnPostId}`,
    });
    results.push(result);
  }

  return results;
}