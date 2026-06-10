// One-time migration: re-embed the existing doc corpus (data/embeddings.json,
// originally OpenAI text-embedding-3-small / 1536d) with the local MiniLM model (384d)
// so searchDocs works without an OpenAI key. The old file is kept as a .openai.bak.
//
// Usage: node dist/reembedLocal.js

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { embedBatch, EMBED_MODEL } from './utils/localEmbedder.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const CACHE_DIR = process.env.CACHE_DIR || path.join(REPO_ROOT, 'data');
const CACHE_PATH = path.join(CACHE_DIR, 'embeddings.json');
const BACKUP_PATH = path.join(CACHE_DIR, 'embeddings.openai.bak.json');

async function main() {
  const data = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  const chunks: any[] = data.chunks;
  console.log(`Loaded ${chunks.length} chunks (current dims: ${chunks[0].embedding.length})`);

  if (String(data.version).startsWith('local-')) {
    console.log('Corpus already uses local embeddings, nothing to do.');
    return;
  }

  console.log(`Re-embedding with ${EMBED_MODEL} (first run downloads the model, ~25 MB)...`);
  const t0 = Date.now();
  const vectors = await embedBatch(
    chunks.map((c) => `${c.pageName}\n${c.fullContent}`),
    (done) => console.log(`  ${done}/${chunks.length}`)
  );
  console.log(`Embedded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  for (let i = 0; i < chunks.length; i++) chunks[i].embedding = vectors[i];

  if (!fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(CACHE_PATH, BACKUP_PATH);
    console.log(`Backed up old corpus to ${BACKUP_PATH}`);
  }

  fs.writeFileSync(
    CACHE_PATH,
    JSON.stringify({ timestamp: new Date().toISOString(), version: `local-${EMBED_MODEL}`, chunks })
  );
  const mb = (fs.statSync(CACHE_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`Wrote ${CACHE_PATH} (${mb} MB, ${vectors[0].length} dims)`);
}

main().catch((e) => {
  console.error('Re-embedding failed:', e);
  process.exit(1);
});
