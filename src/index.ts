import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SearchEngine } from './utils/search.js';
import { runGmat, getIdioms, listSamples, listSamplesDetailed, getSample } from './utils/gmat.js';
import { embedText } from './utils/localEmbedder.js';

// Resolve data/ relative to this module (dist/) so the server works regardless of
// the launch working directory.
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = process.env.CACHE_DIR || path.join(REPO_ROOT, 'data');
const searchEngine = new SearchEngine(cacheDir);

// Create MCP server with proper initialization
const server = new Server(
  {
    name: "gmat-docs-mcp-server",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "searchDocs",
        description: "Semantic search over GMAT documentation. Returns relevant sections with full content and sources.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query - can be a question, topic, or keyword related to GMAT"
            },
            topK: {
              type: "number",
              description: "Maximum number of results to return (default: 5). Keep small - each result includes the full section text.",
              minimum: 1,
              maximum: 50,
              default: 5
            },
            minScore: {
              type: "number",
              description: "Minimum cosine similarity threshold (0-1, default: 0.3). Lower it only if a query returns nothing.",
              minimum: 0,
              maximum: 1,
              default: 0.3
            }
          },
          required: ["query"]
        }
      },
      {
        name: "runGmat",
        description: "Run a GMAT mission script (text) headless and return the validated outcome: {ok, stage, errors, reports, raw_tail}. This is the validation loop - write a script, run it, read the errors/results, fix, repeat. 'stage' is one of completed | parse | convergence | run.",
        inputSchema: {
          type: "object",
          properties: {
            script: { type: "string", description: "The full GMAT .script text to run." },
            timeoutSec: { type: "number", description: "Max seconds before aborting (default 600). Use higher for multi-day low-thrust propagations.", default: 600 }
          },
          required: ["script"]
        }
      },
      {
        name: "getGmatIdioms",
        description: "Return the curated GMAT idioms & gotchas knowledge base - hard-won rules that prevent common script errors (parameter dependencies, ElapsedSecs being cumulative, no parentheses in conditionals, ImpulsiveBurn vs FiniteBurn, Propagate Synchronized for two-spacecraft burns, etc.). Read this before writing GMAT scripts.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "listGmatSamples",
        description: "List the available known-good GMAT sample scripts, each tagged with the techniques it demonstrates (targeting, optimization, finite-burn, OD/estimation, B-plane, interplanetary, libration-point, drag, attitude, ...). Covers NASA's official samples plus a locally validated community corpus (real-mission scripts harvested from public repos that pass a headless run; prefixed 'community/'). Scan the tags to pick the right seed for a mission, then getGmatSample to read it.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "getGmatSample",
        description: "Return the full text of one NASA sample script by file name (from listGmatSamples). Use as a known-good template to seed a phase.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", description: "Sample file name, e.g. 'Ex_SafetyEllipse.script' or 'community/daniestevez__jupyter_notebooks__tcm3.script'." } },
          required: ["name"]
        }
      }
    ]
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = (request.params.arguments || {}) as any;

  // ---- GMAT execution + knowledge tools ----
  if (toolName === "runGmat") {
    const result = await runGmat(String(args.script), (args.timeoutSec ?? 600) * 1000);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
  if (toolName === "getGmatIdioms") {
    return { content: [{ type: "text", text: getIdioms() }] };
  }
  if (toolName === "listGmatSamples") {
    const list = listSamplesDetailed();
    if (!list.length) {
      return { content: [{ type: "text", text: "No samples found (set GMAT_SAMPLES)." }] };
    }
    // Surface the technique vocabulary up front so the agent can scan for the
    // right seed, then list each sample with its detected tags.
    const allTags = Array.from(new Set(list.flatMap((s) => s.features))).sort();
    const lines = list.map((s) => `${s.name}${s.features.length ? `  [${s.features.join(", ")}]` : ""}`);
    const text =
      `${list.length} GMAT sample scripts (NASA + validated community/). ` +
      `Techniques present: ${allTags.join(", ")}.\n` +
      `Pick by technique, then getGmatSample to read the full text.\n\n` +
      lines.join("\n");
    return { content: [{ type: "text", text }] };
  }
  if (toolName === "getGmatSample") {
    return { content: [{ type: "text", text: getSample(String(args.name)) }] };
  }

  // ---- Documentation search ----
  if (toolName !== "searchDocs") {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const { query, topK = 5, minScore = 0.3 } = args;

  try {
    // Embed the query with the local model (same model the corpus was embedded with).
    const queryEmbedding = await embedText(String(query));

    // Perform search
    const results = await searchEngine.search(queryEmbedding, topK, minScore);

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No relevant documentation found for query: "${query}"`
          }
        ]
      };
    }

    // Format results
    let response = `Found ${results.length} relevant section${results.length > 1 ? 's' : ''} for: "${query}"\n\n`;
    
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const { chunk, score } = result;
      
      response += `## Result ${i + 1} (Score: ${score.toFixed(3)})\n`;
      response += `**Page**: ${chunk.pageName}\n`;
      response += `**Source**: ${chunk.href}\n`;
      response += `**Content**:\n${chunk.fullContent}\n\n`;
      response += '---\n\n';
    }

    return {
      content: [
        {
          type: "text",
          text: response.trim()
        }
      ]
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        {
          type: "text",
          text: `Error searching documentation: ${errorMessage}`
        }
      ]
    };
  }
});

// Start server
async function main() {
  try {
    // Load doc-search cache (only needed for searchDocs; non-fatal if missing).
    try {
      console.error('Loading GMAT documentation cache...');
      await searchEngine.loadCache();
      const stats = searchEngine.getStats();
      console.error(`Cache loaded: ${stats.totalChunks} chunks available`);
    } catch (e) {
      console.error('Doc cache not loaded (searchDocs disabled); GMAT tools still available.');
    }

    // Create and connect transport
    const transport = new StdioServerTransport();
    console.error('Starting GMAT Docs MCP Server...');
    
    await server.connect(transport);
    console.error('GMAT Docs MCP Server is running');
  } catch (error) {
    console.error('Failed to start GMAT Docs MCP Server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('Shutting down GMAT Docs MCP Server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Shutting down GMAT Docs MCP Server...');
  process.exit(0);
});

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});