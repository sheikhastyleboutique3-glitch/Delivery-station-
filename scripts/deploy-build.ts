/**
 * Production build used by Netlify / Vercel (`npm run deploy-build`).
 *
 * 1. Checks the environment variables and stops with a clear message if something is missing.
 * 2. Derives DIRECT_URL from DATABASE_URL when it was not set (Neon: removes "-pooler").
 * 3. Applies database migrations (never deletes data).
 * 4. If SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are set, creates the first admin account
 *    (only if it does not exist yet; demo data only when SEED_DEMO=true).
 * 5. Builds the Next.js app.
 */
import { spawnSync } from 'node:child_process';
import { applyDatabaseEnv, maskUrl } from '../src/lib/env';
import { passwordSchema } from '../src/lib/validation';

type Env = Record<string, string | undefined>;
const env: Env = { ...process.env };
const problems: string[] = [];

function step(title: string) {
  console.log(`\n▶ ${title}`);
}

// ─── 1) Environment checks ──────────────────────────────────────
step('Checking environment variables');

const resolved = applyDatabaseEnv(env);
if (!resolved.databaseUrl) {
  problems.push(
    [
      'No database is connected. Do ONE of these in Netlify, then redeploy:',
      '      a) Add an environment variable DATABASE_URL = your Neon connection string (Neon → Connect, the one with "-pooler"), or',
      '      b) Connect a database with Netlify\'s Neon / Netlify DB integration (it sets NETLIFY_DATABASE_URL / NETLIFY_DB_URL automatically).',
    ].join('\n'),
  );
} else if (!/^postgres(ql)?:\/\//.test(resolved.databaseUrl)) {
  problems.push(`${resolved.databaseUrlSource} must start with postgresql:// (copy it from Neon → Connect).`);
} else {
  console.log(`  Database     = ${maskUrl(resolved.databaseUrl)}  (from ${resolved.databaseUrlSource})`);
  console.log(`  Direct URL   = ${maskUrl(resolved.directUrl!)}  (${resolved.directUrlSource})`);
}

const secret = env.AUTH_SECRET?.trim() ?? '';
if (secret && secret.length < 32) {
  problems.push(`AUTH_SECRET is only ${secret.length} characters. Use at least 32 (48+ recommended), or delete it to use the automatic key.`);
} else if (secret) {
  console.log(`  AUTH_SECRET  = set (${secret.length} characters)`);
} else if (resolved.databaseUrl) {
  console.log('  AUTH_SECRET  = not set → sessions are signed with a key derived from the database credentials (works; setting AUTH_SECRET is still recommended)');
}

const seedEmail = env.SEED_ADMIN_EMAIL?.trim();
const seedPassword = env.SEED_ADMIN_PASSWORD ?? '';
const wantsSeed = !!seedEmail || !!seedPassword;
if (wantsSeed) {
  if (!seedEmail || !seedPassword) {
    problems.push('Set both SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (or neither).');
  } else {
    const p = passwordSchema.safeParse(seedPassword);
    if (!p.success) problems.push(`SEED_ADMIN_PASSWORD is too weak: ${p.error.issues[0]?.message} (min 8 characters, letters and digits).`);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(seedEmail)) problems.push('SEED_ADMIN_EMAIL is not a valid email address.');
  }
}

if (problems.length) {
  console.error('\n✗ The build cannot continue:\n');
  for (const p of problems) console.error(`  • ${p}`);
  console.error('\nNetlify → Site configuration → Environment variables, then Deploys → Trigger deploy.\n');
  process.exit(1);
}

// ─── 2..5) Run the build steps ──────────────────────────────────
function run(title: string, cmd: string, args: string[], extraEnv: Env = {}) {
  step(title);
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...env, ...extraEnv } as NodeJS.ProcessEnv, shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`\n✗ "${title}" failed (exit code ${r.status ?? r.signal}).`);
    process.exit(r.status ?? 1);
  }
}

run('Generating Prisma client', 'npx', ['prisma', 'generate']);
run('Applying database migrations', 'npx', ['prisma', 'migrate', 'deploy']);

if (wantsSeed) {
  // Use the direct connection for the one-off seed, and never add demo data unless asked.
  run('Creating the first admin account (skipped if it already exists)', 'npx', ['tsx', 'prisma/seed.ts'], {
    DATABASE_URL: env.DIRECT_URL,
    SEED_DEMO: env.SEED_DEMO?.trim() || 'false',
  });
} else {
  step('Admin account: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set → skipped (run the "Database" GitHub Action to create it)');
}

run('Building the Next.js app', 'npx', ['next', 'build']);
console.log('\n✓ Deploy build finished');
