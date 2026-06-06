// Text chunking for RAG ingestion
// Splits text into ~500 token chunks with overlap for context continuity

export function chunkText(text, options = {}) {
  const {
    maxChunkSize = 500,   // ~tokens (approx chars/4)
    overlapSize = 50,     // ~tokens overlap between chunks
    separator = '\n\n',
  } = options;

  const maxChars = maxChunkSize * 4;
  const overlapChars = overlapSize * 4;

  // Split on natural boundaries first
  const sections = text.split(separator).filter(s => s.trim());
  const chunks = [];
  let current = '';

  for (const section of sections) {
    if (current.length + section.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      // Carry overlap from end of previous chunk
      current = current.slice(-overlapChars) + separator + section;
    } else {
      current += (current ? separator : '') + section;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // Split any oversized chunks on sentences
  const final = [];
  for (const chunk of chunks) {
    if (chunk.length > maxChars * 1.5) {
      const sentences = chunk.match(/[^.!?\n]+[.!?\n]+/g) || [chunk];
      let sub = '';
      for (const sent of sentences) {
        if (sub.length + sent.length > maxChars && sub.length > 0) {
          final.push(sub.trim());
          sub = sub.slice(-overlapChars) + sent;
        } else {
          sub += sent;
        }
      }
      if (sub.trim()) final.push(sub.trim());
    } else {
      final.push(chunk);
    }
  }

  return final;
}

// Chunk structured data (Slack messages, emails, etc.)
// Groups related messages together before chunking
export function chunkMessages(messages, options = {}) {
  const {
    maxChunkSize = 500,
    groupByThread = true,
  } = options;

  const maxChars = maxChunkSize * 4;

  if (groupByThread && messages[0]?.threadId) {
    // Group by thread first
    const threads = {};
    for (const msg of messages) {
      const key = msg.threadId || msg.id || 'default';
      if (!threads[key]) threads[key] = [];
      threads[key].push(msg);
    }

    const chunks = [];
    for (const [threadId, threadMsgs] of Object.entries(threads)) {
      const text = threadMsgs.map(m =>
        `[${m.from || m.author || 'unknown'}${m.timestamp ? ' @ ' + m.timestamp : ''}]: ${m.content || m.text || ''}`
      ).join('\n');

      if (text.length > maxChars) {
        chunks.push(...chunkText(text, { maxChunkSize, separator: '\n' }));
      } else {
        chunks.push(text);
      }
    }
    return chunks;
  }

  // No threading — just concat and chunk
  const text = messages.map(m =>
    `[${m.from || m.author || 'unknown'}${m.timestamp ? ' @ ' + m.timestamp : ''}]: ${m.content || m.text || ''}`
  ).join('\n');

  return chunkText(text, { maxChunkSize, separator: '\n' });
}
