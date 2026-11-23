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
import { deriveDirectUrl, maskUrl } from '../src/lib/env';
import { passwordSchema } from '../src/lib/validation';

type Env = Record<string, string | undefined>;
const env: Env = { ...process.env };
const problems: string[] = [];

function step(title: string) {
  console.log(`\n▶ ${title}`);
}

// ─── 1) Environment checks ──────────────────────────────────────
step('Checking environment variables');

const db = env.DATABASE_URL?.trim();
if (!db) {
  problems.push('DATABASE_URL is not set. Add your Neon connection string (the one with "-pooler") in Netlify → Site configuration → Environment variables.');
} else if (!/^postgres(ql)?:\/\//.test(db)) {
  problems.push('DATABASE_URL must start with postgresql:// (copy it from Neon → Connect).');
} else {
  console.log(`  DATABASE_URL = ${maskUrl(db)}`);
  if (!env.DIRECT_URL?.trim()) {
    env.DIRECT_URL = deriveDirectUrl(db);
    console.log(`  DIRECT_URL was not set → derived from DATABASE_URL: ${maskUrl(env.DIRECT_URL)}`);
  } else {
    console.log(`  DIRECT_URL   = ${maskUrl(env.DIRECT_URL)}`);
  }
}

const secret = env.AUTH_SECRET ?? '';
if (secret.length < 32) {
  problems.push(
    `AUTH_SECRET is ${secret ? `only ${secret.length} characters` : 'not set'}. It must be a random string of at least 32 characters (48+ recommended), otherwise nobody can log in.`,
  );
} else {
  console.log(`  AUTH_SECRET  = set (${secret.length} characters)`);
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
  console.error('\nFix these in Netlify → Site configuration → Environment variables, then trigger a new deploy.\n');
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
