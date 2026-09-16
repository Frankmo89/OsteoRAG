# OsteoRAG

Private study / clinic assistant for osteopathy — **retrieval-augmented generation (RAG)** over a curated PDF corpus.  
**Does not diagnose or prescribe.** Answers are required to cite the corpus.

Stack: **Cloudflare Workers** (Hono + static assets) · **Supabase** (Auth, Postgres + **pgvector**) · **TypeScript** · OpenAI-compatible embeddings + chat.

> Portfolio note: the demo is auth-gated (not a public chat). This README documents the architecture and engineering decisions.

---

## Case study

### Problem

Osteopathy study materials live in large PDFs (school notes, textbooks, theses). Keyword search and scrolling are slow; a generic chatbot invents answers. The need was a **private**, citation-backed assistant that stays on the user’s sources.

### Approach

- **Ingest pipeline** (`scripts/ingest.ts`): PDF → page-aware text → chunk (~1200 / overlap 250) → embed → upsert into `documents` + `chunks`
- **OCR fallback** for scanned PDFs (local Tesseract / poppler, or optional vision OCR)
- **Hybrid retrieve**: query expansion → multi-query embedding match (`match_chunks`) + keyword RPC (`keyword_chunks`) with clinical token boosts
- **Generate** with a system prompt that forces citations and refuses diagnosis/prescription framing
- **Worker API** on Cloudflare (`POST /api/chat`) + mobile-friendly Spanish chat UI; Supabase Auth for access
- Clear separation: **ingest** · **retrieve** · **generate**

### Outcome

Working MVP: hybrid RAG over a private corpus, Workers + Supabase stack, eval notes for quality scoring. Suitable as a fullstack + AI portfolio piece (auth-gated product, not a public toy).

---

## Architecture

```
OsteoRAG/
├── corpus/                 # PDFs by folder (not versioned)
│   ├── escuela|libros|tesis/
│   └── MANIFEST.md         # Ingest priority
├── public/                 # Mobile chat UI
├── scripts/ingest.ts       # Extract → chunk → embed → upsert
├── src/
│   ├── api/chat.ts         # POST /api/chat
│   ├── lib/                # openai · expand · retrieve · generate · auth
│   ├── prompts/system.ts
│   └── index.ts            # Hono Worker
├── supabase/migrations/    # pgvector + hybrid keyword RPCs + chat history
├── wrangler.toml
└── package.json
```

---

## Stack

| Layer | Choice |
|---|---|
| Edge | Cloudflare Workers + static assets (Hono) |
| Data | Supabase Postgres + pgvector, Auth, RLS |
| Embeddings / chat | OpenAI-compatible (`text-embedding-3-small`, `gpt-4o-mini`) |
| Language | TypeScript |
| Ingest | Node 20+, pdf-parse, optional OCR |

---

## Setup (dev)

1. Create a Supabase project and run migrations in order under `supabase/migrations/`.
2. Copy `.env.example` → `.env` (and/or `.dev.vars` for Wrangler).  
   Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `OPENAI_API_KEY`.  
   Never put the service role key in the browser.
3. Place PDFs under `corpus/` per `MANIFEST.md` (PDFs are gitignored).
4. Install and run:

```bash
npm install
npm run ingest
npm run dev      # wrangler dev
npm run deploy   # wrangler deploy
```

Embedding dimension defaults to `vector(1536)` for `text-embedding-3-small` — change the migration + env if you use another model.

---

## Privacy & safety

- Corpus PDFs and secrets are **not** in git (`.gitignore` + Wrangler secrets).
- Product framing: study aid with citations — **not** a diagnostic or treatment tool.
- Auth gate on the chat UI; RLS deny-all for anon on sensitive tables in the MVP design.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run ingest` | Full corpus ingest |
| `npm run reingest-one` | Re-index a single file |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run deploy` | Deploy Worker |
