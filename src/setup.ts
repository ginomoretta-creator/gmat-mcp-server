import dotenv from 'dotenv';
import { scrapeAll } from './utils/scraper.js';
import { parseAndChunk } from './utils/parser.js';
import { generateEmbeddings } from './utils/embedder.js';
import { saveCache, loadCache, clearCache, getCacheInfo } from './utils/cache.js';

// Load environment variables
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

async function main() {
  const args = process.argv.slice(2);
  const forceRefresh = args.includes('--force');
  
  console.log('=== GMAT Documentation MCP Server Setup ===\n');
  
  // Check cache status
  const cacheInfo = getCacheInfo();
  console.log(`Cache status: ${cacheInfo.exists ? 'EXISTS' : 'NOT FOUND'}`);
  if (cacheInfo.exists) {
    console.log(`Cache location: ${cacheInfo.path}`);
    if (cacheInfo.size) console.log(`Cache size: ${cacheInfo.size}`);
    if (cacheInfo.timestamp) console.log(`Cache timestamp: ${cacheInfo.timestamp}`);
  }
  
  // Check if we should skip setup
  if (cacheInfo.exists && !forceRefresh) {
    console.log('\nCache already exists. Use --force to regenerate.');
    
    // Verify cache can be loaded
    const existingChunks = loadCache();
    if (existingChunks) {
      console.log(`✓ Cache is valid with ${existingChunks.length} chunks`);
      console.log('Setup complete - server can start using existing cache.');
      return;
    } else {
      console.log('⚠ Cache file exists but is invalid, proceeding with regeneration...');
    }
  }
  
  if (forceRefresh && cacheInfo.exists) {
    console.log('\n--force flag detected, clearing existing cache...');
    clearCache();
  }
  
  // Validate environment
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('❌ Error: OPENAI_API_KEY environment variable is required');
    console.error('Please set your OpenAI API key in the .env file');
    process.exit(1);
  }
  
  console.log('✓ Environment variables validated');
  
  try {
    // Step 1: Scraping
    console.log('\n--- Step 1: Scraping Pages ---');
    const scrapedPages = await scrapeAll();
    
    if (scrapedPages.length === 0) {
      console.error('❌ No pages were successfully scraped');
      process.exit(1);
    }
    
    console.log(`✓ Successfully scraped ${scrapedPages.length} pages`);
    
    // Step 2: Parsing and Chunking
    console.log('\n--- Step 2: Parsing and Chunking ---');
    let allChunks = [];
    
    for (const page of scrapedPages) {
      const chunks = parseAndChunk(page.html, page.href);
      allChunks.push(...chunks);
      console.log(`Processed ${page.href}: ${chunks.length} chunks`);
    }
    
    console.log(`✓ Total chunks created: ${allChunks.length}`);
    
    if (allChunks.length === 0) {
      console.error('❌ No chunks were created from the scraped pages');
      process.exit(1);
    }
    
    // Step 3: Generate Embeddings
    console.log('\n--- Step 3: Generating Embeddings ---');
    const embeddedChunks = await generateEmbeddings(allChunks, apiKey);
    
    // Step 4: Save to Cache
    console.log('\n--- Step 4: Saving to Cache ---');
    await saveCache(embeddedChunks);
    
    console.log('\n=== Setup Complete ===');
    console.log(`✓ Processed ${scrapedPages.length} pages`);
    console.log(`✓ Created ${allChunks.length} content chunks`);
    console.log(`✓ Generated ${embeddedChunks.length} embeddings`);
    console.log('✓ Cache saved successfully');
    console.log('\nThe server is now ready to start. Run: pnpm start');
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('\n❌ Setup failed:', errorMessage);
    console.error('\nPlease check the error above and try again.');
    if (errorStack) {
      console.error('\nStack trace:');
      console.error(errorStack);
    }
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Run the setup
main().catch(console.error);