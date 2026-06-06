import OpenAI from 'openai';

const openai = new OpenAI();
const MODEL = 'text-embedding-3-small'; // 1536 dims, $0.02/1M tokens

// Embed a single text
export async function embed(text) {
  const response = await openai.embeddings.create({
    model: MODEL,
    input: text.substring(0, 8000), // safety limit
  });
  return response.data[0].embedding;
}

// Embed multiple texts in one API call (max 2048 inputs)
export async function embedBatch(texts) {
  const truncated = texts.map(t => t.substring(0, 8000));
  // Process in batches of 100 to stay within limits
  const results = [];
  for (let i = 0; i < truncated.length; i += 100) {
    const batch = truncated.slice(i, i + 100);
    const response = await openai.embeddings.create({
      model: MODEL,
      input: batch,
    });
    results.push(...response.data.map(d => d.embedding));
  }
  return results;
}
