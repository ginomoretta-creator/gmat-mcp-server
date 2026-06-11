# GMAT MCP Server

An MCP (Model Context Protocol) server that turns [NASA's GMAT](https://gmat.atlassian.net/wiki/spaces/GW/overview) (General Mission Analysis Tool) into a tool an AI agent can actually *use* — not just talk about. Any MCP client (Claude Code, Claude Desktop, Cursor, custom apps) gets:

- **`runGmat` — the validation loop.** Runs a GMAT mission script headless via `GmatConsole` and returns a classified outcome (`completed | parse | convergence | run`) with extracted errors and report-file contents. The agent writes a script, runs it, reads what broke, and fixes it — the same loop a mission designer uses.
- **`getGmatIdioms` — curated knowledge.** A hand-built knowledge base of GMAT gotchas discovered through that loop (cumulative `ElapsedSecs`, no parentheses in conditionals, `Propagate Synchronized` for two-spacecraft burns, …), so the agent stops making the classic mistakes.
- **`listGmatSamples` / `getGmatSample` — known-good templates.** The NASA sample-script corpus as a retrieval source for vetted mission patterns, plus an optional local corpus of community scripts (harvested from public repos, kept only if they pass a headless `runGmat` validation; listed with a `community/` prefix). The harvested corpus stays local — it is gitignored because licenses vary.
- **`searchDocs` — semantic search over the GMAT documentation**, embedded locally and cached in `data/embeddings.json`.

Example of what this enables: asked for a two-burn phasing rendezvous (700 km circular orbit, 30° separation), the agent derived the textbook solution, verified it exactly under two-body dynamics, *discovered it misses by 47 km under J2 gravity* by actually running it, and re-targeted the burns with GMAT's differential corrector to converge at 2.96 km — autonomously, in a handful of tool calls.

## Requirements
- Node.js 18+ (ESM)
- pnpm (project uses `pnpm@10` per `package.json`)
- A local [GMAT install](https://sourceforge.net/projects/gmat/) (R2025a tested) — for the `runGmat` and sample tools
- An OpenAI API key — only if you want to *rebuild* the docs-search cache from scratch; the repo ships a prebuilt `data/embeddings.json` and queries are embedded with a local model

## Quick Start
1) Clone the repo
```bash
git clone https://github.com/ginomoretta-creator/gmat-mcp-server.git
cd gmat-mcp-server
```

2) Install dependencies
```bash
pnpm install
```

3) Configure environment
Create a `.env.local` at the repo root pointing at your GMAT install:
```bash
echo "GMAT_BIN=C:\Path\To\GMAT_R2025a\bin" > .env.local
```
See `.env.example` for all variables. The server loads `.env.local` / `.env` from the repo root automatically, so it works even when an MCP client spawns it with an empty environment.

4) Build the project
```bash
pnpm build
```

5) (Optional) Rebuild the docs cache from the live docs — requires `OPENAI_API_KEY` in `.env.local`; skip this to use the prebuilt cache
```bash
pnpm run setup
```

6) Start the MCP server
```bash
pnpm start
```
The server runs over stdio and exposes the `searchDocs` tool to your MCP client.

## Scripts
- **pnpm build**: compile TypeScript to `dist/`
- **pnpm start**: run server from `dist/index.js` (loads `.env.local`)
- **pnpm dev**: run server in watch mode with `ts-node`
- **pnpm run setup**: build cache from live docs (requires OpenAI API key)
- **pnpm run setup:test**: build a smaller test cache using `pages-test.json`

Pass `--force` to `setup` to rebuild the cache from scratch:
```bash
pnpm run setup -- --force
```

## Environment Variables
- **GMAT_BIN** (required for `runGmat`/samples): GMAT `bin` folder containing `GmatConsole(.exe)`
- **GMAT_SAMPLES** (optional): samples dir (default: `<GMAT_BIN>\..\samples`)
- **GMAT_IDIOMS** (optional): idioms file (default: `./data/gmat_idioms.md`)
- **OPENAI_API_KEY** (setup only): used to rebuild the docs-embedding cache
- **CACHE_DIR** (optional): directory for `embeddings.json` (default: `./data`)
- **BASE_URL** (optional): docs base URL (default: `https://documentation.help/gmat/`)
- **NODE_ENV** (optional): set to `test` to use `pages-test.json` during setup
- **MCP_PORT** (optional): for wrappers/adapters that expose this stdio server via TCP/SSE. This server itself communicates over stdio and does not bind to a port; some clients or adapters may read `MCP_PORT` to decide which port to listen on.

Files read for env values:
- Setup reads both `.env` and `.env.local`
- Runtime reads `.env.local` (via `pnpm start`) or your shell env

## Using with MCP Clients

### Claude Code
```bash
claude mcp add gmat -- node C:\path\to\gmat-docs-mcp-server\dist\index.js
```
(`.env.local` at the repo root is picked up automatically.)

### Other stdio clients
This server communicates via stdio. Point your MCP client to execute the server in your project directory. Two common approaches:

### Option A: Use the start script
```bash
pnpm start
```
Your MCP client should spawn this command in the repo root (ensures `.env.local` is picked up).

### Option B: Use the wrapper
There is a convenience wrapper that ensures env loading, then starts the compiled server:
```bash
node start-mcp.js
```

Note: If you run the server behind an adapter that serves MCP over SSE/TCP, you can set `MCP_PORT` to guide that adapter. The server code here still talks over stdio.

### Tool: searchDocs
Inputs:
- `query` (string, required)
- `topK` (number, default 10, 1–50)
- `minScore` (number, default 0.1, 0–1)

Output: formatted text with page name, source URL, similarity score, and extracted content.

### GMAT copilot tools (execution + knowledge)
Beyond doc search, the server exposes the GMAT *validation loop* and curated knowledge so an
MCP client (Claude) can write → run → diagnose → fix GMAT missions autonomously:

- **`runGmat`** — runs a GMAT `.script` (passed as text) headless via `GmatConsole.exe` and
  returns `{ ok, stage, errors, reports, raw_tail }`. `stage` ∈ `completed | parse | convergence | run`.
  Inputs: `script` (string, required), `timeoutSec` (number, default 600 — raise for multi-day
  low-thrust propagations). This is the closed validation loop.
- **`getGmatIdioms`** — returns the curated GMAT idioms/gotchas knowledge base
  (`data/gmat_idioms.md`). Read it before generating scripts to avoid common pitfalls.
- **`listGmatSamples`** — lists the bundled NASA sample `.script` names plus any validated
  community scripts (prefixed `community/`) — a retrieval corpus of known-good patterns.
- **`getGmatSample`** — returns one sample's full text by name, to seed a phase from a vetted template.

These require a local GMAT install; see `GMAT_BIN` / `GMAT_SAMPLES` / `GMAT_EXTRA_SAMPLES` /
`GMAT_IDIOMS` in `.env.example` (defaults match a standard GMAT R2025a install).

### Extending the corpus (harvest pipeline)
The retrieval corpus is extensible. `scripts/harvest-corpus.mjs` turns a manifest of public-repo
pointers into a *validated* local corpus, using the same `runGmat` the MCP uses as the gate:

```bash
node scripts/harvest-corpus.mjs --manifest data/community-scripts/manifest.example.json --validate
```

Pipeline: **download** each script → **scan** (reject Python/MATLAB interface calls) →
**normalize** (rewrite hardcoded absolute `ReportFile` paths — the #1 portability killer) →
**validate** headless (keep only scripts that reach stage `completed`) → **index** each
survivor by detected technique into `data/community-scripts/INDEX.md`.

Without `--validate` it downloads, scans and normalizes only — nothing is executed.
`--validate` runs untrusted scripts through GmatConsole, so vet the manifest and prefer a
sandbox. The harvested scripts stay local (gitignored — licenses vary); only the pipeline and
the example manifest of public-repo pointers are committed, so the corpus is reproducible
without redistributing anyone's code.

## Skills
The `skills/` directory holds [Claude skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview)
that teach an agent *how* to drive these tools — the procedural layer on top of the MCP's tools:

- **`gmat-mission-design`** — the design-and-verify workflow: read the idioms first, seed from a
  sample, write analytic expectations as the acceptance test, run, triage failures by `stage`,
  and never cite a number that didn't come from a GMAT report. Benchmarked against a no-skill
  baseline across three mission scenarios (Hohmann→GEO, electric orbit-raise, drag decay): 100%
  vs 92% assertion pass rate, with far lower run-to-run variance.
- **`gmat-improve`** — a run→diagnose→fix loop for *existing* scripts: baseline run as a
  regression test, diagnosis against the failure catalog (hardcoded paths, non-ASCII, magic-number
  burns, degenerate stop conditions), one re-run per change, before/after delivery.

Point your skill-aware client at the `skills/` directory to load them.

## Data and Cache
- Cache file: `data/embeddings.json` (or `${CACHE_DIR}/embeddings.json`)
- To rebuild: `pnpm run setup -- --force`
- To use a smaller test set: `pnpm run setup:test`

## Customizing Pages
The list of pages to scrape is defined in:
- `pages.json` (full set)
- `pages-test.json` (smaller set for tests)

You can edit these files to change the crawl scope. The parser attempts to extract meaningful sections by headings and convert them to Markdown for embedding.

## Troubleshooting
- **Error: OPENAI_API_KEY environment variable is required**
  - Create `.env.local` (and optionally `.env`) with `OPENAI_API_KEY`
- **Cache not found at data/embeddings.json. Run setup first.**
  - Run `pnpm build && pnpm run setup` to generate the cache
- **Network timeouts while scraping**
  - The scraper retries with exponential backoff; rerun `setup` or adjust your network
- **MCP client can’t see tools**
  - Ensure the server is started from the project directory and connected via stdio
  - Confirm `pnpm start` logs show the server is running and the cache is loaded

## Project Structure
```
src/
  index.ts        # MCP server entry (stdio)
  setup.ts        # Setup pipeline: scrape → parse/chunk → embed → cache
  tools/          # MCP tool definitions and handlers
  utils/          # scraper, parser, embedder, cache, search
data/             # Default cache directory (embeddings.json)
pages.json        # Full list of pages to scrape
pages-test.json   # Smaller list for testing
dist/             # Compiled JavaScript (after pnpm build)
start-mcp.js      # Wrapper to load env and run the server
```

## Credits
The documentation-search foundation (scrape → parse/chunk → embed → cache pipeline) was originally built by [Ignacio García](https://github.com/NachoG2000) as `gmat-docs-mcp-server`. The GMAT execution copilot tools (`runGmat`, idioms knowledge base, sample corpus) and the local-embedding runtime were added on top.

## License
ISC


