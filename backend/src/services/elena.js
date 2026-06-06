import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/init.js';
import { ELENA_SYSTEM_PROMPT } from '../config/personality.js';
import { KNOWLEDGE_BASE } from '../config/knowledge-base.js';
import { embed } from './embeddings.js';
import { search, isReady as ragReady } from './vectorStore.js';

const anthropic = new Anthropic();

export async function chat(conversationId, userMessage) {
  const db = getDb();

  // Get conversation history
  const history = db.prepare(
    'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(conversationId);

  // Build system prompt with hardcoded knowledge
  let systemPrompt = ELENA_SYSTEM_PROMPT + '\n\n' + KNOWLEDGE_BASE;

  // RAG: retrieve relevant context from vector store
  if (ragReady()) {
    try {
      const queryEmbedding = await embed(userMessage);
      const results = await search(queryEmbedding, 5, 0.3);
      if (results.length > 0) {
        systemPrompt += '\n\n## RETRIEVED CONTEXT (from ingested knowledge)\n';
        systemPrompt += 'The following information was retrieved as relevant. Use it to give a more complete answer:\n\n';
        for (const r of results) {
          const sim = (r.similarity * 100).toFixed(0);
          systemPrompt += `### [${r.source_type}] ${r.source} (${sim}% match)\n${r.content}\n\n`;
        }
      }
    } catch (err) {
      console.error('RAG retrieval error (continuing without):', err.message);
    }
  }

  // Build messages array
  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage }
  ];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages
  });

  const assistantMessage = response.content[0].text;

  // Save both messages
  db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(conversationId, 'user', userMessage);
  db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(conversationId, 'assistant', assistantMessage);

  // Update conversation timestamp and auto-title from first message
  db.prepare('UPDATE conversations SET updated_at = datetime(\'now\') WHERE id = ?').run(conversationId);

  // Auto-title on first message
  if (history.length === 0) {
    autoTitle(conversationId, userMessage).catch(() => {});
  }

  return assistantMessage;
}

async function autoTitle(conversationId, firstMessage) {
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 30,
      system: 'Generate a 3-6 word title for this chat. Return ONLY the title, no quotes, no punctuation at the end.',
      messages: [{ role: 'user', content: firstMessage }]
    });
    const title = resp.content[0].text.trim().substring(0, 100);
    const db = getDb();
    db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conversationId);
  } catch (e) {
    // Non-critical
  }
}
