/**
 * Environment resolution shared by the build, the server, and the seed script.
 *
 * Database URL: accepts the names set automatically by hosting integrations, so the app works
 * whichever way the database was connected:
 *   DATABASE_URL (manual / Neon)  ·  NETLIFY_DB_URL (Netlify Database)
 *   NETLIFY_DATABASE_URL (legacy Netlify Neon extension)  ·  POSTGRES_PRISMA_URL / POSTGRES_URL (Vercel)
 * Direct URL (for migrations): DIRECT_URL, the unpooled variants above, or derived by removing "-pooler".
 */

type Env = Record<string, string | undefined>;

const DB_URL_KEYS = ['DATABASE_URL', 'NETLIFY_DB_URL', 'NETLIFY_DATABASE_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL'] as const;
const DIRECT_URL_KEYS = ['DIRECT_URL', 'NETLIFY_DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING', 'DATABASE_URL_UNPOOLED'] as const;

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

/** Neon pooled host "ep-x-pooler.region..." → direct host "ep-x.region..." */
export function deriveDirectUrl(databaseUrl: string): string {
  try {
    const u = new URL(databaseUrl);
    u.hostname = u.hostname.replace(/-pooler(?=\.)/, '');
    u.searchParams.delete('pgbouncer');
    return u.toString();
  } catch {
    return databaseUrl;
  }
}

export interface ResolvedEnv {
  databaseUrl: string | null;
  databaseUrlSource: string | null;
  directUrl: string | null;
  directUrlSource: string | null;
}

export function resolveDatabaseEnv(env: Env = process.env): ResolvedEnv {
  const dbKey = DB_URL_KEYS.find((k) => clean(env[k]));
  const databaseUrl = dbKey ? clean(env[dbKey])! : null;
  const directKey = DIRECT_URL_KEYS.find((k) => clean(env[k]));
  let directUrl = directKey ? clean(env[directKey])! : null;
  let directUrlSource: string | null = directKey ?? null;
  if (!directUrl && databaseUrl) {
    directUrl = deriveDirectUrl(databaseUrl);
    directUrlSource = `derived from ${dbKey}`;
  }
  return { databaseUrl, databaseUrlSource: dbKey ?? null, directUrl, directUrlSource };
}

/** Sets DATABASE_URL and DIRECT_URL (what Prisma reads) from whatever the host provided. */
export function applyDatabaseEnv(env: Env = process.env): ResolvedEnv {
  const r = resolveDatabaseEnv(env);
  if (r.databaseUrl && !clean(env.DATABASE_URL)) env.DATABASE_URL = r.databaseUrl;
  if (r.directUrl && !clean(env.DIRECT_URL)) env.DIRECT_URL = r.directUrl;
  return r;
}

/** Kept for existing callers */
export const ensureDirectUrl = (env: Env = process.env) => void applyDatabaseEnv(env);

/**
 * Session signing key. Uses AUTH_SECRET when set (recommended). Otherwise it is derived
 * from the database connection string, which already contains a strong secret (the DB
 * password): stable across deploys and servers, never stored in the repo. Anyone able to
 * read the database URL already has full access to the data, so this adds no new exposure.
 * Changing the database password logs everyone out, which is the desired behaviour.
 */
export async function sessionSecret(env: Env = process.env): Promise<{ key: Uint8Array; source: 'AUTH_SECRET' | 'derived' } | null> {
  const s = clean(env.AUTH_SECRET);
  if (s && s.length >= 32) return { key: new TextEncoder().encode(s), source: 'AUTH_SECRET' };
  const { databaseUrl } = resolveDatabaseEnv(env);
  if (!databaseUrl) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`rasd-session-key-v1\n${databaseUrl}`));
  return { key: new Uint8Array(digest), source: 'derived' };
}

/** Hide the password when a URL has to be printed in a build log. */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username}${u.password ? ':****' : ''}@${u.host}${u.pathname}`;
  } catch {
    return '(invalid URL)';
  }
}
