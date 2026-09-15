/**
 * Ingest: corpus/{escuela,libros,tesis}/*.pdf → extract → chunk → embed → Supabase.
 *
 * Uso: npm run ingest
 * Un solo archivo: npx tsx scripts/ingest.ts --file corpus/escuela/Secuencia_TCS.pdf
 *   o INGEST_ONLY=escuela/Secuencia_TCS.pdf npm run ingest
 * Requiere .env con SUPABASE_* y OPENAI_*.
 *
 * OCR (PDFs escaneados sin texto):
 *   - Si pdf-parse no extrae texto y hay páginas → OCR fallback.
 *   - Preferido: tesseract + pdftoppm (poppler-utils) en el PATH.
 *   - Alternativa: OCR_MODE=openai (gpt-4o-mini vision, hasta OCR_MAX_PAGES).
 *   - Rasterize: pdftoppm si existe; si no, pdfjs-dist + @napi-rs/canvas (sin poppler).
 *   Ver README (coste / requisitos).
 *
 * Dependencias de Node (dev): pdf-parse, pdfjs-dist, @napi-rs/canvas, dotenv, tsx
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
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
/** auto | tesseract | openai | off */
const OCR_MODE = (process.env.OCR_MODE || 'auto').toLowerCase();
const OCR_MAX_PAGES = Math.max(
  1,
  parseInt(process.env.OCR_MAX_PAGES || '40', 10) || 40,
);
const OCR_CHAT_MODEL = process.env.OCR_CHAT_MODEL || process.env.CHAT_MODEL || 'gpt-4o-mini';

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

function cleanPageText(raw: string): string {
  return sanitizeForPostgres(collapseLetterSpacedOCR(raw.replace(/\s+/g, ' ').trim()));
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
      const text = cleanPageText(joined);
      const pageNum = (pageData.pageIndex != null ? pageData.pageIndex + 1 : pageCounter);
      pages.push({ page: pageNum, text });
      return text;
    },
  });

  // Si pagerender no pobló (algunas versiones), fallback a texto monolítico
  if (pages.length === 0 && data.text?.trim()) {
    pages.push({ page: 1, text: cleanPageText(data.text) });
  }

  return { pages, pageCount: data.numpages || pages.length };
}

function totalExtractedChars(pages: PageText[]): number {
  return pages.reduce((n, p) => n + (p.text?.length || 0), 0);
}

/** Heurística: PDF con páginas pero casi sin texto (escaneado). */
function needsOcr(pages: PageText[], pageCount: number): boolean {
  if (pageCount <= 0) return false;
  if (OCR_MODE === 'off') return false;
  const chars = totalExtractedChars(pages);
  // < ~8 chars/página de media o total muy bajo
  return chars < Math.max(80, pageCount * 8);
}

function runCmd(
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      resolve({ code: 127, stdout, stderr: err.message });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function commandExists(cmd: string): Promise<boolean> {
  const r = await runCmd(process.platform === 'win32' ? 'where' : 'which', [cmd]);
  return r.code === 0;
}

/** Renderiza páginas PDF → PNG con pdftoppm (poppler). */
async function pdfToPngs(
  pdfPath: string,
  outDir: string,
  maxPages: number,
): Promise<string[]> {
  const prefix = path.join(outDir, 'page');
  const r = await runCmd('pdftoppm', [
    '-png',
    '-r',
    '150',
    '-f',
    '1',
    '-l',
    String(maxPages),
    pdfPath,
    prefix,
  ]);
  if (r.code !== 0) {
    throw new Error(`pdftoppm falló: ${r.stderr || r.stdout}`);
  }
  const names = (await readdir(outDir))
    .filter((n) => n.startsWith('page') && n.endsWith('.png'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return names.map((n) => path.join(outDir, n));
}

type NapiCanvas = {
  width: number;
  height: number;
  getContext: (type: '2d') => unknown;
  toBuffer: (mime: 'image/png') => Buffer;
};

type CanvasAndContext = { canvas: NapiCanvas; context: unknown };

/** CanvasFactory compatible with pdfjs-dist Node rendering (@napi-rs/canvas). */
class NapiCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const { createCanvas } = require('@napi-rs/canvas') as {
      createCanvas: (w: number, h: number) => NapiCanvas;
    };
    const canvas = createCanvas(
      Math.max(1, Math.ceil(width)),
      Math.max(1, Math.ceil(height)),
    );
    return { canvas, context: canvas.getContext('2d') };
  }

  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
    canvasAndContext.canvas.width = Math.max(1, Math.ceil(width));
    canvasAndContext.canvas.height = Math.max(1, Math.ceil(height));
  }

  destroy(canvasAndContext: CanvasAndContext): void {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (canvasAndContext as any).canvas = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (canvasAndContext as any).context = null;
  }
}

/**
 * Rasterize PDF → PNG buffers via pdfjs-dist (legacy) + @napi-rs/canvas.
 * No poppler/pdftoppm required — works on Windows without system OCR tools.
 */
async function pdfToPngsViaPdfjs(
  pdfPathOrBuf: string | Buffer,
  maxPages: number,
): Promise<Buffer[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerPath = path.join(
    process.cwd(),
    'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  );
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const data =
    typeof pdfPathOrBuf === 'string'
      ? new Uint8Array(await readFile(pdfPathOrBuf))
      : new Uint8Array(pdfPathOrBuf);

  const canvasFactory = new NapiCanvasFactory();
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    verbosity: 0,
    isEvalSupported: false,
    canvasFactory,
  } as Parameters<typeof pdfjs.getDocument>[0]).promise;

  const limit = Math.min(doc.numPages, Math.max(1, maxPages));
  const scale = 150 / 72; // ~150 DPI (same as pdftoppm -r 150)
  const buffers: Buffer[] = [];

  try {
    for (let pageNum = 1; pageNum <= limit; pageNum++) {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
      try {
        await page.render({
          canvasContext: canvasAndContext.context as never,
          viewport,
          canvas: canvasAndContext.canvas as never,
          canvasFactory,
        } as Parameters<typeof page.render>[0]).promise;
        buffers.push(canvasAndContext.canvas.toBuffer('image/png'));
      } finally {
        canvasFactory.destroy(canvasAndContext);
        page.cleanup();
      }
    }
  } finally {
    await doc.destroy();
  }

  return buffers;
}

/**
 * Prefer pdftoppm when available; otherwise Node pdfjs rasterize.
 * Returns PNG file paths under outDir (writes pdfjs buffers to disk).
 */
async function rasterizePdfToPngPaths(
  pdfPath: string,
  outDir: string,
  maxPages: number,
): Promise<{ paths: string[]; via: 'pdftoppm' | 'pdfjs' }> {
  const hasPpm = await commandExists('pdftoppm');
  if (hasPpm) {
    const paths = await pdfToPngs(pdfPath, outDir, maxPages);
    return { paths, via: 'pdftoppm' };
  }
  console.warn('  pdftoppm no disponible → rasterize con pdfjs-dist + @napi-rs/canvas');
  const buffers = await pdfToPngsViaPdfjs(pdfPath, maxPages);
  const paths: string[] = [];
  for (let i = 0; i < buffers.length; i++) {
    const p = path.join(outDir, `page-${String(i + 1).padStart(3, '0')}.png`);
    await writeFile(p, buffers[i]!);
    paths.push(p);
  }
  return { paths, via: 'pdfjs' };
}

async function ocrWithTesseract(
  pdfPath: string,
  pageCount: number,
): Promise<PageText[]> {
  const hasTess = await commandExists('tesseract');
  if (!hasTess) {
    throw new Error(
      'tesseract no disponible (instala tesseract-ocr + tesseract-ocr-spa)',
    );
  }
  const maxPages = Math.min(pageCount, OCR_MAX_PAGES);
  const dir = await mkdtemp(path.join(tmpdir(), 'osteorag-ocr-'));
  try {
    const { paths: images, via } = await rasterizePdfToPngPaths(
      pdfPath,
      dir,
      maxPages,
    );
    const pages: PageText[] = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i]!;
      const outBase = path.join(dir, `out-${i}`);
      const r = await runCmd('tesseract', [
        img,
        outBase,
        '-l',
        'spa+eng',
        '--psm',
        '1',
      ]);
      if (r.code !== 0) {
        console.warn(`  tesseract pág ${i + 1}: ${r.stderr.slice(0, 120)}`);
        pages.push({ page: i + 1, text: '' });
        continue;
      }
      const txt = await readFile(`${outBase}.txt`, 'utf8').catch(() => '');
      pages.push({ page: i + 1, text: cleanPageText(txt) });
      process.stdout.write(`  OCR tesseract ${i + 1}/${images.length}\r`);
    }
    console.log(`  OCR tesseract ${pages.length}/${maxPages} ok (raster=${via})`);
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(status: number, body: string): boolean {
  return status === 429 || /rate_limit_exceeded/i.test(body);
}

/** Prefer Retry-After header; else parse "try again in Xs" from body; else null. */
function parseRetryAfterMs(res: Response, body: string): number | null {
  const header = res.headers.get('retry-after');
  if (header) {
    const secs = parseFloat(header);
    if (Number.isFinite(secs) && secs >= 0) {
      return Math.min(Math.max(secs * 1000, 0), 30_000);
    }
    const when = Date.parse(header);
    if (Number.isFinite(when)) {
      return Math.min(Math.max(when - Date.now(), 0), 30_000);
    }
  }
  const m =
    body.match(/try again in ([\d.]+)\s*s/i) ||
    body.match(/Please try again in ([\d.]+)s/i);
  if (m?.[1]) {
    const secs = parseFloat(m[1]);
    if (Number.isFinite(secs)) {
      return Math.min(Math.max(secs * 1000, 0), 30_000);
    }
  }
  return null;
}

async function ocrPageWithOpenAI(
  apiKey: string,
  imageBuf: Buffer,
  pageNum: number,
): Promise<string> {
  const b64 = imageBuf.toString('base64');
  const maxAttempts = 6;
  let backoffMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OCR_CHAT_MODEL,
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Eres un OCR preciso. Extrae TODO el texto visible de esta página de un manual ' +
                  'clínico/osteopatía/kinesiotaping en español (o inglés). Conserva títulos y listas. ' +
                  'No inventes contenido. Solo el texto, sin comentarios.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${b64}`,
                  detail: 'high',
                },
              },
            ],
          },
        ],
      }),
    });

    if (res.ok) {
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return json.choices?.[0]?.message?.content?.trim() || '';
    }

    const errBody = await res.text();
    const rateLimited = isRateLimitError(res.status, errBody);
    if (rateLimited && attempt < maxAttempts) {
      const fromHeader = parseRetryAfterMs(res, errBody);
      const waitMs = fromHeader ?? backoffMs;
      console.warn(
        `  OCR OpenAI pág ${pageNum}: ${res.status} rate limit — reintento ${attempt}/${maxAttempts} en ${Math.round(waitMs)}ms`,
      );
      await sleep(waitMs);
      if (fromHeader == null) {
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
      continue;
    }

    throw new Error(`OCR OpenAI pág ${pageNum}: ${res.status} ${errBody}`);
  }

  throw new Error(`OCR OpenAI pág ${pageNum}: agotados ${maxAttempts} reintentos`);
}

async function ocrWithOpenAI(
  apiKey: string,
  pdfPath: string,
  pageCount: number,
): Promise<PageText[]> {
  const maxPages = Math.min(pageCount, OCR_MAX_PAGES);
  console.warn(
    `  ⚠ OCR OpenAI (${OCR_CHAT_MODEL}): hasta ${maxPages} págs — coste de visión API`,
  );
  const dir = await mkdtemp(path.join(tmpdir(), 'osteorag-ocr-ai-'));
  try {
    const { paths: images, via } = await rasterizePdfToPngPaths(
      pdfPath,
      dir,
      maxPages,
    );
    const pages: PageText[] = [];
    let failed = 0;
    for (let i = 0; i < images.length; i++) {
      const buf = await readFile(images[i]!);
      try {
        const text = await ocrPageWithOpenAI(apiKey, buf, i + 1);
        pages.push({ page: i + 1, text: cleanPageText(text) });
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `  ⚠ OCR OpenAI pág ${i + 1} falló tras reintentos — se omite (texto vacío): ${msg.slice(0, 180)}`,
        );
        pages.push({ page: i + 1, text: '' });
      }
      process.stdout.write(`  OCR openai ${i + 1}/${images.length}\r`);
      // Small delay between pages to reduce TPM spikes
      if (i < images.length - 1) {
        await sleep(200 + Math.floor(Math.random() * 201));
      }
    }
    const ok = pages.length - failed;
    console.log(
      `  OCR openai ${pages.length}/${maxPages} ok=${ok} fail=${failed} (raster=${via})`,
    );
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * OCR fallback: tesseract (preferido) o OpenAI vision según OCR_MODE.
 * Escribe el buffer a un PDF temporal si hace falta para pdftoppm.
 */
async function ocrPdfFallback(
  buf: Buffer,
  filePath: string,
  pageCount: number,
  apiKey: string,
): Promise<PageText[]> {
  const mode = OCR_MODE;
  const tryTess = mode === 'auto' || mode === 'tesseract';
  const tryOpenAi = mode === 'auto' || mode === 'openai';

  // Asegurar path PDF legible por pdftoppm (usar original si existe)
  let pdfPath = filePath;
  let tmpPdf: string | null = null;
  try {
    await stat(filePath);
  } catch {
    const dir = await mkdtemp(path.join(tmpdir(), 'osteorag-pdf-'));
    tmpPdf = path.join(dir, 'doc.pdf');
    await writeFile(tmpPdf, buf);
    pdfPath = tmpPdf;
  }

  try {
    if (tryTess) {
      try {
        return await ocrWithTesseract(pdfPath, pageCount);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  OCR tesseract no usable: ${msg}`);
        if (!tryOpenAi) throw err;
      }
    }
    if (tryOpenAi) {
      return await ocrWithOpenAI(apiKey, pdfPath, pageCount);
    }
    return [];
  } finally {
    if (tmpPdf) {
      await rm(path.dirname(tmpPdf), { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}

async function extractPagesWithOcr(
  buf: Buffer,
  filePath: string,
  apiKey: string,
): Promise<{ pages: PageText[]; pageCount: number; usedOcr: boolean }> {
  const { pages, pageCount } = await extractPages(buf);
  if (!needsOcr(pages, pageCount)) {
    return { pages, pageCount, usedOcr: false };
  }
  console.warn(
    `  (sin texto extraíble / escaso: ${totalExtractedChars(pages)} chars, ${pageCount} págs → OCR)`,
  );
  try {
    const ocrPages = await ocrPdfFallback(buf, filePath, pageCount, apiKey);
    const ocrChars = totalExtractedChars(ocrPages);
    if (ocrChars > totalExtractedChars(pages)) {
      return { pages: ocrPages, pageCount, usedOcr: true };
    }
    console.warn(`  OCR no mejoró el texto (${ocrChars} chars); se mantiene extract`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  OCR falló: ${msg}`);
  }
  return { pages, pageCount, usedOcr: false };
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
  const out: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(current, name);
      const s = await stat(full);
      if (s.isDirectory()) {
        await walk(full);
      } else if (s.isFile() && name.toLowerCase().endsWith('.pdf')) {
        out.push(full);
      }
    }
  }

  await walk(dir);
  return out.sort();
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
  const rel = path.relative(CORPUS_DIR, filePath).split(path.sep).join('/');
  console.log(`→ ${rel}`);
  const buf = await readFile(filePath);
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
  const { pages, pageCount, usedOcr } = await extractPagesWithOcr(
    buf,
    filePath,
    apiKey,
  );
  const textChunks = chunkPages(pages);
  console.log(
    `  páginas=${pageCount} chunks=${textChunks.length} hash=${hash}${usedOcr ? ' ocr=yes' : ''}`,
  );

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
        ...(usedOcr ? { ocr: true } : {}),
      },
    }));
    const { error } = await supabase.from('chunks').insert(rows);
    if (error) throw new Error(`insert chunks: ${error.message}`);
    process.stdout.write(`  embed ${Math.min(i + BATCH, textChunks.length)}/${textChunks.length}\r`);
  }
  console.log(`  embed ${textChunks.length}/${textChunks.length} ok`);

  await supabase.from('documents').update({ status: 'ready' }).eq('id', docId);
}

/** Normaliza separadores y forma Unicode (NFC/NFD) para paths con acentos. */
function pathVariants(p: string): string[] {
  const unified = p.replace(/\\/g, '/');
  const native = unified.split('/').join(path.sep);
  const out = new Set<string>([
    p,
    unified,
    native,
    p.normalize('NFC'),
    p.normalize('NFD'),
    unified.normalize('NFC'),
    unified.normalize('NFD'),
    native.normalize('NFC'),
    native.normalize('NFD'),
  ]);
  return [...out];
}

function foldKey(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

/** Resuelve un path candidato probando NFC/NFD y separadores. */
async function resolveExistingFile(candidate: string): Promise<string | null> {
  for (const v of pathVariants(candidate)) {
    if (await fileExists(v)) return v;
  }
  return null;
}

/**
 * Busca bajo corpus un PDF cuyo path relativo coincida (acentos / mayúsculas).
 */
async function findUnderCorpus(relHint: string): Promise<string | null> {
  const hint = relHint.replace(/\\/g, '/').replace(/^\.?\//, '');
  const hintFold = foldKey(hint);
  const hintBase = foldKey(path.posix.basename(hint));

  for (const folder of FOLDERS) {
    const files = await listPdfs(folder);
    for (const full of files) {
      const rel = path.relative(CORPUS_DIR, full).split(path.sep).join('/');
      const relFold = foldKey(rel);
      if (
        relFold === hintFold ||
        relFold.endsWith('/' + hintFold) ||
        relFold === hintFold.replace(/^corpus\//, '') ||
        foldKey(path.basename(full)) === hintBase
      ) {
        // Prefer exact-ish folder match when hint includes folder
        if (hintFold.includes(folder) || !hint.includes('/')) {
          return full;
        }
        return full;
      }
    }
  }
  // Segunda pasada: solo basename
  for (const folder of FOLDERS) {
    const files = await listPdfs(folder);
    for (const full of files) {
      if (foldKey(path.basename(full)) === hintBase) return full;
    }
  }
  return null;
}

/**
 * Re-ingesta un solo PDF.
 * Uso:
 *   npx tsx scripts/ingest.ts --file corpus/escuela/Secuencia_TCS.pdf
 *   INGEST_ONLY=escuela/Secuencia_TCS.pdf npm run ingest
 *
 * Acepta paths Windows (C:\…), acentos (NFC/NFD) y relativos bajo corpus/.
 */
async function resolveOnlyFile(): Promise<{
  folder: SourceFolder;
  filePath: string;
} | null> {
  const argv = process.argv.slice(2);
  const flagIdx = argv.indexOf('--file');
  const fromFlag = flagIdx >= 0 ? argv[flagIdx + 1] : undefined;
  const only = (fromFlag || process.env.INGEST_ONLY || '').trim();
  if (!only) return null;

  const normalized = only.replace(/\\/g, '/');

  // Candidatos absolutos / relativos
  const candidates: string[] = [];
  const looksAbs =
    path.isAbsolute(only) ||
    path.isAbsolute(normalized) ||
    /^[A-Za-z]:[\\/]/.test(only) ||
    /^[A-Za-z]:[\\/]/.test(normalized);

  if (looksAbs) {
    // En Linux, un path Windows absoluto no es usable: extraer cola corpus/…
    const corpusIdx = normalized.toLowerCase().indexOf('/corpus/');
    const corpusIdx2 = normalized.toLowerCase().indexOf('corpus/');
    if (corpusIdx >= 0) {
      candidates.push(path.resolve(process.cwd(), normalized.slice(corpusIdx + 1)));
      candidates.push(path.join(CORPUS_DIR, normalized.slice(corpusIdx + '/corpus/'.length)));
    } else if (corpusIdx2 >= 0) {
      candidates.push(path.resolve(process.cwd(), normalized.slice(corpusIdx2)));
      candidates.push(
        path.join(CORPUS_DIR, normalized.slice(corpusIdx2 + 'corpus/'.length)),
      );
    }
    candidates.push(only, normalized);
  } else {
    candidates.push(
      path.resolve(process.cwd(), normalized),
      path.resolve(
        process.cwd(),
        normalized.startsWith('corpus/') ? normalized : path.posix.join('corpus', normalized),
      ),
      path.join(
        CORPUS_DIR,
        normalized.replace(/^corpus\//i, ''),
      ),
    );
  }

  let abs: string | null = null;
  for (const c of candidates) {
    abs = await resolveExistingFile(c);
    if (abs) break;
  }
  if (!abs) {
    abs = await findUnderCorpus(normalized);
  }
  if (!abs) {
    throw new Error(
      `No se encontró el PDF (revisa acentos/path): ${only}`,
    );
  }

  const rel = path.relative(CORPUS_DIR, abs);
  if (rel.startsWith('..')) {
    // Fuera de corpus: intentar mapear por basename
    const found = await findUnderCorpus(path.basename(abs));
    if (!found) {
      throw new Error(
        `INGEST_ONLY/--file debe estar bajo corpus/{escuela,libros,tesis}/… (recibido: ${abs})`,
      );
    }
    abs = found;
  }

  const relFinal = path.relative(CORPUS_DIR, abs);
  const parts = relFinal.split(path.sep);
  const folder = parts[0] as SourceFolder;
  if (!FOLDERS.includes(folder)) {
    throw new Error(
      `INGEST_ONLY/--file debe estar bajo corpus/{escuela,libros,tesis}/… (recibido: ${relFinal})`,
    );
  }
  if (!abs.toLowerCase().endsWith('.pdf')) {
    throw new Error(`El archivo debe ser PDF: ${abs}`);
  }
  return { folder, filePath: abs };
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
  console.log(`OCR_MODE=${OCR_MODE} OCR_MAX_PAGES=${OCR_MAX_PAGES}`);

  const only = await resolveOnlyFile();
  if (only) {
    console.log(`\n[solo] ${path.relative(CORPUS_DIR, only.filePath)}`);
    const s = await stat(only.filePath);
    if (!s.isFile()) throw new Error(`No es un archivo: ${only.filePath}`);
    await ingestFile(supabase, apiKey, only.filePath, only.folder);
    console.log('\nListo. Documentos procesados: 1');
    return;
  }

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
