import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/init.js';
import { ELENA_SYSTEM_PROMPT } from '../config/personality.js';
import { CEO_SYSTEM_PROMPT } from '../config/ceo-personality.js';
import { KNOWLEDGE_BASE } from '../config/knowledge-base.js';
import { embed } from './embeddings.js';
import { search, keywordSearch, isReady as ragReady } from './vectorStore.js';

// Rules engine — shared source of truth, overrides all other context
let rulesReadyFn, buildRulesBlock, createRuleFn;
try {
  const rules = await import('./rules.js');
  rulesReadyFn = rules.isRulesReady;
  buildRulesBlock = rules.buildRulesBlock;
  createRuleFn = rules.createRule;
} catch (err) {
  console.warn('Rules module not available:', err.message);
  rulesReadyFn = () => false;
  buildRulesBlock = async () => '';
  createRuleFn = async () => null;
}

const anthropic = new Anthropic();

export async function chat(conversationId, userMessage, mode = 'standard') {
  const db = getDb();

  // Get conversation history
  const history = db.prepare(
    'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(conversationId);

  // Build system prompt based on mode
  let systemPrompt;
  if (mode === 'ceo') {
    systemPrompt = CEO_SYSTEM_PROMPT;
  } else {
    systemPrompt = ELENA_SYSTEM_PROMPT;
  }
  systemPrompt += '\n\n' + KNOWLEDGE_BASE;

  // RULES — injected FIRST, above all other retrieved context
  // Rules are the source of truth and override everything else
  const rulesBlock = await buildRulesBlock();
  if (rulesBlock) systemPrompt += rulesBlock;

  // RAG: retrieve relevant context from vector store
  if (ragReady()) {
    try {
      const queryEmbedding = await embed(userMessage);
      const semanticResults = await search(queryEmbedding, 6);
      const kwResults = await keywordSearch(userMessage, 4);

      const seen = new Set();
      const allResults = [];
      for (const r of [...semanticResults, ...kwResults]) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          allResults.push(r);
        }
      }

      if (allResults.length > 0) {
        const top = allResults.slice(0, 8);
        systemPrompt += '\n\n## RETRIEVED CONTEXT (from ingested knowledge)\n';
        systemPrompt += 'The following information was retrieved as relevant. Use it to give a more complete answer:\n\n';
        for (const r of top) {
          systemPrompt += `### [${r.source}]\n${r.content}\n\n`;
        }
      }
    } catch (err) {
      console.error('RAG retrieval error (continuing without):', err.message);
    }
  }

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

  db.prepare('UPDATE conversations SET updated_at = datetime(\'now\') WHERE id = ?').run(conversationId);

  if (history.length === 0) {
    autoTitle(conversationId, userMessage).catch(() => {});
  }

  // Detect if user is setting a rule (async, non-blocking)
  detectAndCreateRule(userMessage).catch(() => {});

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
  } catch (e) {}
}

// Detect when user explicitly asks Elena to remember something
// ONLY triggers on "elena remember" / "remember that" — nothing else
async function detectAndCreateRule(userMessage) {
  const msgLower = userMessage.toLowerCase().trim();
  const rememberTriggers = [
    'elena remember', 'elena, remember',
    'remember that', 'remember this',
  ];
  if (!rememberTriggers.some(s => msgLower.includes(s))) return;

  try {
    const detection = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: `The user is explicitly asking Elena to remember something. Extract the rule or fact they want remembered and return it as a clean, permanent business rule.

Examples:
- "Elena remember that we don't take United" → {"rule": "Medically Modern does not accept United Healthcare insurance.", "category": "insurance"}
- "remember that we only ship on Tuesdays and Fridays" → {"rule": "Shipping only occurs on Tuesdays and Fridays.", "category": "shipping"}
- "Elena, remember this: all callbacks within 2 hours" → {"rule": "All patient callbacks must happen within 2 hours.", "category": "operations"}

Return JSON: {"rule": "clear statement of the rule", "category": "insurance|shipping|policy|products|patients|operations|general"}
JSON only, no explanation.`,
      messages: [{ role: 'user', content: userMessage }]
    });

    let raw = detection.content[0].text.trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const result = JSON.parse(raw);

    if (result.rule) {
      const created = await createRuleFn(result.rule, result.category || 'general', {
        source_message: userMessage.substring(0, 200),
        detected_at: new Date().toISOString(),
      });
      console.log(`Rule created from chat: [${result.category}] ${result.rule} (id: ${created?.id})`);
    }
  } catch (err) {
    console.error('Rule detection error:', err.message);
  }
}
