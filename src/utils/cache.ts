import * as fs from 'fs';
import * as path from 'path';
import { EmbeddedChunk } from './embedder.js';

const CACHE_FILENAME = 'embeddings.json';

function expandTildeInPath(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(process.env.HOME || '', filePath.slice(2));
  }
  return filePath;
}

function getCacheDir(): string {
  if (process.env.CACHE_DIR) {
    return expandTildeInPath(process.env.CACHE_DIR);
  }
  // Default to project data directory
  return path.join(process.cwd(), 'data');
}

function getCachePath(): string {
  return path.join(getCacheDir(), CACHE_FILENAME);
}

export async function saveCache(embeddedChunks: EmbeddedChunk[]): Promise<void> {
  const cacheDir = getCacheDir();
  const cachePath = getCachePath();
  
  try {
    // Ensure cache directory exists
    fs.mkdirSync(cacheDir, { recursive: true });
    
    console.log(`Saving ${embeddedChunks.length} embedded chunks to cache at ${cachePath}`);
    
    // Prepare cache data with metadata
    const cacheData = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      chunks: embeddedChunks,
      totalChunks: embeddedChunks.length,
    };
    
    // Write to temporary file first, then rename for atomic operation
    const tempPath = cachePath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(cacheData, null, 2));
    fs.renameSync(tempPath, cachePath);
    
    // Calculate file size
    const stats = fs.statSync(cachePath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`Cache saved successfully (${fileSizeMB} MB)`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to save cache: ${errorMessage}`);
  }
}

export function loadCache(): EmbeddedChunk[] | null {
  const cachePath = getCachePath();
  
  try {
    if (!fs.existsSync(cachePath)) {
      console.log('No cache file found');
      return null;
    }
    
    console.log(`Loading cache from ${cachePath}`);
    
    const cacheContent = fs.readFileSync(cachePath, 'utf8');
    const cacheData = JSON.parse(cacheContent);
    
    // Validate cache structure
    if (!cacheData.chunks || !Array.isArray(cacheData.chunks)) {
      throw new Error('Invalid cache format: missing chunks array');
    }
    
    console.log(`Loaded ${cacheData.chunks.length} chunks from cache (saved: ${cacheData.timestamp})`);
    
    // Basic validation of chunk structure
    for (const chunk of cacheData.chunks) {
      if (!chunk.id || !chunk.pageName || !chunk.href || !chunk.fullContent || !chunk.embedding) {
        throw new Error('Invalid chunk structure in cache');
      }
      
      if (!Array.isArray(chunk.embedding)) {
        throw new Error('Invalid embedding format in cache');
      }
    }
    
    return cacheData.chunks as EmbeddedChunk[];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to load cache: ${errorMessage}`);
    return null;
  }
}

export function clearCache(): void {
  const cachePath = getCachePath();
  
  try {
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
      console.log('Cache cleared successfully');
    } else {
      console.log('No cache file to clear');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to clear cache: ${errorMessage}`);
  }
}

export function getCacheInfo(): { exists: boolean; path: string; size?: string; timestamp?: string } {
  const cachePath = getCachePath();
  
  if (!fs.existsSync(cachePath)) {
    return { exists: false, path: cachePath };
  }
  
  try {
    const stats = fs.statSync(cachePath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    // Try to read timestamp from cache
    let timestamp;
    try {
      const cacheContent = fs.readFileSync(cachePath, 'utf8');
      const cacheData = JSON.parse(cacheContent);
      timestamp = cacheData.timestamp;
    } catch {
      // Ignore timestamp read errors
    }
    
    return {
      exists: true,
      path: cachePath,
      size: `${fileSizeMB} MB`,
      timestamp,
    };
  } catch (error) {
    return { exists: true, path: cachePath };
  }
}