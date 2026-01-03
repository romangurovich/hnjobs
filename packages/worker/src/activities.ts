import 'dotenv/config';
import { chromium } from 'playwright';
import { b } from './baml_client/baml_client';
import { apiClient } from './api_client';

/**
 * Robustly scrapes the text content of a web page using Playwright.
 */
export async function scrapePage(url: string): Promise<string> {
  console.log(`Scraping URL: ${url}`);
  
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    
    // 1. Wait for the initial DOM to be loaded
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });

    // 2. Try to wait for the network to settle, but don't let ads/tracking block us forever
    // We wait for 'networkidle' but cap it at 5 seconds.
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
      console.log('Network settled (networkidle reached).');
    } catch (e) {
      console.warn('Network did not settle within 5s (likely ads/tracking), proceeding with extraction.');
    }

    // 3. Extract the text content
    let content = await page.evaluate(() => {
      const toRemove = ['script', 'style', 'noscript', 'iframe', 'header', 'footer', 'nav'];
      toRemove.forEach(tag => {
        const elements = document.querySelectorAll(tag);
        elements.forEach(el => el.remove());
      });

      return document.body.innerText.trim();
    });

    // Fallback: if innerText is empty, try a broader extraction
    if (!content) {
      console.warn('innerText was empty, trying fallback extraction...');
      content = await page.textContent('body') ?? '';
      content = content.trim();
    }

    if (!content) {
      throw new Error('Failed to extract any text content from the page.');
    }

    console.log(`Successfully scraped ${content.length} characters from ${url}`);
    return content;
  } catch (error: any) {
    console.error(`Error scraping ${url}:`, error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

/**
 * Uses the BAML client to extract structured job data from raw text.
 */
export async function processPageContent(content: string) {
  console.log('Processing content with LLM...');
  try {
    const jobPosting = await b.ExtractJobPosting(content);
    console.log('Successfully extracted job data:', JSON.stringify(jobPosting, null, 2));
    return jobPosting;
  } catch (error: any) {
    console.error('Error processing content with LLM:', error.message);
    throw error;
  }
}

/**

 * Uses the BAML client to determine if a page is a job list and extract individual links.

 */

export async function analyzePageType(content: string, url: string) {

  console.log(`Analyzing page type for: ${url}`);

  try {

    const analysis = await b.AnalyzePageType(content, url);

    console.log(`Analysis for ${url}: is_job_list=${analysis.is_job_list}, found ${analysis.job_links.length} links`);

    return analysis;

  } catch (error: any) {

    console.error(`Error analyzing page type for ${url}:`, error.message);

    return { is_job_list: false, job_links: [] };

  }

}



/**

 * Uses the BAML client to extract potential job URLs from text.

 */



export async function extractUrlsFromText(text: string): Promise<string[]> {

  console.log('Extracting URLs from text...');

  try {

    const urls = await b.ExtractURLs(text);

    console.log(`Found ${urls.length} potential job URLs.`);

    return urls;

  } catch (error: any) {

    console.error('Error extracting URLs:', error.message);

    return [];

  }

}



/**



 * Persists the structured job data to the database via the API server.



 */



export async function persistJobData(jobData: any, rawContent: string, hnPostId: string | null, jobUrl: string | null, processedFrom: 'LINK' | 'POST_CONTENT') {



  console.log('Persisting job data to database...');



  try {



    const result = await apiClient.job.save.mutate({



      ...jobData,



      management_level: jobData.management_level ?? 0, // Default to IC



      raw_content: rawContent,



      hn_post_id: hnPostId,



      job_url: jobUrl,



      processed_from: processedFrom,



    });







    console.log(`Successfully persisted job with ID: ${result.id}`);

    return result;

  } catch (error: any) {

    console.error('Error persisting job data:', error.message);

    throw error;

  }

}
