import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db/init.js';
import { initVectorStore, setupSchema } from './services/vectorStore.js';
import chatRoutes from './routes/chat.js';
import conversationRoutes from './routes/conversations.js';
import adminRoutes from './routes/admin.js';
import ingestRoutes from './routes/ingest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3200;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // larger limit for bulk ingestion

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'elena', rag: !!process.env.DATABASE_URL }));

// Routes
app.use('/api/chat', chatRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ingest', ingestRoutes);

// Serve frontend
app.use(express.static(path.join(__dirname, '../public')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

// Init
initDb();

// Init vector store (non-blocking — app works without it)
if (process.env.DATABASE_URL) {
  const connected = initVectorStore();
  if (connected) {
    setupSchema()
      .then(() => console.log('pgvector ready'))
      .catch(err => console.error('pgvector setup failed:', err.message));
  }
} else {
  console.log('No DATABASE_URL — RAG disabled, hardcoded knowledge only');
}

app.listen(PORT, () => console.log('Elena running on port ' + PORT));
