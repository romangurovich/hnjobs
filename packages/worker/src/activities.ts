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
    
    // Set a reasonable timeout and wait for the page to be somewhat idle
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });

    // Extract the text content of the body, stripping out scripts and styles
    const content = await page.evaluate(() => {
      // Remove elements that don't contain useful text content
      const toRemove = ['script', 'style', 'noscript', 'iframe', 'header', 'footer', 'nav'];
      toRemove.forEach(tag => {
        const elements = document.querySelectorAll(tag);
        elements.forEach(el => el.remove());
      });

      return document.body.innerText;
    });

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
 * Persists the structured job data to the database via the API server.
 */
export async function persistJobData(jobData: any, rawContent: string) {
  console.log('Persisting job data to database...');
  try {
    const result = await apiClient.job.save.mutate({
      ...jobData,
      raw_content: rawContent,
    });
    console.log(`Successfully persisted job with ID: ${result.id}`);
    return result;
  } catch (error: any) {
    console.error('Error persisting job data:', error.message);
    throw error;
  }
}