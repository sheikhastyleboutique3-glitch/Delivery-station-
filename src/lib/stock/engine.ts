import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Db } from '../db';
import type { Actor } from '../actor';
import { writeAudit, canonicalJson } from '../audit';
import { AppError, Errors, isRetryableTxError } from '../errors';
import {
  COLOR_META,
  OPERATION_PREFIX,
  findTransition,
  type MovementType,
  type OperationKind,
  type ScanSource,
  type StockColor,
} from '../domain';

export type Tx = Prisma.TransactionClient;

export interface ProductRef {
  id: string;
  name: string;
  trackUnits: boolean;
}

export interface MovementInput {
  type: MovementType;
  product: ProductRef;
  quantity: number;
  fromColor: StockColor | null;
  fromPointId: string | null;
  toColor: StockColor | null;
  toPointId: string | null;
  driverId?: string | null;
  customerId?: string | null;
  unitSerials?: string[];
  scannedBarcode?: string | null;
  scanSource?: ScanSource | null;
  reason?: string | null;
  notes?: string | null;
}

export interface OpContext {
  operationId: string;
  actor: Actor;
}

// ─── Balance primitives (atomic SQL, safe under concurrency) ─────────────

/**
 * ينقص الرصيد فقط إذا كان كافياً، في جملة UPDATE واحدة.
 * PostgreSQL يقفل الصف ويعيد تقييم الشرط بعد انتظار أي عملية متزامنة،
 * لذلك لا يمكن لطلبين أن يسحبا آخر وحدة معاً.
 */
async function decrementBalance(tx: Tx, product: ProductRef, pointId: string, color: StockColor, qty: number) {
  const rows = await tx.$queryRaw<{ quantity: number }[]>`
    UPDATE stock_color_balances
       SET quantity = quantity - ${qty}::int,
           nonzero_since = CASE WHEN quantity - ${qty}::int = 0 THEN NULL ELSE nonzero_since END,
           updated_at = now()
     WHERE product_id = ${product.id}
       AND delivery_point_id = ${pointId}
       AND color = ${color}::"StockColor"
       AND quantity >= ${qty}::int
    RETURNING quantity`;
  if (rows.length === 0) {
    const current = await tx.stockColorBalance.findUnique({
      where: { productId_deliveryPointId_color: { productId: product.id, deliveryPointId: pointId, color } },
      select: { quantity: true },
    });
    const available = current?.quantity ?? 0;
    throw Errors.insufficient(
      `الكمية المطلوبة (${qty}) من "${product.name}" أكبر من الرصيد المتوفر بحالة «${COLOR_META[color].label}» (${available})`,
      { productId: product.id, pointId, color, requested: qty, available },
    );
  }
}

async function incrementBalance(tx: Tx, productId: string, pointId: string, color: StockColor, qty: number) {
  await tx.$executeRaw`
    INSERT INTO stock_color_balances (id, product_id, delivery_point_id, color, quantity, nonzero_since, updated_at)
    VALUES (gen_random_uuid()::text, ${productId}, ${pointId}, ${color}::"StockColor", ${qty}::int, now(), now())
    ON CONFLICT (product_id, delivery_point_id, color) DO UPDATE
       SET quantity = stock_color_balances.quantity + EXCLUDED.quantity,
           nonzero_since = CASE WHEN stock_color_balances.quantity = 0 THEN now()
                                ELSE COALESCE(stock_color_balances.nonzero_since, now()) END,
           updated_at = now()`;
}

async function decrementCustody(tx: Tx, driverId: string, product: ProductRef, pointId: string, qty: number) {
  const rows = await tx.$queryRaw<{ quantity: number }[]>`
    UPDATE driver_custody
       SET quantity = quantity - ${qty}::int,
           nonzero_since = CASE WHEN quantity - ${qty}::int = 0 THEN NULL ELSE nonzero_since END,
           updated_at = now()
     WHERE driver_id = ${driverId}
       AND product_id = ${product.id}
       AND delivery_point_id = ${pointId}
       AND quantity >= ${qty}::int
    RETURNING quantity`;
  if (rows.length === 0) {
    throw Errors.insufficient(`الكمية (${qty}) من "${product.name}" أكبر من عهدة السائق`, {
      productId: product.id,
      driverId,
      pointId,
      requested: qty,
    });
  }
}

async function incrementCustody(tx: Tx, driverId: string, productId: string, pointId: string, qty: number) {
  await tx.$executeRaw`
    INSERT INTO driver_custody (id, driver_id, product_id, delivery_point_id, quantity, nonzero_since, updated_at)
    VALUES (gen_random_uuid()::text, ${driverId}, ${productId}, ${pointId}, ${qty}::int, now(), now())
    ON CONFLICT (driver_id, product_id, delivery_point_id) DO UPDATE
       SET quantity = driver_custody.quantity + EXCLUDED.quantity,
           nonzero_since = CASE WHEN driver_custody.quantity = 0 THEN now()
                                ELSE COALESCE(driver_custody.nonzero_since, now()) END,
           updated_at = now()`;
}

// ─── Individual units (track_units = true) ──────────────────────────────

async function moveUnits(tx: Tx, m: MovementInput, serials: string[]) {
  const { product } = m;
  if (!product.trackUnits) {
    if (serials.length > 0) throw Errors.validation(`المنتج "${product.name}" لا يُتتبع بالقطعة، لا ترسل أرقاماً تسلسلية`);
    return;
  }
  if (serials.length !== m.quantity) {
    throw Errors.validation(`المنتج "${product.name}" يُتتبع بالقطعة: يجب مسح ${m.quantity} رقم تسلسلي (تم مسح ${serials.length})`);
  }
  if (new Set(serials).size !== serials.length) {
    throw Errors.validation(`يوجد رقم تسلسلي مكرر في "${product.name}"`);
  }

  if (m.fromColor === null) {
    // إدخال جديد: إنشاء القطع
    try {
      await tx.inventoryUnit.createMany({
        data: serials.map((serial) => ({
          productId: product.id,
          serial,
          color: m.toColor,
          deliveryPointId: m.toPointId,
          driverId: m.toColor === 'BLUE' ? m.driverId ?? null : null,
        })),
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('أحد الأرقام التسلسلية مسجّل مسبقاً في النظام');
      }
      throw err;
    }
    return;
  }

  const expectedDriver = m.fromColor === 'BLUE' ? m.driverId ?? null : null;
  const res = await tx.inventoryUnit.updateMany({
    where: {
      serial: { in: serials },
      productId: product.id,
      color: m.fromColor,
      deliveryPointId: m.fromPointId,
      driverId: expectedDriver,
    },
    data: {
      color: m.toColor,
      deliveryPointId: m.toColor ? m.toPointId : null,
      driverId: m.toColor === 'BLUE' ? m.driverId ?? null : null,
      updatedAt: new Date(),
    },
  });
  if (res.count !== serials.length) {
    const found = await tx.inventoryUnit.findMany({ where: { serial: { in: serials } }, select: { serial: true } });
    const foundSet = new Set(found.map((u) => u.serial));
    const unknown = serials.filter((s) => !foundSet.has(s));
    throw Errors.badTransition(
      unknown.length
        ? `أرقام تسلسلية غير موجودة: ${unknown.join('، ')}`
        : `بعض القطع ليست في الحالة "${COLOR_META[m.fromColor].label}" في هذه النقطة/العهدة`,
      { serials, unknown },
    );
  }
}

// ─── The single entry point for every movement ──────────────────────────

/**
 * يطبّق حركة واحدة: يتحقق من مصفوفة الانتقالات والصلاحية، ثم يُنقص المصدر
 * ويزيد الوجهة ويحدّث العهدة والقطع، ثم يكتب سطر السجل. كل ذلك داخل tx.
 */
export async function applyMovement(tx: Tx, ctx: OpContext, m: MovementInput): Promise<void> {
  const transition = findTransition(m.type, m.fromColor, m.toColor);
  if (!transition) {
    throw Errors.badTransition(
      `انتقال غير مسموح: ${m.fromColor ? COLOR_META[m.fromColor].label : '—'} ← ${m.toColor ? COLOR_META[m.toColor].label : '—'}`,
      { type: m.type, from: m.fromColor, to: m.toColor },
    );
  }
  if (!transition.roles.includes(ctx.actor.role)) {
    throw Errors.forbidden(`ليست لديك صلاحية تنفيذ "${transition.label}"`);
  }
  if (transition.reasonRequired && !m.reason?.trim()) {
    throw Errors.validation(`السبب إلزامي لعملية "${transition.label}" (${m.product.name})`);
  }
  if (!Number.isInteger(m.quantity) || m.quantity <= 0) {
    throw Errors.validation('الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر');
  }
  if ((m.fromColor === 'BLUE' || m.toColor === 'BLUE') && !m.driverId) {
    throw Errors.validation('الحركة على اللون الأزرق تتطلب تحديد السائق');
  }
  if (m.type === 'TRANSFER' && m.fromPointId === m.toPointId) {
    throw Errors.validation('لا يمكن التحويل إلى نفس النقطة');
  }

  // ترتيب أقفال ثابت لكل العمليات يمنع الـ deadlock:
  // (1) صفوف العهدة أولاً، (2) ثم صفوف الأرصدة مرتبة بمفتاح (نقطة|لون).
  // الخدمات تعالج الأصناف بترتيب productId (انظر inLockOrder).
  if (m.fromColor === 'BLUE' && m.fromPointId) await decrementCustody(tx, m.driverId!, m.product, m.fromPointId, m.quantity);
  if (m.toColor === 'BLUE' && m.toPointId) await incrementCustody(tx, m.driverId!, m.product.id, m.toPointId, m.quantity);

  const balanceOps: { key: string; run: () => Promise<void> }[] = [];
  if (m.fromColor && m.fromPointId) {
    const [pt, c] = [m.fromPointId, m.fromColor];
    balanceOps.push({ key: `${pt}|${c}`, run: () => decrementBalance(tx, m.product, pt, c, m.quantity) });
  }
  if (m.toColor && m.toPointId) {
    const [pt, c] = [m.toPointId, m.toColor];
    balanceOps.push({ key: `${pt}|${c}`, run: async () => incrementBalance(tx, m.product.id, pt, c, m.quantity) });
  }
  balanceOps.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const op of balanceOps) await op.run();

  const serials = (m.unitSerials ?? []).map((s) => s.trim()).filter(Boolean);
  await moveUnits(tx, m, serials);

  await tx.stockMovement.create({
    data: {
      operationId: ctx.operationId,
      type: m.type,
      productId: m.product.id,
      quantity: m.quantity,
      fromColor: m.fromColor,
      fromPointId: m.fromPointId,
      toColor: m.toColor,
      toPointId: m.toPointId,
      driverId: m.driverId ?? null,
      customerId: m.customerId ?? null,
      unitSerials: m.product.trackUnits ? serials : [],
      scannedBarcode: m.scannedBarcode ?? null,
      scanSource: m.scanSource ?? null,
      reason: m.reason?.trim() || null,
      notes: m.notes?.trim() || null,
      performedById: ctx.actor.id,
    },
  });
}

/** يرتب أصناف العملية حسب المنتج (ترتيب مستقر) ليأخذ كل Transaction الأقفال بنفس الترتيب */
export function inLockOrder<T extends { productId: string }>(lines: T[]): T[] {
  return lines.map((l, i) => ({ l, i })).sort((a, b) => (a.l.productId < b.l.productId ? -1 : a.l.productId > b.l.productId ? 1 : a.i - b.i)).map((x) => x.l);
}

// ─── Custody allocation ─────────────────────────────────────────────────

export interface Allocation {
  pointId: string;
  quantity: number;
  serials: string[];
}

/**
 * يحدد من أي نقطة مصدر تُخصم كمية من عهدة السائق.
 * للمنتجات الكمية: الأقدم أولاً مع قفل الصفوف (FOR UPDATE).
 * للمنتجات المتتبعة بالقطعة: حسب موقع كل قطعة.
 */
export async function allocateFromCustody(
  tx: Tx,
  driverId: string,
  product: ProductRef,
  quantity: number,
  serials: string[],
  preferredPointId?: string | null,
): Promise<Allocation[]> {
  if (product.trackUnits && serials.length > 0) {
    const units = await tx.inventoryUnit.findMany({
      where: { serial: { in: serials }, productId: product.id, driverId, color: 'BLUE' },
      select: { serial: true, deliveryPointId: true },
    });
    if (units.length !== serials.length) {
      const have = new Set(units.map((u) => u.serial));
      const missing = serials.filter((s) => !have.has(s));
      throw Errors.badTransition(`قطع ليست في عهدة هذا السائق: ${missing.join('، ')}`, { missing });
    }
    const byPoint = new Map<string, string[]>();
    for (const u of units) {
      const list = byPoint.get(u.deliveryPointId!) ?? [];
      list.push(u.serial);
      byPoint.set(u.deliveryPointId!, list);
    }
    return [...byPoint.entries()].map(([pointId, s]) => ({ pointId, quantity: s.length, serials: s }));
  }

  const rows = await tx.$queryRaw<{ delivery_point_id: string; quantity: number }[]>`
    SELECT delivery_point_id, quantity
      FROM driver_custody
     WHERE driver_id = ${driverId} AND product_id = ${product.id} AND quantity > 0
     ORDER BY (delivery_point_id = ${preferredPointId ?? ''}) DESC, nonzero_since ASC NULLS LAST, delivery_point_id
       FOR UPDATE`;
  const total = rows.reduce((s, r) => s + r.quantity, 0);
  if (total < quantity) {
    throw Errors.insufficient(`عهدة السائق من "${product.name}" هي ${total} فقط، والمطلوب ${quantity}`, {
      productId: product.id,
      driverId,
      available: total,
      requested: quantity,
    });
  }
  const out: Allocation[] = [];
  let left = quantity;
  for (const r of rows) {
    if (left === 0) break;
    const take = Math.min(left, r.quantity);
    out.push({ pointId: r.delivery_point_id, quantity: take, serials: [] });
    left -= take;
  }
  return out;
}

// ─── Operation runner: idempotency + transaction + retry + audit ────────

export interface OperationSpec {
  kind: OperationKind;
  idempotencyKey: string;
  request: unknown;
  status?: 'COMPLETED' | 'PENDING_DRIVER_ACK';
  deliveryPointId?: string | null;
  toDeliveryPointId?: string | null;
  driverId?: string | null;
  customerId?: string | null;
  sourceOperationId?: string | null;
  reason?: string | null;
  notes?: string | null;
}

export const operationInclude = {
  movements: {
    orderBy: { movementNo: 'asc' },
    include: {
      product: { select: { id: true, name: true, sku: true, barcode: true, unit: true, trackUnits: true } },
      fromPoint: { select: { id: true, name: true } },
      toPoint: { select: { id: true, name: true } },
    },
  },
  deliveryPoint: { select: { id: true, name: true, code: true } },
  toDeliveryPoint: { select: { id: true, name: true, code: true } },
  driver: { select: { id: true, fullName: true, phone: true, vehiclePlate: true } },
  customer: { select: { id: true, name: true, phone: true, address: true } },
  performedBy: { select: { id: true, name: true } },
  acknowledgedBy: { select: { id: true, name: true } },
  settlement: true,
  sourceOperation: { select: { id: true, opNo: true, kind: true } },
  returns: { select: { id: true, opNo: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OperationInclude;

export type OperationWithDetails = Prisma.OperationGetPayload<{ include: typeof operationInclude }>;

export interface OperationResult {
  operation: OperationWithDetails;
  replayed: boolean;
}

function hashRequest(kind: OperationKind, request: unknown): string {
  return createHash('sha256').update(canonicalJson({ kind, request })).digest('hex');
}

async function replayExisting(db: Db, actor: Actor, key: string, requestHash: string): Promise<OperationResult | null> {
  const existing = await db.operation.findUnique({ where: { idempotencyKey: key }, include: operationInclude });
  if (!existing) return null;
  if (existing.performedById !== actor.id || existing.requestHash !== requestHash) {
    throw Errors.conflict('مفتاح منع التكرار (idempotency key) مستخدم مسبقاً لطلب مختلف');
  }
  return { operation: existing, replayed: true };
}

const MAX_ATTEMPTS = 5;

export async function runOperation(
  db: Db,
  actor: Actor,
  spec: OperationSpec,
  body: (tx: Tx, ctx: OpContext) => Promise<void>,
  after?: (tx: Tx, ctx: OpContext) => Promise<void>,
): Promise<OperationResult> {
  const requestHash = hashRequest(spec.kind, spec.request);
  const replay = await replayExisting(db, actor, spec.idempotencyKey, requestHash);
  if (replay) return replay;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const operationId = await db.$transaction(
        async (tx) => {
          const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('operation_no_seq') AS n`;
          const op = await tx.operation.create({
            data: {
              opNo: `${OPERATION_PREFIX[spec.kind]}-${String(n).padStart(6, '0')}`,
              kind: spec.kind,
              status: spec.status ?? 'COMPLETED',
              deliveryPointId: spec.deliveryPointId ?? null,
              toDeliveryPointId: spec.toDeliveryPointId ?? null,
              driverId: spec.driverId ?? null,
              customerId: spec.customerId ?? null,
              sourceOperationId: spec.sourceOperationId ?? null,
              reason: spec.reason?.trim() || null,
              notes: spec.notes?.trim() || null,
              idempotencyKey: spec.idempotencyKey,
              requestHash,
              performedById: actor.id,
            },
          });
          const ctx: OpContext = { operationId: op.id, actor };
          await body(tx, ctx);
          const count = await tx.stockMovement.count({ where: { operationId: op.id } });
          if (count === 0 && spec.kind !== 'SETTLEMENT') throw Errors.validation('العملية لا تحتوي أي حركة');
          if (after) await after(tx, ctx);
          await writeAudit(tx, actor, {
            action: `operation.${spec.kind.toLowerCase()}`,
            entityType: 'operation',
            entityId: op.id,
            after: { opNo: op.opNo, kind: spec.kind, request: spec.request, movements: count },
          });
          return op.id;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 30_000 },
      );
      const operation = await db.operation.findUniqueOrThrow({ where: { id: operationId }, include: operationInclude });
      return { operation, replayed: false };
    } catch (err) {
      lastError = err;
      if (err instanceof AppError) throw err;
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = String(err.meta?.target ?? '');
        if (target.includes('idempotency_key') || target.includes('idempotencyKey')) {
          // طلب مكرر وصل في نفس اللحظة: أعد نتيجة الطلب الأول
          const again = await replayExisting(db, actor, spec.idempotencyKey, requestHash);
          if (again) return again;
        }
        throw err;
      }
      if (isRetryableTxError(err) && attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 25 * 2 ** attempt + Math.random() * 60));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
