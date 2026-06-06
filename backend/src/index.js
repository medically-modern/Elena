import express from 'express';
import cors from 'cors';
import { initDb } from './db/init.js';
import chatRoutes from './routes/chat.js';
import conversationRoutes from './routes/conversations.js';
import adminRoutes from './routes/admin.js';

const app = express();
const PORT = process.env.PORT || 3200;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'elena' }));

// Routes
app.use('/api/chat', chatRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/admin', adminRoutes);

// Init DB and start
initDb();
app.listen(PORT, () => console.log(`Elena backend running on port ${PORT}`));
