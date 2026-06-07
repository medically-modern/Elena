import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db/init.js';
import { initVectorStore, setupSchema } from './services/vectorStore.js';
import { warmup as warmupEmbeddings } from './services/embeddings.js';
import { initRulesPool, setupRulesSchema } from './services/rules.js';
import { initConversationsPool, setupConversationsSchema } from './services/pgConversations.js';
import { authMiddleware, optionalAuth } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import conversationRoutes from './routes/conversations.js';
import adminRoutes from './routes/admin.js';
import ingestRoutes from './routes/ingest.js';
import rulesRoutes from './routes/rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3200;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Public endpoints — no auth
app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  service: 'elena',
  rag: !!process.env.DATABASE_URL,
  auth: !!process.env.GOOGLE_CLIENT_ID
}));

app.get('/api/config', (req, res) => res.json({
  googleClientId: process.env.GOOGLE_CLIENT_ID || null
}));

// Auth routes — no auth required
app.use('/api/auth', authRoutes);

// Protected routes
app.use('/api/chat', authMiddleware, chatRoutes);
app.use('/api/conversations', authMiddleware, conversationRoutes);
app.use('/api/admin', authMiddleware, adminRoutes);
app.use('/api/ingest', authMiddleware, ingestRoutes);
app.use('/api/rules', authMiddleware, rulesRoutes);

// Serve frontend
app.use(express.static(path.join(__dirname, '../public')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

// Init
initDb();

if (process.env.DATABASE_URL) {
  const connected = initVectorStore();
  const rulesConnected = initRulesPool();
  const convosConnected = initConversationsPool();
  if (connected) {
    setupSchema()
      .then(() => console.log('pgvector ready'))
      .catch(err => console.error('pgvector setup failed:', err.message));
  }
  if (rulesConnected) {
    setupRulesSchema()
      .then(() => console.log('Rules engine ready — shared rules active'))
      .catch(err => console.error('Rules schema setup failed:', err.message));
  }
  if (convosConnected) {
    setupConversationsSchema()
      .then(() => console.log('Postgres conversations ready — history persists across deploys'))
      .catch(err => console.error('Conversations schema setup failed:', err.message));
  }
  warmupEmbeddings().catch(() => {});
} else {
  console.log('No DATABASE_URL — RAG + rules + persistent conversations disabled');
}

app.listen(PORT, () => console.log('Elena running on port ' + PORT));
