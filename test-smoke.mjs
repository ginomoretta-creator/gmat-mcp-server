// Smoke test for the refactored server internals (run: node test-smoke.mjs)
import * as fs from 'fs';
import { SearchEngine } from './dist/utils/search.js';
import { embedText } from './dist/utils/localEmbedder.js';
import { runGmat } from './dist/utils/gmat.js';

// --- 1. searchDocs path: local query embedding + cosine search ---
const engine = new SearchEngine('./data');
await engine.loadCache();
console.log('cache loaded:', engine.getStats());

for (const q of ['differential corrector targeting', 'finite burn electric propulsion duration']) {
  const emb = await embedText(q);
  const results = await engine.search(emb, 5, 0.3);
  console.log(`\nquery: "${q}" -> ${results.length} hits`);
  for (const r of results.slice(0, 3)) {
    console.log(`  ${r.score.toFixed(3)}  ${r.chunk.pageName}`);
  }
}

// --- 2. runGmat async path with a known-good script ---
const script = fs.readFileSync(
  'C:/Users/ginom/Desktop/Gino/4 - Clases, archivos útiles/GMAT MCP/gmat_copilot/smoke_good.script',
  'utf8'
);
console.log('\nrunning smoke_good.script (async)...');
const t0 = Date.now();
const res = await runGmat(script, 120000);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('ok:', res.ok, '| stage:', res.stage, '| errors:', res.errors.length, '| reports:', Object.keys(res.reports));
for (const [name, content] of Object.entries(res.reports)) {
  console.log(`report ${name}: ${content.slice(0, 120).replace(/\n/g, ' | ')}`);
}
