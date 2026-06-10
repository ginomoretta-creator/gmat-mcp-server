import OpenAI from 'openai';
import { Chunk } from './parser.js';

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

const EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_BATCH_SIZE = 50; // Reduced batch size to avoid token limits
const MAX_RETRIES = 3;
const MAX_TOKENS_PER_BATCH = 6000; // Conservative limit for entire batch
const MAX_TOKENS_PER_INPUT = 7000; // Safety margin under 8192 model limit

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token
  return Math.ceil(text.length / 4);
}

function splitBySentences(text: string): string[] {
  const parts: string[] = [];
  const sentenceRegex = /(.*?[.!?](?:\s|$))/gs;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = sentenceRegex.exec(text)) !== null) {
    parts.push(match[1]);
    lastIndex = sentenceRegex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}

function hardSliceByCharacters(text: string, maxTokens: number): string[] {
  const approxCharsPerToken = 4;
  const safeCharLimit = Math.max(approxCharsPerToken * maxTokens * 0.9, 1);
  const charLimit = Math.floor(safeCharLimit);
  const slices: string[] = [];
  for (let i = 0; i < text.length; i += charLimit) {
    slices.push(text.slice(i, i + charLimit));
  }
  return slices;
}

function splitLargeChunk(chunk: Chunk, maxTokens: number = 1000): Chunk[] {
  const estimatedTokens = estimateTokens(chunk.fullContent);
  if (estimatedTokens <= maxTokens) {
    return [chunk];
  }

  const paragraphs = chunk.fullContent.split('\n\n').filter((p: string) => p.trim().length > 0);
  const subChunks: Chunk[] = [];
  let buffer = '';
  let partIndex = 0;

  function pushBufferIfAny(): void {
    if (buffer.trim().length === 0) return;
    subChunks.push({
      ...chunk,
      id: `${chunk.id}_part_${partIndex++}`,
      fullContent: buffer,
    });
    buffer = '';
  }

  for (const rawParagraph of paragraphs) {
    const paragraph = rawParagraph.trim();
    const paragraphTokens = estimateTokens(paragraph);

    if (paragraphTokens > maxTokens) {
      pushBufferIfAny();
      const sentences = splitBySentences(paragraph);
      let sentenceBuffer = '';
      for (const sentence of sentences) {
        const tentative = sentenceBuffer + (sentenceBuffer ? ' ' : '') + sentence;
        if (estimateTokens(tentative) > maxTokens) {
          if (sentenceBuffer) {
            subChunks.push({
              ...chunk,
              id: `${chunk.id}_part_${partIndex++}`,
              fullContent: sentenceBuffer,
            });
            sentenceBuffer = '';
          }
          if (estimateTokens(sentence) > maxTokens) {
            const slices = hardSliceByCharacters(sentence, maxTokens);
            for (const slice of slices) {
              subChunks.push({
                ...chunk,
                id: `${chunk.id}_part_${partIndex++}`,
                fullContent: slice,
              });
            }
          } else {
            sentenceBuffer = sentence;
          }
        } else {
          sentenceBuffer = tentative;
        }
      }
      if (sentenceBuffer) {
        subChunks.push({
          ...chunk,
          id: `${chunk.id}_part_${partIndex++}`,
          fullContent: sentenceBuffer,
        });
      }
      continue;
    }

    const tentative = buffer + (buffer ? '\n\n' : '') + paragraph;
    if (estimateTokens(tentative) > maxTokens) {
      pushBufferIfAny();
      buffer = paragraph;
    } else {
      buffer = tentative;
    }
  }

  pushBufferIfAny();

  return subChunks.length > 0 ? subChunks : [chunk];
}

async function embedBatch(
  openai: OpenAI, 
  texts: string[], 
  attempt = 1
): Promise<number[][]> {
  try {
    console.log(`Generating embeddings for batch of ${texts.length} chunks (attempt ${attempt})`);
    
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
    });
    
    return response.data.map(d => d.embedding);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (attempt >= MAX_RETRIES) {
      throw new Error(`Failed to generate embeddings after ${MAX_RETRIES} attempts: ${errorMessage}`);
    }
    
    console.warn(`Embedding attempt ${attempt} failed, retrying...`, errorMessage);
    
    // Exponential backoff with jitter
    const baseDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
    const jitter = Math.random() * 1000;
    await delay(baseDelay + jitter);
    
    return embedBatch(openai, texts, attempt + 1);
  }
}

export async function generateEmbeddings(
  chunks: Chunk[], 
  apiKey: string
): Promise<EmbeddedChunk[]> {
  const openai = new OpenAI({ apiKey });
  
  // Split large chunks to avoid token limits
  console.log(`Processing ${chunks.length} chunks, splitting large ones...`);
  const processedChunks: Chunk[] = [];
  
  for (const chunk of chunks) {
    const splitChunks = splitLargeChunk(chunk);
    if (splitChunks.length > 1) {
      console.log(`Split ${chunk.id} into ${splitChunks.length} parts`);
    }
    processedChunks.push(...splitChunks);
  }

  const normalizedChunks: Chunk[] = [];
  for (const chunk of processedChunks) {
    const tokens = estimateTokens(chunk.fullContent);
    if (tokens > MAX_TOKENS_PER_INPUT) {
      const furtherSplit = splitLargeChunk(chunk, Math.min(1000, MAX_TOKENS_PER_INPUT - 200));
      console.log(`Further split ${chunk.id} into ${furtherSplit.length} parts due to input token limit`);
      normalizedChunks.push(...furtherSplit);
    } else {
      normalizedChunks.push(chunk);
    }
  }
  
  console.log(`Generating embeddings for ${normalizedChunks.length} chunks using ${EMBEDDING_MODEL}`);
  
  // Estimate total tokens
  const totalTokens = normalizedChunks.reduce((sum, chunk) => sum + estimateTokens(chunk.fullContent), 0);
  const estimatedCost = (totalTokens / 1000) * 0.00002; // $0.00002 per 1K tokens for text-embedding-3-small
  console.log(`Estimated tokens: ${totalTokens.toLocaleString()}, estimated cost: $${estimatedCost.toFixed(4)}`);
  
  const embeddedChunks: EmbeddedChunk[] = [];
  
  // Process in smart batches based on token count
  let currentBatch: Chunk[] = [];
  let currentBatchTokens = 0;
  let batchNumber = 1;
  let processedCount = 0;
  
  for (let i = 0; i < normalizedChunks.length; i++) {
    const chunk = normalizedChunks[i];
    const chunkTokens = estimateTokens(chunk.fullContent);
    
    // Check if adding this chunk would exceed limits
    if (currentBatch.length >= MAX_BATCH_SIZE || 
        (currentBatch.length > 0 && currentBatchTokens + chunkTokens > MAX_TOKENS_PER_BATCH)) {
      
      // Process current batch
      console.log(`Processing batch ${batchNumber} (${currentBatch.length} chunks, ~${currentBatchTokens} tokens)`);
      
      try {
        const texts = currentBatch.map(c => c.fullContent);
        const embeddings = await embedBatch(openai, texts);
        
        // Combine chunks with embeddings
        for (let j = 0; j < currentBatch.length; j++) {
          embeddedChunks.push({
            ...currentBatch[j],
            embedding: embeddings[j],
          });
        }
        
        processedCount += currentBatch.length;
        console.log(`✓ Batch ${batchNumber} complete (${processedCount}/${normalizedChunks.length})`);
        
        // Small delay between batches
        await delay(1000);
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Failed to process batch ${batchNumber}:`, errorMessage);
        throw error;
      }
      
      // Reset for next batch
      currentBatch = [];
      currentBatchTokens = 0;
      batchNumber++;
    }
    
    if (chunkTokens > MAX_TOKENS_PER_INPUT) {
      const reSplit = splitLargeChunk(chunk, Math.min(1000, MAX_TOKENS_PER_INPUT - 200));
      console.log(`Re-splitting oversized chunk ${chunk.id} into ${reSplit.length} parts before batching`);
      // Insert the re-split chunks back into the iteration sequence at current position
      normalizedChunks.splice(i, 1, ...reSplit);
      // Re-evaluate the first of the re-split chunks in next iteration
      i -= 1;
      continue;
    }

    // Add chunk to current batch
    currentBatch.push(chunk);
    currentBatchTokens += chunkTokens;
  }
  
  // Process final batch if it has content
  if (currentBatch.length > 0) {
    console.log(`Processing final batch ${batchNumber} (${currentBatch.length} chunks, ~${currentBatchTokens} tokens)`);
    
    try {
      const texts = currentBatch.map(c => c.fullContent);
      const embeddings = await embedBatch(openai, texts);
      
      for (let j = 0; j < currentBatch.length; j++) {
        embeddedChunks.push({
          ...currentBatch[j],
          embedding: embeddings[j],
        });
      }
      
      console.log(`✓ Final batch complete`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to process final batch:`, errorMessage);
      throw error;
    }
  }
  
  console.log(`Successfully generated embeddings for ${embeddedChunks.length} chunks`);
  return embeddedChunks;
}