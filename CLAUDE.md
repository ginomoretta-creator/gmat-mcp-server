# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a GMAT Documentation MCP (Model Context Protocol) Server that provides semantic search capabilities over GMAT documentation. The server scrapes, parses, chunks, and embeds GMAT documentation content to enable AI assistants to access comprehensive GMAT information through vector search.

## Architecture

The project follows a modular architecture with the following phases:

### Phase 1: Setup and Dependencies
- TypeScript-based Node.js project using `@modelcontextprotocol/sdk` and `zod`
- Uses pnpm as package manager (version 10.10.0)
- Core dependencies for scraping (axios, cheerio), embeddings (openai), and vector search

### Phase 2: Data Ingestion Pipeline
- **Scraping**: `src/utils/scraper.ts` - Fetches HTML from GMAT documentation site
- **Parsing**: `src/utils/parser.ts` - Converts HTML to structured chunks using Cheerio, chunks by headings
- **Embedding**: `src/utils/embedder.ts` - Generates embeddings using OpenAI's text-embedding-3-small model
- **Caching**: `src/utils/cache.ts` - Persists embedded chunks to filesystem for performance

### Phase 3: MCP Server
- **Search Engine**: `src/utils/search.ts` - In-memory cosine similarity search over embeddings
- **Local Embedder**: `src/utils/localEmbedder.ts` - Query/corpus embeddings via transformers.js (all-MiniLM-L6-v2, 384d); no API key needed at runtime. `src/reembedLocal.ts` migrates an OpenAI-embedded corpus to local embeddings (`npm run reembed`).
- **GMAT Tools**: `src/utils/gmat.ts` - runGmat (async headless execution + outcome classification), getGmatIdioms, listGmatSamples, getGmatSample
- **Server**: `src/index.ts` - Main MCP server that loads cached data and handles protocol requests

## Common Commands

```bash
# Setup (install dependencies)
pnpm install

# Build TypeScript
pnpm run build  # Will need to add to package.json

# Development mode
pnpm run dev    # Will need to add to package.json

# One-time data ingestion (run before starting server)
pnpm run setup  # Will need to add to package.json

# Start MCP server
pnpm start      # Will need to add to package.json

# Tests
pnpm test       # Will need to add to package.json
```

## Environment Configuration

No API key is required at runtime (searchDocs uses local embeddings). Optional env vars:
```
CACHE_DIR=./data        # defaults to <repo>/data
GMAT_BIN=...            # GMAT bin dir, defaults to the local R2025a install
GMAT_SAMPLES=...        # NASA samples dir, defaults to <GMAT_BIN>/../samples
GMAT_IDIOMS=...         # idioms file, defaults to <repo>/data/gmat_idioms.md
OPENAI_API_KEY=...      # ONLY needed for the legacy scrape+embed pipeline (src/setup.ts)
```

## Data Flow

1. **Initial Setup**: `src/setup.ts` runs the ingestion pipeline once
   - Scrapes all pages from `pages.json` (list of name->href pairs)
   - Parses HTML and chunks by headings (h1, h2, h3)
   - Generates embeddings via OpenAI API
   - Caches results to `./data/` directory (or `CACHE_DIR` if set)

2. **Runtime**: `src/index.ts` loads cached embeddings and serves MCP tools
   - `searchDocs` tool: Semantic search returning full content sections with sources
   - Vector search uses cosine similarity over embeddings
   - Returns top-k results with relevance scores

## Key Implementation Details

- **Chunking Strategy**: Creates new chunks at each heading level, preserves document structure
- **Vector Search**: In-memory cosine similarity (suitable for ~150 pages, ~500-1000 chunks)  
- **Caching**: File-based persistence of embeddings to avoid re-processing
- **MCP Protocol**: Read-only server exposing semantic search capabilities
- **Error Handling**: Includes retry logic for scraping, rate limiting for embeddings

## Development Workflow

1. Run data ingestion once: `pnpm run setup`
2. Start development server: `pnpm run dev`
3. Test with Claude by connecting to MCP server endpoint
4. Re-run setup with `--force` flag when documentation updates

The server expects the cached embeddings to exist before starting. If cache is missing, it will instruct to run the setup script first.