import axios from 'axios';
import { PAGES } from './pages.js';

export interface ScrapedPage {
  href: string;
  html: string;
}

const BASE_URL = process.env.BASE_URL || 'https://documentation.help/gmat/';

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function scrapePage(href: string, retries = 3): Promise<string> {
  const url = `${BASE_URL}${href}`;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Scraping ${href} (attempt ${attempt}/${retries})`);
      
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; GMAT-MCP-Server/1.0)',
        },
      });
      
      return response.data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error scraping ${href} (attempt ${attempt}/${retries}):`, errorMessage);
      
      if (attempt === retries) {
        throw new Error(`Failed to scrape ${href} after ${retries} attempts: ${errorMessage}`);
      }
      
      // Exponential backoff
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      await delay(delayMs);
    }
  }
  
  throw new Error(`Unreachable code reached in scrapePage for ${href}`);
}

export async function scrapeAll(): Promise<ScrapedPage[]> {
  const results: ScrapedPage[] = [];
  
  console.log(`Starting to scrape ${PAGES.length} pages...`);
  
  // Sequential scraping to be respectful to the server
  for (const page of PAGES) {
    try {
      const html = await scrapePage(page.href);
      results.push({
        href: page.href,
        html
      });
      
      // Small delay between requests
      await delay(500);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to scrape page ${page.name} (${page.href}):`, errorMessage);
      // Continue with other pages even if one fails
    }
  }
  
  console.log(`Successfully scraped ${results.length}/${PAGES.length} pages`);
  return results;
}