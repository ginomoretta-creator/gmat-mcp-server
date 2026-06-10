// Local embedding via transformers.js (all-MiniLM-L6-v2, 384 dims) - no API key,
// no network after the first model download. The model is cached under data/models.

import * as path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..', '..');

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';

let extractorPromise: Promise<any> | null = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      env.cacheDir = path.join(REPO_ROOT, 'data', 'models');
      return pipeline('feature-extraction', EMBED_MODEL, { quantized: true });
    })();
  }
  return extractorPromise;
}

export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data as Float32Array);
}

export async function embedBatch(texts: string[], onProgress?: (done: number) => void): Promise<number[][]> {
  const extractor = await getExtractor();
  const result: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const out = await extractor(texts[i], { pooling: 'mean', normalize: true });
    result.push(Array.from(out.data as Float32Array));
    if (onProgress && (i + 1) % 50 === 0) onProgress(i + 1);
  }
  return result;
}
