#!/usr/bin/env node

// Simple wrapper script to load environment variables and start MCP server
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables from .env.local if present (optional - the server
// uses local embeddings and needs no API key).
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env.local') });

// Set default values for optional env vars
process.env.CACHE_DIR = process.env.CACHE_DIR || join(__dirname, 'data');

// Import and run the MCP server directly
import('./dist/index.js').catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});