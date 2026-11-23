import type { Db } from '../db';
import { Errors } from '../errors';

const WINDOW_MS = 60_000; // نافذة دقيقة واحدة
const MAX_FAILURES = 5; // 5 محاولات فاشلة في الدقيقة
const LOCK_MS = 15 * 60_000; // ثم قفل 15 دقيقة

function keyFor(ip: string | null, email: string) {
  return `${ip ?? 'unknown'}|${email.toLowerCase()}`;
}

/** يرفض الطلب إذا كان المفتاح مقفلاً حالياً */
export async function assertNotLocked(db: Db, ip: string | null, email: string) {
  const row = await db.loginAttempt.findUnique({ where: { key: keyFor(ip, email) } });
  if (row?.lockedUntil && row.lockedUntil > new Date()) {
    const minutes = Math.ceil((row.lockedUntil.getTime() - Date.now()) / 60_000);
    throw Errors.rateLimited(`محاولات دخول فاشلة كثيرة. حاول بعد ${minutes} دقيقة`);
  }
}

export async function recordFailure(db: Db, ip: string | null, email: string) {
  const key = keyFor(ip, email);
  const now = new Date();
  await db.$transaction(async (tx) => {
    const row = await tx.loginAttempt.findUnique({ where: { key } });
    const inWindow = row && now.getTime() - row.windowStart.getTime() < WINDOW_MS;
    const failures = inWindow ? row.failures + 1 : 1;
    const lockedUntil = failures >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MS) : null;
    await tx.loginAttempt.upsert({
      where: { key },
      create: { key, failures, windowStart: now, lockedUntil },
      update: { failures, windowStart: inWindow ? row.windowStart : now, lockedUntil },
    });
  });
}

export async function clearFailures(db: Db, ip: string | null, email: string) {
  await db.loginAttempt.deleteMany({ where: { key: keyFor(ip, email) } });
}
