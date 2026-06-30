// retrieval.js — smarter RAG retrieval pipeline
//
// Replaces the naive "embed the raw message → take top 6+4 → slice 8" approach with:
//   1. Query rewriting   — resolve pronouns/references using conversation context
//                          so follow-up questions ("what about his auth?") retrieve well.
//   2. Wide candidate net — pull many more candidates than we'll keep.
//   3. Relevance floor    — drop obviously-irrelevant semantic hits (the previously
//                          unused similarity threshold), and exclude rule rows
//                          (the rules engine owns those; deleted rules must not leak back).
//   4. LLM reranking      — a cheap Haiku pass keeps only the passages that actually
//                          help answer the question, most-relevant first.
//
// Every LLM step fails open: if Haiku errors, we fall back to the original behaviour
// rather than dropping retrieval entirely.

import Anthropic from '@anthropic-ai/sdk';
import { embed } from './embeddings.js';
import { search, keywordSearch } from './vectorStore.js';

const anthropic = new Anthropic();
const HAIKU_MODEL = process.env.HAIKU_MODEL || 'claude-haiku-4-5';

const CANDIDATE_SEMANTIC = 20; // wide net (was 6)
const CANDIDATE_KEYWORD = 10;  // wide net (was 4)
const FINAL_TOP_K = 6;         // what actually reaches the prompt
const SIM_FLOOR = 0.15;        // drop semantic hits below this cosine similarity

// Rewrite a possibly-contextual message into a standalone search query.
// Only runs when there's prior conversation that could make the message ambiguous.
export async function rewriteSearchQuery(userMessage, previousMessages = []) {
  if (previousMessages.length === 0) return userMessage;
  try {
    const recent = previousMessages.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n');
    const resp = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 100,
      system:
        "Rewrite the user's latest message into a single standalone search query that captures what they're actually asking, resolving any pronouns or references using the conversation. Return ONLY the query text — no quotes, no explanation.",
      messages: [{
        role: 'user',
        content: `Conversation so far:\n${recent}\n\nLatest message: ${userMessage}\n\nStandalone search query:`,
      }],
    });
    const q = resp.content[0]?.text?.trim();
    return q && q.length > 0 ? q : userMessage;
  } catch {
    return userMessage; // fail open
  }
}

// LLM reranker — keep only the candidates that genuinely help answer the query.
export async function rerankChunks(query, candidates, topK = FINAL_TOP_K) {
  if (candidates.length <= topK) return candidates;
  try {
    const list = candidates
      .map((c, i) => `[${i}] (${c.source}) ${String(c.content).slice(0, 400).replace(/\s+/g, ' ')}`)
      .join('\n\n');
    const resp = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 100,
      system:
        `You are a search reranker. Given a query and numbered candidate passages, return ONLY a JSON array of the indices of the passages that genuinely help answer the query, most relevant first, at most ${topK}. If none are relevant, return []. JSON only.`,
      messages: [{ role: 'user', content: `Query: ${query}\n\nCandidates:\n${list}` }],
    });
    let raw = resp.content[0]?.text?.trim() || '[]';
    if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const idxs = JSON.parse(raw);
    if (!Array.isArray(idxs)) return candidates.slice(0, topK);
    const picked = idxs
      .filter(i => Number.isInteger(i) && i >= 0 && i < candidates.length)
      .map(i => candidates[i]);
    // If the reranker says "nothing relevant", trust it — that's how Elena learns to
    // say "I don't have that" instead of padding the prompt with noise.
    return picked.slice(0, topK);
  } catch {
    return candidates.slice(0, topK); // fail open to original order
  }
}

// Full pipeline. Returns { searchQuery, chunks } — chunks are the reranked top-K.
export async function retrieveContext(userMessage, previousMessages = []) {
  const searchQuery = await rewriteSearchQuery(userMessage, previousMessages);

  const queryEmbedding = await embed(searchQuery);
  const [semantic, keyword] = await Promise.all([
    search(queryEmbedding, CANDIDATE_SEMANTIC),
    keywordSearch(searchQuery, CANDIDATE_KEYWORD),
  ]);

  // Apply the relevance floor to semantic hits (keyword hits report similarity 0, keep them).
  const flooredSemantic = semantic.filter(r => (r.similarity ?? 0) >= SIM_FLOOR);

  // Dedup by id and exclude rule rows — rules are injected authoritatively elsewhere,
  // and soft-deleted rules must never resurface through RAG.
  const seen = new Set();
  const candidates = [];
  for (const r of [...flooredSemantic, ...keyword]) {
    if (r.source_type === 'rule') continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    candidates.push(r);
  }
  if (candidates.length === 0) return { searchQuery, chunks: [] };

  const chunks = await rerankChunks(searchQuery, candidates, FINAL_TOP_K);
  return { searchQuery, chunks };
}
