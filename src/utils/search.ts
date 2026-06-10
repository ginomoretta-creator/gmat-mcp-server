import * as fs from 'fs';
import * as path from 'path';

export interface SearchChunk {
  id: string;
  pageName: string;
  href: string;
  fullContent: string;
  embedding: number[];
}

export interface SearchResult {
  chunk: SearchChunk;
  score: number;
}

export interface CacheData {
  timestamp: string;
  version: string;
  chunks: SearchChunk[];
}

export class SearchEngine {
  private chunks: SearchChunk[] = [];
  private isLoaded = false;
  private cacheDir: string;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir || path.join(process.cwd(), 'data');
  }

  async loadCache(): Promise<void> {
    const cachePath = path.join(this.cacheDir, 'embeddings.json');
    
    if (!fs.existsSync(cachePath)) {
      throw new Error(`Cache not found at ${cachePath}. Run setup first.`);
    }

    const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as CacheData;
    this.chunks = cacheData.chunks;
    this.isLoaded = true;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async search(queryEmbedding: number[], topK: number = 10, minScore: number = 0.1): Promise<SearchResult[]> {
    if (!this.isLoaded) {
      throw new Error('Search engine not loaded. Call loadCache() first.');
    }

    const results: SearchResult[] = [];

    for (const chunk of this.chunks) {
      const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);
      if (score >= minScore) {
        results.push({ chunk, score });
      }
    }

    // Sort by score descending and take top K
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  getStats(): { totalChunks: number; isLoaded: boolean } {
    return {
      totalChunks: this.chunks.length,
      isLoaded: this.isLoaded
    };
  }
}