# Elena — Medically Modern AI Assistant

Company-wide AI knowledge assistant powered by Claude.

## Structure
- `frontend/` — React + Vite chat interface (deploys to GitHub Pages)
- `backend/` — Express API + SQLite (deploys to Railway)
- `docs/` — Built frontend (auto-generated)

## Setup

### Backend
```bash
cd backend
npm install
cp .env.example .env  # Add your ANTHROPIC_API_KEY
npm run dev
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env  # Point to your backend URL
npm run dev
```

## Deployment
- **Frontend**: GitHub Pages (auto-deploys on push via Actions)
- **Backend**: Railway (auto-deploys on push)

Set `VITE_API_URL` in the frontend build to point to your Railway backend URL.
