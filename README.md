# OsteoRAG (MVP)

Asistente **privado** de estudio/clínica para osteopatía basado en RAG (recuperación + generación).  
**No diagnostica ni prescribe tratamientos.** Las respuestas deben citar el corpus.

Stack: **Cloudflare Workers** (Hono + assets estáticos) · **Supabase** (Auth-ready, Postgres + **pgvector**) · **TypeScript** · API **OpenAI-compatible** (embeddings + chat).

## Estructura

```
OsteoRAG/
├── corpus/                 # PDFs por carpeta (no versionados)
│   ├── escuela|libros|tesis/
│   └── MANIFEST.md         # Prioridad de ingestión
├── public/                 # UI chat móvil (ES)
├── scripts/ingest.ts       # Extract → chunk → embed → upsert
├── src/
│   ├── api/chat.ts         # POST /api/chat
│   ├── lib/                # openai · expand · retrieve · generate · types
│   ├── prompts/system.ts
│   └── index.ts            # Worker Hono
├── supabase/migrations/
│   ├── 001_init.sql
│   └── 002_keyword_search.sql   # hybrid keyword RPC
├── wrangler.toml
├── .env.example
└── package.json
```

Límites claros: **ingest** (script) · **retrieve** (`src/lib/retrieve.ts`) · **generate** (`src/lib/generate.ts`).

## Requisitos

- Node 20+
- Cuenta [Supabase](https://supabase.com) y [Cloudflare](https://workers.cloudflare.com)
- Clave de API OpenAI-compatible (embeddings + chat)

## 1. Supabase

1. Crea un proyecto.
2. SQL Editor → ejecuta en orden:
   - `supabase/migrations/001_init.sql` (esquema + `match_chunks`)
   - `supabase/migrations/002_keyword_search.sql` (FTS + `keyword_chunks` para hybrid retrieve)  
   (o CLI: `supabase db push` si usas el CLI vinculado).
3. Copia **Project URL**, **anon key** y **service_role key** (Settings → API).  
   El **service_role** solo para el Worker y `npm run ingest` (nunca en el navegador).
4. Auth queda listo para Fase 2; el MVP usa service role en servidor y RLS deny-all para `anon`/`authenticated`.

### Dimensión de embeddings

La migración define `embedding vector(1536)` (adecuado para `text-embedding-3-small`).  
Si usas otro modelo/dimensión:

1. Cambia `vector(1536)` y la firma de `match_chunks` en la migración (o nueva migración).
2. Ajusta `EMBEDDING_DIM` / modelo en `.env` y `wrangler` vars.

## 2. Variables de entorno

```bash
cp .env.example .env
# Edita .env con tus claves

# Para wrangler dev, también puedes usar .dev.vars (mismo formato KEY=value)
```

Variables clave:

| Variable | Uso |
|----------|-----|
| `SUPABASE_URL` | API Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Ingest + Worker (bypassa RLS) |
| `OPENAI_API_KEY` | Embeddings + chat |
| `OPENAI_BASE_URL` | Opcional (proxy / compatible) |
| `EMBEDDING_MODEL` | p.ej. `text-embedding-3-small` |
| `CHAT_MODEL` | p.ej. `gpt-4o-mini` |
| `OCR_MODE` | `auto` (default) · `tesseract` · `openai` · `off` |
| `OCR_MAX_PAGES` | Máx. páginas OCR por PDF (default 40) |
| `OCR_CHAT_MODEL` | Modelo visión OCR (default = `CHAT_MODEL`) |
| `MIN_SIMILARITY` | Umbral coseno post-merge (default 0.32) |

## 3. Corpus PDF

1. Lee `corpus/MANIFEST.md` (prioridad).
2. Copia PDFs a:
   - `corpus/escuela/`
   - `corpus/libros/` (p.ej. *ANATOMÍA FUNCIONAL PARA FISIOTERAPEUTAS.pdf*, Latarjet T1)
   - `corpus/tesis/`
3. Diferir KT grandes y PPTX enormes.

```bash
npm install
npm run ingest
```

El script: lee PDFs → texto con nº de página → chunks ~1200 / overlap 250 → embeddings → upsert en `documents` + `chunks`.

### OCR de PDFs escaneados

Si `pdf-parse` no extrae texto (o casi nada) pero el PDF tiene páginas, el ingest activa **OCR fallback**:

1. **Preferido (gratis/local):** `tesseract` + `pdftoppm` (paquetes `tesseract-ocr`, `tesseract-ocr-spa`, `poppler-utils`).
2. **Alternativa de pago:** `OCR_MODE=openai` — rasteriza con `pdftoppm` y envía hasta `OCR_MAX_PAGES` (default 40) a **gpt-4o-mini** (visión).  
   **⚠ Coste:** cada página es una llamada de visión; úsalo solo para los escaneados que fallaron (p. ej. con `--file`), no para todo el corpus.

```bash
# Ejemplo: re-ingerir un KT escaneado con OCR OpenAI
OCR_MODE=openai OCR_MAX_PAGES=40 npx tsx scripts/ingest.ts --file "corpus/libros/KT Adultos/k-taping en el drenaje linfatico.pdf"
```

`--file` acepta paths Windows, acentos (NFC/NFD) y rutas relativas bajo `corpus/`.

### Re-ingerir un solo archivo

Si un PDF no aparece en retrieve (p. ej. `Secuencia_TCS.pdf`), vuelve a indexarlo sin rehacer todo el corpus:

```bash
# Opción A — wrapper
chmod +x scripts/reingest-one.sh
./scripts/reingest-one.sh corpus/escuela/Secuencia_TCS.pdf

# Opción B — flag / env
npx tsx scripts/ingest.ts --file corpus/escuela/Secuencia_TCS.pdf
INGEST_ONLY=escuela/Secuencia_TCS.pdf npm run ingest
```

Requiere `.env` con `SUPABASE_*` y `OPENAI_*`. Idempotente por `storage_path` (borra chunks previos del documento).

## 4. Desarrollo local (Worker + UI)

```bash
npm install
# .dev.vars con las mismas claves que .env (sin export)
npx wrangler dev
```

Abre la URL local (p.ej. `http://127.0.0.1:8787`).  
UI en español: disclaimer, filtro de carpeta, chips de citas.  
API: `POST /api/chat` con `{ "message": "...", "folderFilter": "all"|"escuela"|"libros"|"tesis" }`.

Comprobar tipos:

```bash
npm run typecheck
```

## 5. Deploy

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put OPENAI_API_KEY
# opcionales:
# npx wrangler secret put OPENAI_BASE_URL

npm run deploy
```

Vars públicas de modelo ya están en `wrangler.toml` (`EMBEDDING_MODEL`, `CHAT_MODEL`).

## API (resumen)

**POST `/api/chat`**

```json
{ "message": "¿Inserciones del músculo psoas?", "folderFilter": "libros" }
```

Respuesta:

```json
{
  "answer": "... texto en español con citas ...",
  "citations": [
    { "title": "...", "page": 42, "source_folder": "libros", "excerpt": "..." }
  ]
}
```

Sin hits útiles → mensaje de no encontrado en español (sin inventar).

### Recuperación hybrid

`src/lib/retrieve.ts` hace: expand query → multi-embed `match_chunks` → merge por id → **pase keyword** (`keyword_chunks` o `ilike` cliente) sobre tokens clínicos (≥4 chars) → top-K.  
Los hits keyword reciben similitud ~0.34–0.40 (piso 0.36) para superar `MIN_SIMILARITY` sin ahogar resultados vectoriales. Requiere migración `002_keyword_search.sql`.

## Fase 2 (notas)

- Fotos / multimodal (más adelante).
- Auth de usuarios reales + políticas RLS por `user_id`.
- Sync Drive (`drive_file_id` ya existe en `documents`).
- Reindexado incremental.

## Licencia / privacidad

Repositorio **privado**. No subir PDFs ni claves. Los binarios del corpus están en `.gitignore`.
