import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Db } from './db';
import type { Actor } from './actor';

type Tx = Prisma.TransactionClient;

// مفتاح قفل ثابت يجعل كتابة السلسلة متسلسلة حتى لا تتفرع عند الكتابة المتزامنة.
const AUDIT_LOCK_KEY = 7302001;
export const GENESIS_HASH = 'GENESIS';

/** JSON ثابت الترتيب حتى تعطي نفس البيانات نفس البصمة بعد قراءتها من JSONB */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** يحوّل التواريخ و Decimal إلى قيم JSON عادية قبل التخزين والتجزئة */
export function toPlainJson(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface AuditRecordFields {
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export function computeAuditHash(prevHash: string, fields: AuditRecordFields): string {
  return createHash('sha256').update(prevHash).update('\n').update(canonicalJson(fields)).digest('hex');
}

export interface AuditInput {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * يكتب سجل تدقيق داخل نفس Transaction العملية التجارية،
 * فإذا فشلت العملية لا يبقى سجل، وإذا نجحت لا يمكن أن يغيب السجل.
 */
export async function writeAudit(tx: Tx, actor: Pick<Actor, 'id' | 'ip' | 'userAgent'> | null, input: AuditInput) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY}::bigint)`;
  const last = await tx.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } });
  const prevHash = last?.hash ?? GENESIS_HASH;
  const createdAt = new Date();
  const fields: AuditRecordFields = {
    userId: actor?.id ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: toPlainJson(input.before),
    after: toPlainJson(input.after),
    ip: actor?.ip ?? null,
    userAgent: actor?.userAgent ? actor.userAgent.slice(0, 300) : null,
    createdAt: createdAt.toISOString(),
  };
  const hash = computeAuditHash(prevHash, fields);
  await tx.auditLog.create({
    data: {
      userId: fields.userId,
      action: fields.action,
      entityType: fields.entityType,
      entityId: fields.entityId,
      before: fields.before ?? Prisma.JsonNull,
      after: fields.after ?? Prisma.JsonNull,
      ip: fields.ip,
      userAgent: fields.userAgent,
      prevHash,
      hash,
      createdAt,
    },
  });
}

export interface AuditVerifyResult {
  ok: boolean;
  checked: number;
  brokenAtId: number | null;
  reason: string | null;
}

/** يعيد حساب السلسلة كاملة ويُبلغ عن أول سجل لا تتطابق بصمته */
export async function verifyAuditChain(db: Db): Promise<AuditVerifyResult> {
  let prevHash = GENESIS_HASH;
  let cursor = 0;
  let checked = 0;
  const pageSize = 1000;
  for (;;) {
    const rows = await db.auditLog.findMany({ where: { id: { gt: cursor } }, orderBy: { id: 'asc' }, take: pageSize });
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.prevHash !== prevHash) {
        return { ok: false, checked, brokenAtId: r.id, reason: 'الرابط مع السجل السابق مكسور (حُذف أو أُدرج سجل)' };
      }
      const expected = computeAuditHash(prevHash, {
        userId: r.userId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: r.before ?? null,
        after: r.after ?? null,
        ip: r.ip,
        userAgent: r.userAgent,
        createdAt: r.createdAt.toISOString(),
      });
      if (expected !== r.hash) {
        return { ok: false, checked, brokenAtId: r.id, reason: 'محتوى السجل عُدّل بعد كتابته' };
      }
      prevHash = r.hash;
      checked++;
      cursor = r.id;
    }
  }
  return { ok: true, checked, brokenAtId: null, reason: null };
}
