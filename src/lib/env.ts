/**
 * Neon gives two connection strings: a pooled one (host contains "-pooler") for the app,
 * and a direct one for migrations. If only DATABASE_URL is configured, derive the direct
 * one by removing "-pooler" from the host. For non-Neon databases the same URL is used.
 */
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

/** Prisma validates env("DIRECT_URL") even at runtime; make sure it always resolves. */
export function ensureDirectUrl(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.DIRECT_URL && env.DATABASE_URL) env.DIRECT_URL = deriveDirectUrl(env.DATABASE_URL);
}

/** Hide the password when a URL has to be printed in a build log. */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '****';
    return `${u.protocol}//${u.username}${u.password ? ':****' : ''}@${u.host}${u.pathname}`;
  } catch {
    return '(invalid URL)';
  }
}
