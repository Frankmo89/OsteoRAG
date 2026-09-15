/**
 * Ingest: corpus/{escuela,libros,tesis}/*.pdf → extract → chunk → embed → Supabase.
 *
 * Uso: npm run ingest
 * Requiere .env con SUPABASE_* y OPENAI_*.
 *
 * Dependencias de Node (dev): pdf-parse, dotenv, tsx, @supabase/supabase-js
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

/** Cliente tipado de forma laxa (service role / ingest). */
type Db = SupabaseClient<any, 'public', any>;

const require = createRequire(import.meta.url);
// pdf-parse CJS
const pdfParse = require('pdf-parse') as (
  buf: Buffer,
  opts?: { pagerender?: (pageData: PdfPageData) => Promise<string> },
) => Promise<PdfData>;

interface PdfPageData {
  getTextContent: (opts?: {
    normalizeWhitespace?: boolean;
  }) => Promise<{ items: Array<{ str: string }> }>;
  pageIndex?: number;
}

interface PdfData {
  numpages: number;
  text: string;
}

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.dev.vars') });

const FOLDERS = ['escuela', 'libros', 'tesis'] as const;
type SourceFolder = (typeof FOLDERS)[number];

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '1200', 10);
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || '250', 10);
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const OPENAI_BASE = (
  process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
).replace(/\/$/, '');
const CORPUS_DIR = path.resolve(
  process.cwd(),
  process.env.CORPUS_DIR || './corpus',
);

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta variable de entorno: ${name}`);
  return v;
}

interface PageText {
  page: number;
  text: string;
}



/** Quita null bytes y controles que rompen JSON/Postgres (\\u0000). */
function sanitizeForPostgres(s: string): string {
  return s
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\\u0000/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Colapsa OCR con letras espaciadas: "T E R A P I A" → "TERAPIA". */
function collapseLetterSpacedOCR(text: string): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 4) return text;

  const letter1 = /^[A-Za-zÁÉÍÓÚáéíóúÑñ]$/;
  const singleLetterCount = tokens.filter((t) => letter1.test(t)).length;
  if (singleLetterCount / tokens.length <= 0.4) {
    // Heurística ligera por secuencias: ≥4 letras sueltas consecutivas
    return text.replace(
      /(?:^|\s)([A-Za-zÁÉÍÓÚáéíóúÑñ](?:\s+[A-Za-zÁÉÍÓÚáéíóúÑñ]){3,})(?=\s|$)/g,
      (m) => ' ' + m.replace(/\s+/g, '').trim(),
    ).replace(/\s+/g, ' ').trim();
  }

  // >40% tokens son letras sueltas → unir runs consecutivos de letras de longitud 1
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.length >= 2) out.push(run.join(''));
    else out.push(run[0]!);
    run = [];
  };
  for (const t of tokens) {
    if (letter1.test(t)) {
      run.push(t);
    } else {
      flush();
      out.push(t);
    }
  }
  flush();
  return out.join(' ');
}

/** Extrae texto por página con pdf-parse pagerender. */
async function extractPages(buf: Buffer): Promise<{ pages: PageText[]; pageCount: number }> {
  const pages: PageText[] = [];
  let pageCounter = 0;

  const data = await pdfParse(buf, {
    pagerender: async (pageData) => {
      pageCounter += 1;
      const content = await pageData.getTextContent({
        normalizeWhitespace: true,
      });
      const joined = content.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      const text = sanitizeForPostgres(collapseLetterSpacedOCR(joined));
      const pageNum = (pageData.pageIndex != null ? pageData.pageIndex + 1 : pageCounter);
      pages.push({ page: pageNum, text });
      return text;
    },
  });

  // Si pagerender no pobló (algunas versiones), fallback a texto monolítico
  if (pages.length === 0 && data.text?.trim()) {
    pages.push({ page: 1, text: sanitizeForPostgres(collapseLetterSpacedOCR(data.text.replace(/\s+/g, ' ').trim())) });
  }

  return { pages, pageCount: data.numpages || pages.length };
}

interface TextChunk {
  content: string;
  page_start: number;
  page_end: number;
}

function chunkPages(pages: PageText[]): TextChunk[] {
  // Concatenar con marcadores de página para asignar rangos
  const units: Array<{ char: string; page: number }> = [];
  for (const p of pages) {
    if (!p.text) continue;
    for (const ch of p.text) {
      units.push({ char: ch, page: p.page });
    }
    // Separador entre páginas
    for (const ch of '\n\n') {
      units.push({ char: ch, page: p.page });
    }
  }

  if (units.length === 0) return [];

  const chunks: TextChunk[] = [];
  let start = 0;
  const step = Math.max(1, CHUNK_SIZE - CHUNK_OVERLAP);

  while (start < units.length) {
    const end = Math.min(start + CHUNK_SIZE, units.length);
    const slice = units.slice(start, end);
    const content = slice
      .map((u) => u.char)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (content.length >= 40) {
      chunks.push({
        content: sanitizeForPostgres(content),
        page_start: slice[0]!.page,
        page_end: slice[slice.length - 1]!.page,
      });
    }
    if (end >= units.length) break;
    start += step;
  }
  return chunks;
}

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch(`${OPENAI_BASE}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`Embeddings ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
  };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function listPdfs(folder: SourceFolder): Promise<string[]> {
  const dir = path.join(CORPUS_DIR, folder);
  try {
    const entries = await readdir(dir);
    return entries
      .filter((f) => f.toLowerCase().endsWith('.pdf'))
      .map((f) => path.join(dir, f))
      .sort();
  } catch {
    return [];
  }
}

function titleFromPath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

async function upsertDocument(
  supabase: Db,
  opts: {
    title: string;
    source_folder: SourceFolder;
    storage_path: string;
    page_count: number;
  },
): Promise<string> {
  // Idempotencia por storage_path
  const { data: existing } = await supabase
    .from('documents')
    .select('id')
    .eq('storage_path', opts.storage_path)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from('documents')
      .update({
        title: opts.title,
        page_count: opts.page_count,
        status: 'processing',
      })
      .eq('id', existing.id);
    await supabase.from('chunks').delete().eq('document_id', existing.id);
    return existing.id as string;
  }

  const { data, error } = await supabase
    .from('documents')
    .insert({
      title: opts.title,
      source_folder: opts.source_folder,
      mime: 'application/pdf',
      storage_path: opts.storage_path,
      page_count: opts.page_count,
      status: 'processing',
    })
    .select('id')
    .single();

  if (error) throw new Error(`insert document: ${error.message}`);
  return data.id as string;
}

async function ingestFile(
  supabase: Db,
  apiKey: string,
  filePath: string,
  folder: SourceFolder,
): Promise<void> {
  const rel = path.relative(CORPUS_DIR, filePath);
  console.log(`→ ${rel}`);
  const buf = await readFile(filePath);
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
  const { pages, pageCount } = await extractPages(buf);
  const textChunks = chunkPages(pages);
  console.log(`  páginas=${pageCount} chunks=${textChunks.length} hash=${hash}`);

  if (textChunks.length === 0) {
    console.warn(`  (sin texto extraíble, se marca error)`);
    const docId = await upsertDocument(supabase, {
      title: titleFromPath(filePath),
      source_folder: folder,
      storage_path: rel,
      page_count: pageCount,
    });
    await supabase
      .from('documents')
      .update({ status: 'error' })
      .eq('id', docId);
    return;
  }

  const docId = await upsertDocument(supabase, {
    title: titleFromPath(filePath),
    source_folder: folder,
    storage_path: rel,
    page_count: pageCount,
  });

  const BATCH = 32;
  for (let i = 0; i < textChunks.length; i += BATCH) {
    const batch = textChunks.slice(i, i + BATCH);
    const embeddings = await embedBatch(
      batch.map((c) => c.content),
      apiKey,
    );
    const rows = batch.map((c, j) => ({
      document_id: docId,
      content: c.content,
      page_start: c.page_start,
      page_end: c.page_end,
      embedding: embeddings[j],
      metadata: {
        source_folder: folder,
        storage_path: rel,
        file_hash: hash,
        chunk_index: i + j,
      },
    }));
    const { error } = await supabase.from('chunks').insert(rows);
    if (error) throw new Error(`insert chunks: ${error.message}`);
    process.stdout.write(`  embed ${Math.min(i + BATCH, textChunks.length)}/${textChunks.length}\r`);
  }
  console.log(`  embed ${textChunks.length}/${textChunks.length} ok`);

  await supabase.from('documents').update({ status: 'ready' }).eq('id', docId);
}

async function main() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = requireEnv('OPENAI_API_KEY');

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Corpus: ${CORPUS_DIR}`);
  console.log(`Modelo embed: ${EMBEDDING_MODEL}`);
  console.log(`Chunk ${CHUNK_SIZE} / overlap ${CHUNK_OVERLAP}`);

  let total = 0;
  for (const folder of FOLDERS) {
    const files = await listPdfs(folder);
    console.log(`\n[${folder}] ${files.length} PDF(s)`);
    for (const f of files) {
      const s = await stat(f);
      if (!s.isFile()) continue;
      await ingestFile(supabase, apiKey, f, folder);
      total += 1;
    }
  }
  console.log(`\nListo. Documentos procesados: ${total}`);
  console.log('Ver prioridad en corpus/MANIFEST.md');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

