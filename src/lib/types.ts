export type SourceFolder = 'escuela' | 'libros' | 'tesis';
export type FolderFilter = SourceFolder | 'all';

export interface ChatRequestBody {
  message: string;
  folderFilter?: FolderFilter;
}

export interface Citation {
  title: string;
  page: number | null;
  source_folder: SourceFolder | string;
  excerpt: string;
}

export interface ChatResponseBody {
  answer: string;
  citations: Citation[];
}

export interface RetrievedChunk {
  id: string;
  document_id: string;
  content: string;
  page_start: number | null;
  page_end: number | null;
  metadata: Record<string, unknown>;
  title: string;
  source_folder: string;
  similarity: number;
}

/** Bindings Cloudflare Worker + vars */
export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Anon/publishable key — JWT verify (getUser) + /api/config para el cliente */
  SUPABASE_ANON_KEY?: string;
  /** JWT secret del proyecto (Dashboard → Settings → API). Preferido para verificar Bearer. */
  SUPABASE_JWT_SECRET?: string;
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL?: string;
  EMBEDDING_MODEL: string;
  CHAT_MODEL: string;
  EMBEDDING_DIM?: string;
  TOP_K?: string;
  /** Umbral mínimo de similitud coseno (0–1). Por defecto 0.32 */
  MIN_SIMILARITY?: string;
  /**
   * Transición / emergencia: si ambos existen, el Worker aún acepta HTTP Basic
   * (además de Bearer). La UI ya no usa Basic. Quitar secrets cuando Katya use solo login.
   */
  BASIC_AUTH_USER?: string;
  BASIC_AUTH_PASS?: string;
  /** Owner legado solo para Basic Auth (default 'katya'). Con Bearer se usa auth.uid. */
  CHAT_OWNER_ID?: string;
}
