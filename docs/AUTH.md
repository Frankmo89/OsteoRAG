# OsteoRAG Auth (Supabase email/password)

## Flujo

1. La UI (`public/`) es **pública** (sin popup Basic del navegador).
2. Al cargar, pide `GET /api/config` → `{ supabaseUrl, supabaseAnonKey }`.
3. `supabase-js` (CDN) hace `signInWithPassword`; la sesión vive en `localStorage`.
4. Todas las llamadas a `/api/chat` y `/api/conversations*` llevan  
   `Authorization: Bearer <access_token>`.
5. El Worker verifica el JWT (`SUPABASE_JWT_SECRET` + jose, o JWKS, o `auth.getUser`)  
   y usa `sub` como `owner_id` del historial.

`/api/health` y `/api/config` quedan abiertos.

## Secrets / vars en Wrangler

Obligatorios (además de los ya existentes):

```bash
npx wrangler secret put SUPABASE_ANON_KEY
# Recomendado (Dashboard → Settings → API → JWT Secret):
npx wrangler secret put SUPABASE_JWT_SECRET
```

Ya debían existir: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`.

## Quitar Basic Auth (cuando Katya solo use login)

```bash
npx wrangler secret delete BASIC_AUTH_USER
npx wrangler secret delete BASIC_AUTH_PASS
# y bórralos de .dev.vars local
```

Mientras existan, el Worker acepta **Basic OR Bearer** (emergencia / scripts).

## Migrar historial legado `owner_id = 'katya'`

Si había filas con el owner textual `katya`, tras crear el usuario Auth:

```sql
UPDATE public.conversations
SET owner_id = '<AUTH_USER_UUID>'
WHERE owner_id = 'katya';
```

## Email Auth

Provider **Email** debe estar habilitado en Authentication → Providers  
(`disable_signup` puede quedarse en false o true; el alta de Katya se hace por admin/SQL).
