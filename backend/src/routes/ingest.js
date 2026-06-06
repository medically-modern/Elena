import { Router } from 'express';
import { embed, embedBatch } from '../services/embeddings.js';
import { storeChunk, storeChunks, deleteBySource, isReady } from '../services/vectorStore.js';
import { chunkText, chunkMessages } from '../services/chunker.js';

const router = Router();

// Middleware: check RAG is available
function requireRAG(req, res, next) {
  if (!isReady()) return res.status(503).json({ error: 'RAG not configured — set DATABASE_URL and OPENAI_API_KEY' });
  next();
}

// Ingest raw text (SOPs, documents, notes)
router.post('/text', requireRAG, async (req, res) => {
  const { content, source = 'manual', category = 'general', metadata = {} } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });

  try {
    const chunks = chunkText(content);
    const embeddings = await embedBatch(chunks);
    const prepared = chunks.map((c, i) => ({
      content: c,
      embedding: embeddings[i],
      source,
      sourceType: 'document',
      category,
      metadata: { ...metadata, chunkIndex: i, totalChunks: chunks.length },
    }));
    const ids = await storeChunks(prepared);
    res.json({ stored: ids.length, ids });
  } catch (err) {
    console.error('Ingest text error:', err);
    res.status(500).json({ error: 'Failed to ingest text' });
  }
});

// Ingest Slack messages
router.post('/slack', requireRAG, async (req, res) => {
  const { messages, channel = 'unknown', metadata = {} } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

  try {
    const chunks = chunkMessages(messages);
    const embeddings = await embedBatch(chunks);
    const prepared = chunks.map((c, i) => ({
      content: c,
      embedding: embeddings[i],
      source: `slack:${channel}`,
      sourceType: 'slack',
      category: 'communication',
      metadata: { ...metadata, channel, chunkIndex: i },
    }));
    const ids = await storeChunks(prepared);
    res.json({ stored: ids.length, ids });
  } catch (err) {
    console.error('Ingest slack error:', err);
    res.status(500).json({ error: 'Failed to ingest Slack messages' });
  }
});

// Ingest Gmail threads
router.post('/gmail', requireRAG, async (req, res) => {
  const { threads, metadata = {} } = req.body;
  if (!threads || !Array.isArray(threads)) return res.status(400).json({ error: 'threads array required' });

  try {
    const allChunks = [];
    for (const thread of threads) {
      const text = thread.messages.map(m =>
        `From: ${m.from || 'unknown'}\nDate: ${m.date || ''}\nSubject: ${m.subject || ''}\n\n${m.body || ''}`
      ).join('\n---\n');

      const chunks = chunkText(text);
      for (const c of chunks) {
        allChunks.push({
          content: c,
          source: `gmail:${thread.threadId || 'unknown'}`,
          sourceType: 'email',
          category: 'communication',
          metadata: { ...metadata, subject: thread.subject },
        });
      }
    }

    const embeddings = await embedBatch(allChunks.map(c => c.content));
    const prepared = allChunks.map((c, i) => ({ ...c, embedding: embeddings[i] }));
    const ids = await storeChunks(prepared);
    res.json({ stored: ids.length, ids });
  } catch (err) {
    console.error('Ingest gmail error:', err);
    res.status(500).json({ error: 'Failed to ingest Gmail threads' });
  }
});

// Ingest RingCentral SMS conversations
router.post('/ringcentral', requireRAG, async (req, res) => {
  const { conversations, metadata = {} } = req.body;
  if (!conversations || !Array.isArray(conversations)) return res.status(400).json({ error: 'conversations array required' });

  try {
    const allChunks = [];
    for (const convo of conversations) {
      const messages = convo.messages || [];
      const chunks = chunkMessages(messages);
      for (const c of chunks) {
        allChunks.push({
          content: c,
          source: `ringcentral:${convo.patientName || convo.phoneNumber || 'unknown'}`,
          sourceType: 'sms',
          category: 'patient_communication',
          metadata: { ...metadata, patientName: convo.patientName, phone: convo.phoneNumber },
        });
      }
    }

    const embeddings = await embedBatch(allChunks.map(c => c.content));
    const prepared = allChunks.map((c, i) => ({ ...c, embedding: embeddings[i] }));
    const ids = await storeChunks(prepared);
    res.json({ stored: ids.length, ids });
  } catch (err) {
    console.error('Ingest RC error:', err);
    res.status(500).json({ error: 'Failed to ingest RingCentral data' });
  }
});

// Ingest Monday.com board data
router.post('/monday', requireRAG, async (req, res) => {
  const { items, boardName = 'unknown', metadata = {} } = req.body;
  if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'items array required' });

  try {
    const allChunks = [];
    for (const item of items) {
      // Build a text representation of the Monday item
      let text = `Task: ${item.name || 'Untitled'}\n`;
      if (item.status) text += `Status: ${item.status}\n`;
      if (item.assignee) text += `Assigned to: ${item.assignee}\n`;
      if (item.date) text += `Date: ${item.date}\n`;
      if (item.updates && item.updates.length > 0) {
        text += 'Updates:\n' + item.updates.map(u => `  - ${u.author || ''}: ${u.text || ''}`).join('\n');
      }
      if (item.columns) {
        for (const [key, val] of Object.entries(item.columns)) {
          if (val) text += `${key}: ${val}\n`;
        }
      }

      allChunks.push({
        content: text,
        source: `monday:${boardName}`,
        sourceType: 'project_management',
        category: 'operations',
        metadata: { ...metadata, boardName, itemId: item.id, itemName: item.name },
      });
    }

    const embeddings = await embedBatch(allChunks.map(c => c.content));
    const prepared = allChunks.map((c, i) => ({ ...c, embedding: embeddings[i] }));
    const ids = await storeChunks(prepared);
    res.json({ stored: ids.length, ids });
  } catch (err) {
    console.error('Ingest Monday error:', err);
    res.status(500).json({ error: 'Failed to ingest Monday data' });
  }
});

// Bulk ingest — generic, accepts any array of {content, source, sourceType, category, metadata}
router.post('/bulk', requireRAG, async (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array required' });
  }

  try {
    const texts = items.map(i => i.content);
    const embeddings = await embedBatch(texts);
    const prepared = items.map((item, i) => ({
      content: item.content,
      embedding: embeddings[i],
      source: item.source || 'manual',
      sourceType: item.sourceType || 'document',
      category: item.category || 'general',
      metadata: item.metadata || {},
    }));
    const ids = await storeChunks(prepared);
    res.json({ stored: ids.length, ids });
  } catch (err) {
    console.error('Bulk ingest error:', err);
    res.status(500).json({ error: 'Failed to bulk ingest' });
  }
});

// Delete all chunks from a specific source (for re-ingestion)
router.delete('/source/:source', requireRAG, async (req, res) => {
  try {
    const deleted = await deleteBySource(req.params.source);
    res.json({ deleted });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

export default router;
