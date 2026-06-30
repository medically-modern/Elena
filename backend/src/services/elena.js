import Anthropic from '@anthropic-ai/sdk';
import { ELENA_SYSTEM_PROMPT } from '../config/personality.js';
import { CEO_SYSTEM_PROMPT } from '../config/ceo-personality.js';
import { KNOWLEDGE_BASE } from '../config/knowledge-base.js';
import { isReady as ragReady } from './vectorStore.js';
import { retrieveContext } from './retrieval.js';
import { chatWithTools } from './elena-tool-use.js';
import {
  isConversationsReady,
  getMessages,
  addMessage,
  touchConversation,
  updateConversationTitle,
} from './pgConversations.js';

// Fallback to SQLite if Postgres not available
import { getDb } from '../db/init.js';

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

export async function chat(conversationId, userMessage, mode = 'standard', onStatus = null) {
  const usePg = isConversationsReady();

  // Get conversation history
  let previousMessages;
  if (usePg) {
    const history = await getMessages(conversationId);
    previousMessages = history.map(h => ({ role: h.role, content: h.content }));
  } else {
    const db = getDb();
    const history = db.prepare(
      'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).all(conversationId);
    previousMessages = history.map(h => ({ role: h.role, content: h.content }));
  }

  // Build system prompt based on mode
  let systemPrompt;
  if (mode === 'ceo') {
    systemPrompt = CEO_SYSTEM_PROMPT;
  } else {
    systemPrompt = ELENA_SYSTEM_PROMPT;
  }
  systemPrompt += '\n\n' + KNOWLEDGE_BASE;

  // RULES — injected FIRST, above all other retrieved context
  const rulesBlock = await buildRulesBlock();
  if (rulesBlock) systemPrompt += rulesBlock;

  // RAG: retrieve relevant context (query rewrite → wide retrieve → relevance floor → rerank)
  if (ragReady()) {
    try {
      const { chunks } = await retrieveContext(userMessage, previousMessages);
      if (chunks.length > 0) {
        systemPrompt += '\n\n## RETRIEVED CONTEXT (from ingested knowledge)\n';
        systemPrompt += 'The following information was retrieved as relevant. Use it to give a more complete answer:\n\n';
        for (const r of chunks) {
          systemPrompt += `### [${r.source}]\n${r.content}\n\n`;
        }
      }
    } catch (err) {
      console.error('RAG retrieval error (continuing without):', err.message);
    }
  }

  // Use chatWithTools for Monday.com + Command Center code lookup + rules management
  const assistantMessage = await chatWithTools(
    conversationId,
    userMessage,
    systemPrompt,
    previousMessages,
    onStatus
  );

  // Save both messages
  if (usePg) {
    await addMessage(conversationId, 'user', userMessage);
    await addMessage(conversationId, 'assistant', assistantMessage);
    await touchConversation(conversationId);
  } else {
    const db = getDb();
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(conversationId, 'user', userMessage);
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(conversationId, 'assistant', assistantMessage);
    db.prepare('UPDATE conversations SET updated_at = datetime(\'now\') WHERE id = ?').run(conversationId);
  }

  if (previousMessages.length === 0) {
    await autoTitle(conversationId, userMessage);
  }

  // Detect if user is setting a rule (async, non-blocking)
  detectAndCreateRule(userMessage).catch(() => {});

  return assistantMessage;
}

async function autoTitle(conversationId, firstMessage) {
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 30,
      system: 'Generate a 3-6 word title for this chat. Return ONLY the title, no quotes, no punctuation at the end.',
      messages: [{ role: 'user', content: firstMessage }]
    });
    const title = resp.content[0].text.trim().substring(0, 100);
    if (isConversationsReady()) {
      await updateConversationTitle(conversationId, title);
    } else {
      const db = getDb();
      db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conversationId);
    }
  } catch (e) {}
}

// Detect when user explicitly asks Elena to remember something
async function detectAndCreateRule(userMessage) {
  const msgLower = userMessage.toLowerCase().trim();
  const rememberTriggers = [
    'elena remember', 'elena, remember',
    'remember that', 'remember this',
  ];
  if (!rememberTriggers.some(s => msgLower.includes(s))) return;

  try {
    const detection = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
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
