# Elena — Medically Modern AI Knowledge Assistant

Company-wide AI assistant that answers questions about MM processes, team structure, insurance rules, products, and patient communication patterns. Powered by Claude + RAG (pgvector).

**Live:** https://elena-backend-production.up.railway.app

---

## Architecture

```
Browser → Express API → Claude Sonnet (Anthropic)
                ↓
         pgvector (Postgres)  ← Ingestion API
                ↓
         RAG context injected into system prompt
```

- **Frontend:** React + Vite + Tailwind (ChatGPT-style UI), served from Express static
- **Backend:** Express.js, SQLite (conversations), Postgres/pgvector (knowledge vectors)
- **AI:** Claude claude-sonnet-4-20250514 via Anthropic API
- **Embeddings:** all-MiniLM-L6-v2 via @xenova/transformers (runs locally, no extra API key)
- **Search:** Hybrid — semantic similarity + keyword matching

## How Elena Answers Questions

1. User sends a message
2. Elena embeds the message using MiniLM-L6-v2 (384-dim vector)
3. **Semantic search:** finds the 6 most similar chunks in pgvector
4. **Keyword search:** finds up to 4 chunks matching key words from the question
5. Results are deduplicated and injected into the system prompt as context
6. Claude generates a response using the hardcoded knowledge base + retrieved RAG context
7. If RAG finds nothing relevant, Elena falls back to the hardcoded knowledge base

Elena will say "I don't have that in my knowledge base" rather than guess.

---

## Teaching Elena (Ingestion API)

All endpoints accept JSON. No auth required currently (add auth before exposing publicly).

### Ingest plain text (SOPs, docs, process notes)

```bash
curl -X POST https://elena-backend-production.up.railway.app/api/ingest/text \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Your SOP or document text here...",
    "source": "sop:prior-auth-process",
    "category": "operations"
  }'
```

**Fields:**
- `content` (required) — the text to ingest
- `source` — identifier for where this came from (e.g. `sop:auth-process`, `doc:employee-handbook`)
- `category` — grouping tag (e.g. `operations`, `insurance`, `hr`, `product`)

### Ingest Slack messages

```bash
curl -X POST https://elena-backend-production.up.railway.app/api/ingest/slack \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "med-mod-onboarding",
    "messages": [
      {"from": "corey", "timestamp": "2026-04-13 12:25", "content": "Hi Team! ..."},
      {"from": "Brandon Ellis", "timestamp": "2026-04-13 14:00", "content": "..."}
    ]
  }'
```

### Ingest Gmail threads

```bash
curl -X POST https://elena-backend-production.up.railway.app/api/ingest/gmail \
  -H "Content-Type: application/json" \
  -d '{
    "threads": [{
      "threadId": "abc123",
      "subject": "Prior Auth for Johnson",
      "messages": [
        {"from": "samantha@mm.com", "date": "2026-05-01", "subject": "Prior Auth", "body": "Submitted auth for..."}
      ]
    }]
  }'
```

### Ingest RingCentral SMS

```bash
curl -X POST https://elena-backend-production.up.railway.app/api/ingest/ringcentral \
  -H "Content-Type: application/json" \
  -d '{
    "conversations": [{
      "patientName": "John Smith",
      "phoneNumber": "+15551234567",
      "messages": [
        {"from": "patient", "timestamp": "2026-05-01", "content": "Where is my order?"},
        {"from": "Corey", "timestamp": "2026-05-01", "content": "Shipping tomorrow!"}
      ]
    }]
  }'
```

### Ingest Monday.com items

```bash
curl -X POST https://elena-backend-production.up.railway.app/api/ingest/monday \
  -H "Content-Type: application/json" \
  -d '{
    "boardName": "Patient Pipeline",
    "items": [{
      "id": "123",
      "name": "Smith, John — Dexcom G7",
      "status": "Auth Submitted",
      "assignee": "Samantha",
      "updates": [{"author": "Samantha", "text": "Auth submitted to Fidelis"}]
    }]
  }'
```

### Bulk ingest (any structured data)

```bash
curl -X POST https://elena-backend-production.up.railway.app/api/ingest/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"content": "text here", "source": "manual", "sourceType": "document", "category": "general"},
      {"content": "more text", "source": "manual", "sourceType": "document", "category": "operations"}
    ]
  }'
```

### Delete and re-ingest a source

```bash
# Delete all chunks from a specific source
curl -X DELETE https://elena-backend-production.up.railway.app/api/ingest/source/slack:channel-history

# Then re-ingest with updated data
curl -X POST .../api/ingest/text -d '...'
```

---

## Stats & Monitoring

```bash
# Health check (includes RAG status)
curl https://elena-backend-production.up.railway.app/api/health

# Knowledge stats
curl https://elena-backend-production.up.railway.app/api/admin/stats
```

---

## Environment Variables (Railway)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API access |
| `DATABASE_URL` | Postgres connection (pgvector) |
| `PORT` | Server port (Railway sets automatically) |

No OpenAI key needed — embeddings run locally.

---

## Local Development

```bash
cd backend
npm install
npm run dev   # starts on port 3200 with --watch
```

For RAG locally, run Postgres with pgvector:
```bash
docker run -d --name elena-pg \
  -e POSTGRES_USER=elena -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=elena_vectors \
  -p 5432:5432 ankane/pgvector:v0.7.4-pg17

export DATABASE_URL=postgresql://elena:dev@localhost:5432/elena_vectors
```

Frontend:
```bash
cd frontend
npm install
npm run dev       # dev server with HMR
npm run build     # builds to ../backend/public/
```

---

## Project Structure

```
Elena/
├── backend/
│   ├── src/
│   │   ├── index.js              # Express entry point
│   │   ├── config/
│   │   │   ├── personality.js    # Elena's system prompt
│   │   │   └── knowledge-base.js # Hardcoded company knowledge
│   │   ├── db/
│   │   │   └── init.js           # SQLite schema (conversations, messages)
│   │   ├── routes/
│   │   │   ├── chat.js           # POST /api/chat
│   │   │   ├── conversations.js  # CRUD conversations
│   │   │   ├── admin.js          # GET /api/admin/stats
│   │   │   └── ingest.js         # POST /api/ingest/*
│   │   └── services/
│   │       ├── elena.js          # Claude integration + RAG retrieval
│   │       ├── embeddings.js     # MiniLM-L6-v2 local embeddings
│   │       ├── vectorStore.js    # pgvector operations
│   │       └── chunker.js        # Text chunking for ingestion
│   ├── public/                   # Built frontend (from Vite)
│   ├── package.json
│   └── railway.json
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   ├── components/
    │   │   ├── ChatView.jsx      # Chat interface
    │   │   └── Sidebar.jsx       # Conversation list
    │   ├── services/
    │   │   └── api.js            # API client
    │   └── index.css             # Dark theme styles
    ├── vite.config.js
    └── package.json
```

---

## What Elena Knows (currently ingested)

- **Hardcoded:** Team roster, operational pipeline, patient tiers, product catalog, insurance rules, manufacturer contacts
- **RAG (341 chunks):** Slack channel history, thread conversations, DMs — real team discussions, decisions, process changes, patient communication patterns

To check current stats: `GET /api/admin/stats`
