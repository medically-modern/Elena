import { pipeline } from '@xenova/transformers';

let embedder = null;

// Load model once, reuse for all requests
// Uses all-MiniLM-L6-v2 (384 dims) — runs locally, no API key needed
async function getEmbedder() {
  if (!embedder) {
    console.log('Loading embedding model (first time only)...');
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('Embedding model ready');
  }
  return embedder;
}

// Embed a single text — returns 384-dim float array
export async function embed(text) {
  const extractor = await getEmbedder();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// Embed multiple texts
export async function embedBatch(texts) {
  const extractor = await getEmbedder();
  const results = [];
  // Process in small batches to avoid OOM
  for (let i = 0; i < texts.length; i += 10) {
    const batch = texts.slice(i, i + 10);
    for (const text of batch) {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data));
    }
  }
  return results;
}

// Pre-warm the model on startup (optional, non-blocking)
export async function warmup() {
  try {
    await getEmbedder();
  } catch (err) {
    console.error('Embedding model warmup failed:', err.message);
  }
}
