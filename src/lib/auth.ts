/**
 * Auth middleware: Bearer (Supabase JWT) preferred; Basic Auth fallback
 * while BASIC_AUTH_USER/PASS secrets remain set (emergency / transición).
 *
 * Para quitar Basic más adelante:
 *   wrangler secret delete BASIC_AUTH_USER
 *   wrangler secret delete BASIC_AUTH_PASS
 * (y borra del .dev.vars). La UI ya no usa Basic.
 */
import { createClient } from '@supabase/supabase-js';
import type { Context, MiddlewareHandler } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from './types';

export type AuthVariables = {
  /** owner_id for conversations (auth user uuid, or legacy CHAT_OWNER_ID) */
  ownerId: string;
  authMethod: 'bearer' | 'basic';
};

export type AppEnv = { Bindings: Env; Variables: AuthVariables };

function unauthorized(c: Context<AppEnv>, message = 'No autorizado') {
  return c.json({ error: message }, 401);
}

function bearerToken(req: Request): string | null {
  const h = req.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/** Verify Supabase access token → user id (sub). */
async function verifySupabaseJwt(
  token: string,
  env: Env,
): Promise<string | null> {
  const url = (env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!url) return null;

  // 1) Prefer local verify with JWT secret (HS256)
  const secret = (env.SUPABASE_JWT_SECRET || '').trim();
  if (secret) {
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(secret),
        {
          algorithms: ['HS256'],
          audience: 'authenticated',
        },
      );
      const sub = typeof payload.sub === 'string' ? payload.sub : null;
      if (sub) return sub;
    } catch (err) {
      console.warn(
        'jwtVerify failed',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 2) Fallback: JWKS (ES256 / newer signing keys) if the project exposes it
  try {
    const jwks = createRemoteJWKSet(
      new URL(`${url}/auth/v1/.well-known/jwks.json`),
    );
    const { payload } = await jwtVerify(token, jwks, {
      audience: 'authenticated',
    });
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    if (sub) return sub;
  } catch {
    /* legacy HS256-only projects have no JWKS */
  }

  // 3) Fallback: Auth API getUser (anon or service role)
  const key =
    (env.SUPABASE_ANON_KEY || '').trim() ||
    (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!key) return null;

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user?.id) {
      console.warn('auth.getUser failed', error?.message);
      return null;
    }
    return data.user.id;
  } catch (err) {
    console.warn(
      'auth.getUser error',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function legacyOwnerId(env: Env): string {
  const v = (env.CHAT_OWNER_ID || '').trim();
  return v || 'katya';
}

function hasBasicSecrets(env: Env): boolean {
  return !!(env.BASIC_AUTH_USER && env.BASIC_AUTH_PASS);
}

function hasBearerCapability(env: Env): boolean {
  return !!(
    env.SUPABASE_URL &&
    (env.SUPABASE_JWT_SECRET ||
      env.SUPABASE_ANON_KEY ||
      env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

/**
 * Protect /api/* (except health + config — registered before this middleware).
 * Accepts Bearer JWT (preferred) or Basic if secrets still set.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const path = c.req.path;
  if (
    path === '/api/health' ||
    path === '/api/config' ||
    c.req.method === 'OPTIONS'
  ) {
    return next();
  }

  const token = bearerToken(c.req.raw);
  if (token) {
    if (!hasBearerCapability(c.env)) {
      return unauthorized(c, 'Auth Bearer no configurada en el servidor');
    }
    const userId = await verifySupabaseJwt(token, c.env);
    if (!userId) {
      return unauthorized(c, 'Token inválido o expirado');
    }
    c.set('ownerId', userId);
    c.set('authMethod', 'bearer');
    return next();
  }

  // Transición / emergencia: Basic Auth si los secrets siguen definidos
  if (hasBasicSecrets(c.env)) {
    const auth = basicAuth({
      username: c.env.BASIC_AUTH_USER!,
      password: c.env.BASIC_AUTH_PASS!,
    });
    return auth(c, async () => {
      c.set('ownerId', legacyOwnerId(c.env));
      c.set('authMethod', 'basic');
      await next();
    });
  }

  // Sin Basic y sin Bearer → exigir login
  if (hasBearerCapability(c.env)) {
    return unauthorized(c, 'Inicia sesión (Bearer token requerido)');
  }

  // Ningún auth configurado (dev abierto)
  c.set('ownerId', legacyOwnerId(c.env));
  c.set('authMethod', 'basic');
  return next();
};

/** Public config for the SPA (anon key is safe to expose). */
export async function handleConfig(c: Context<AppEnv>) {
  const url = (c.env.SUPABASE_URL || '').trim();
  const anon = (c.env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !anon) {
    return c.json(
      {
        error: 'Falta SUPABASE_URL o SUPABASE_ANON_KEY en el Worker',
        supabaseUrl: url || null,
        supabaseAnonKey: null,
      },
      500,
    );
  }
  return c.json({
    supabaseUrl: url,
    supabaseAnonKey: anon,
  });
}
