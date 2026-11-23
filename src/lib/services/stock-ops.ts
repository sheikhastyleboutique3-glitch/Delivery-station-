import type { Db } from '../db';
import { assertDriverSelf, assertPointAccess, requireRole, type Actor } from '../actor';
import { Errors } from '../errors';
import { writeAudit } from '../audit';
import { getSettings } from '../settings';
import {
  allocateFromCustody,
  applyMovement,
  inLockOrder,
  runOperation,
  type OperationResult,
  type ProductRef,
  type Tx,
} from '../stock/engine';
import {
  customerReturnSchema,
  deliverSchema,
  dispatchSchema,
  resolveRedSchema,
  returnSchema,
  settleSchema,
  sortSchema,
  statusChangeSchema,
  stockInSchema,
  transferSchema,
} from '../validation';
import type { Role } from '../domain';
import { recordDeliveryActivity, recordDispatchActivity } from '../hr/activity';

const STAFF: Role[] = ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER'];

// ─── Helpers ────────────────────────────────────────────────────

async function loadProducts(db: Db | Tx, ids: string[], opts: { forbidArchived: boolean }): Promise<Map<string, ProductRef>> {
  const unique = [...new Set(ids)];
  const rows = await db.product.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, trackUnits: true, isArchived: true },
  });
  if (rows.length !== unique.length) throw Errors.notFound('أحد المنتجات');
  if (opts.forbidArchived) {
    const archived = rows.find((r) => r.isArchived);
    if (archived) throw Errors.validation(`المنتج "${archived.name}" مؤرشف ولا يمكن إدخاله أو صرفه`);
  }
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, trackUnits: r.trackUnits }]));
}

async function loadActivePoint(db: Db | Tx, id: string, label = 'نقطة الدليفري') {
  const point = await db.deliveryPoint.findUnique({ where: { id } });
  if (!point) throw Errors.notFound(label);
  if (!point.isActive) throw Errors.validation(`${label} "${point.name}" غير نشطة`);
  return point;
}

async function loadDriver(db: Db | Tx, id: string) {
  const driver = await db.driver.findUnique({ where: { id } });
  if (!driver) throw Errors.notFound('السائق');
  return driver;
}

/** مجموع عهدة السائق الحالية */
export async function custodyTotal(db: Db | Tx, driverId: string): Promise<number> {
  const agg = await db.driverCustody.aggregate({ where: { driverId }, _sum: { quantity: true } });
  return agg._sum.quantity ?? 0;
}

/** يجعل حالة السائق "في رحلة" عند وجود عهدة و"متاح" عند انتهائها (دون المساس بغير النشط) */
async function refreshDriverStatus(tx: Tx, driverId: string) {
  const total = await custodyTotal(tx, driverId);
  await tx.driver.updateMany({
    where: { id: driverId, status: { not: 'INACTIVE' } },
    data: { status: total > 0 ? 'ON_TRIP' : 'AVAILABLE' },
  });
}

// ─── 1) إدخال مخزون ─────────────────────────────────────────────

export async function stockIn(db: Db, actor: Actor, raw: unknown): Promise<OperationResult> {
  requireRole(actor, STAFF);
  const input = stockInSchema.parse(raw);
  assertPointAccess(actor, input.pointId);
  await loadActivePoint(db, input.pointId);
  const products = await loadProducts(db, input.lines.map((l) => l.productId), { forbidArchived: true });

  return runOperation(
    db,
    actor,
    { kind: 'STOCK_IN', idempotencyKey: input.idempotencyKey, request: input, deliveryPointId: input.pointId, notes: input.notes },
    async (tx, ctx) => {
      for (const l of inLockOrder(input.lines)) {
        await applyMovement(tx, ctx, {
          type: 'STOCK_IN',
          product: products.get(l.productId)!,
          quantity: l.quantity,
          fromColor: null,
          fromPointId: null,
          toColor: 'ORANGE',
          toPointId: input.pointId,
          unitSerials: l.unitSerials,
          scannedBarcode: l.scannedBarcode,
          scanSource: l.scanSource,
          notes: l.notes,
        });
      }
    },
  );
}

// ─── 2) صرف لسائق: برتقالي ← أزرق ──────────────────────────────

export async function dispatch(db: Db, actor: Actor, raw: unknown): Promise<OperationResult> {
  requireRole(actor, STAFF);
  const input = dispatchSchema.parse(raw);
  assertPointAccess(actor, input.pointId);
  await loadActivePoint(db, input.pointId);
  const driver = await loadDriver(db, input.driverId);
  if (driver.status === 'INACTIVE') throw Errors.validation(`السائق "${driver.fullName}" غير نشط ولا يمكن الصرف له`);
  if (driver.employeeId) {
    const emp = await db.employee.findUnique({ where: { id: driver.employeeId }, select: { status: true } });
    if (emp && emp.status !== 'ACTIVE') throw Errors.validation(`ملف السائق "${driver.fullName}" الوظيفي موقوف أو منتهٍ ولا يمكن الصرف له`);
  }
  if (driver.deliveryPointId !== input.pointId && actor.role !== 'ADMIN') {
    throw Errors.validation(`السائق "${driver.fullName}" لا يتبع هذه النقطة. الصرف لسائق من نقطة أخرى يحتاج صلاحية مدير النظام`);
  }
  const products = await loadProducts(db, input.lines.map((l) => l.productId), { forbidArchived: true });

  return runOperation(
    db,
    actor,
    {
      kind: 'DISPATCH',
      idempotencyKey: input.idempotencyKey,
      request: input,
      status: 'PENDING_DRIVER_ACK',
      deliveryPointId: input.pointId,
      driverId: driver.id,
      notes: input.notes,
    },
    async (tx, ctx) => {
      for (const l of inLockOrder(input.lines)) {
        await applyMovement(tx, ctx, {
          type: 'DISPATCH',
          product: products.get(l.productId)!,
          quantity: l.quantity,
          fromColor: 'ORANGE',
          fromPointId: input.pointId,
          toColor: 'BLUE',
          toPointId: input.pointId,
          driverId: driver.id,
          unitSerials: l.unitSerials,
          scannedBarcode: l.scannedBarcode,
          scanSource: l.scanSource,
          notes: l.notes,
        });
      }
    },
    async (tx) => {
      await refreshDriverStatus(tx, driver.id);
      // حضور تلقائي: استلام بضاعة للتوصيل = يوم عمل
      await recordDispatchActivity(tx, driver.id, input.lines.reduce((s, l) => s + l.quantity, 0));
    },
  );
}

// ─── 3) تأكيد السائق استلام سند الصرف ──────────────────────────

export async function acknowledgeDispatch(db: Db, actor: Actor, operationId: string) {
  const op = await db.operation.findUnique({ where: { id: operationId } });
  if (!op || op.kind !== 'DISPATCH') throw Errors.notFound('سند الصرف');
  if (actor.role === 'DRIVER') assertDriverSelf(actor, op.driverId!);
  else if (actor.role !== 'ADMIN') throw Errors.forbidden('تأكيد الاستلام يتم من حساب السائق نفسه');
  if (op.status === 'ACKNOWLEDGED') return op;

  return db.$transaction(async (tx) => {
    const res = await tx.operation.updateMany({
      where: { id: op.id, status: 'PENDING_DRIVER_ACK' },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedById: actor.id },
    });
    if (res.count === 1) {
      await writeAudit(tx, actor, {
        action: 'operation.acknowledge',
        entityType: 'operation',
        entityId: op.id,
        before: { status: op.status },
        after: { status: 'ACKNOWLEDGED' },
      });
    }
    return tx.operation.findUniqueOrThrow({ where: { id: op.id } });
  });
}

// ─── 4) تسليم للعميل: أزرق ← أخضر ──────────────────────────────

export async function deliver(db: Db, actor: Actor, raw: unknown): Promise<OperationResult> {
  requireRole(actor, [...STAFF, 'DRIVER']);
  const input = deliverSchema.parse(raw);
  const driver = await loadDriver(db, input.driverId);
  assertDriverSelf(actor, driver.id);
  if (actor.role !== 'DRIVER') assertPointAccess(actor, driver.deliveryPointId);
  if (input.customerId) {
    const c = await db.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
    if (!c) throw Errors.notFound('العميل');
  }
  const products = await loadProducts(db, input.lines.map((l) => l.productId), { forbidArchived: false });

  return runOperation(
    db,
    actor,
    { kind: 'DELIVERY', idempotencyKey: input.idempotencyKey, request: input, driverId: driver.id, notes: input.notes },
    async (tx, ctx) => {
      // العميل الجديد يُنشأ داخل نفس Transaction (ويُلغى معها إن فشلت أو أُعيدت المحاولة)
      let customerId = input.customerId ?? null;
      if (!customerId && input.newCustomer) {
        const created = await tx.customer.create({ data: input.newCustomer });
        customerId = created.id;
      }
      await tx.operation.update({ where: { id: ctx.operationId }, data: { customerId } });
      for (const l of inLockOrder(input.lines)) {
        const product = products.get(l.productId)!;
        const allocations = await allocateFromCustody(tx, driver.id, product, l.quantity, l.unitSerials);
        for (const a of allocations) {
          await applyMovement(tx, ctx, {
            type: 'DELIVERED',
            product,
            quantity: a.quantity,
            fromColor: 'BLUE',
            fromPointId: a.pointId,
            toColor: 'GREEN',
            toPointId: a.pointId,
            driverId: driver.id,
            customerId,
            unitSerials: a.serials,
            scannedBarcode: l.scannedBarcode,
            scanSource: l.scanSource,
            notes: l.notes,
          });
        }
      }
      // حضور تلقائي + عدد القطع والطرود المسلّمة + عمولة التوصيل بالسعر المعتمد الآن
      await recordDeliveryActivity(tx, {
        driverId: driver.id,
        operationId: ctx.operationId,
        lines: input.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      });
    },
    (tx) => refreshDriverStatus(tx, driver.id),
  );
}

// ─── 5) إرجاع للمستودع: أزرق ← بنفسجي/برتقالي أو أحمر ──────────

export async function returnToWarehouse(db: Db, actor: Actor, raw: unknown): Promise<OperationResult> {
  requireRole(actor, STAFF);
  const input = returnSchema.parse(raw);
  assertPointAccess(actor, input.receivingPointId);
  await loadActivePoint(db, input.receivingPointId, 'نقطة الاستلام');
  const driver = await loadDriver(db, input.driverId);
  const products = await loadProducts(db, input.lines.map((l) => l.productId), { forbidArchived: false });
  const settings = await getSettings(db);

  return runOperation(
    db,
    actor,
    {
      kind: 'RETURN',
      idempotencyKey: input.idempotencyKey,
      request: { ...input, autoRestock: settings.autoRestockGoodReturns },
      deliveryPointId: input.receivingPointId,
      driverId: driver.id,
      notes: input.notes,
    },
    async (tx, ctx) => {
      for (const l of inLockOrder(input.lines)) {
        const product = products.get(l.productId)!;
        const good = l.condition === 'GOOD';
        const reasonPrefix = l.condition === 'MISSING' ? '[مفقود] ' : l.condition === 'DAMAGED' ? '[تالف] ' : '';
        const allocations = await allocateFromCustody(tx, driver.id, product, l.quantity, l.unitSerials, input.receivingPointId);
        for (const a of allocations) {
          await applyMovement(tx, ctx, {
            type: good ? 'RETURN_GOOD' : 'RETURN_DAMAGED',
            product,
            quantity: a.quantity,
            fromColor: 'BLUE',
            fromPointId: a.pointId,
            toColor: good ? (settings.autoRestockGoodReturns ? 'ORANGE' : 'PURPLE') : 'RED',
            toPointId: input.receivingPointId,
            driverId: driver.id,
            unitSerials: a.serials,
            scannedBarcode: l.scannedBarcode,
            scanSource: l.scanSource,
            reason: l.reason ? reasonPrefix + l.reason : null,
            notes: l.notes,
          });
        }
      }
    },
    (tx) => refreshDriverStatus(tx, driver.id),
  );
}

// ─── 6) فرز البنفسجي: بنفسجي ← برتقالي أو أحمر ────────────────

export async function sortPurple(db: Db, actor: Actor, raw: unknown): Promise<OperationResult> {
  requireRole(actor, STAFF);
  const input = sortSchema.parse(raw);
  assertPointAccess(actor, input.pointId);
  const products = await loadProducts(db, input.lines.map((l) => l.productId), { forbidArchived: false });

  return runOperation(
    db,
    actor,
    { kind: 'SORTING', idempotencyKey: input.idempotencyKey, request: input, deliveryPointId: input.pointId, notes: input.notes },
    async (tx, ctx) => {
      for (const l of inLockOrder(input.lines)) {
        const ok = l.result === 'AVAILABLE';
        await applyMovement(tx, ctx, {
          type: ok ? 'SORT_TO_AVAILABLE' : 'SORT_TO_DAMAGED',
          product: products.get(l.productId)!,
          quantity: l.quantity,
          fromColor: 'PURPLE',
          fromPointId: input.pointId,
          toColor: ok ? 'ORANGE' : 'RED',
          toPointId: input.pointId,
          unitSerials: l.unitSerials,
          scannedBarcode: l.scannedBarcode,
          scanSource: l.scanSource,
          reason: l.reason,
          notes: l.notes,
        });
      }
    },
  );
}

// ─── 7) معالجة الأحمر (مدير فقط): أحمر ← برتقالي أو شطب ───────

export async function resolveRed(db: Db, actor: Actor, raw: unknown): Promise<OperationResult> {
  requireRole(actor, ['ADMIN']);
  const input = resolveRedSchema.parse(raw);
  const products = await loadProducts(db, input.lines.map((l) => l.productId), { forbidArchived: false });

  return runOperation(
    db,
    actor,
    { kind: 'RED_RESOLUTION', idempotencyKey: input.idempotencyKey, request: input, deliveryPointId: input.pointId, notes: input.notes },
    async (tx, ctx) => {
      for (const l of inLockOrder(input.lines)) {
        const restock = l.action === 'RESTOCK';
        await applyMovement(tx, ctx, {
          type: restock ? 'RESOLVE_RED' : 'WRITE_OFF',
          product: products.get(l.productId)!,
          quantity: l.quantity,
          fromColor: 'RED',
          fromPointId: input.pointId,
          toColor: restock ? 'ORANGE' : null,
          toPointId: restock ? input.pointId : null,
          unitSerials: l.unitSerials,
          scannedBarcode: l.scannedBarcode,
          scanSource: l.scanSource,
          reason: l.reason,
          notes: l.notes,
        });
      }
    },
  );
}

// ─── 8) مرتجع من عميل: أخضر ← بنفسجي أو أحمر ──────────────────

export async function customerReturn(db: Db, actor: Actor, raw: unknown): Promise<OperationResult> {
  requireRole(actor, STAFF);
  const input = customerReturnSchema.parse(raw);
  assertPointAccess(actor, input.receivingPointId);
  await loadActivePoint(db, input.receivingPointId, 'نقطة الاستلام');
  if (input.customerId) {
    const c = await db.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
    if (!c) throw Errors.notFound('العميل');
  }
  const products = await loadProducts(db, input.lines.map((l) => l.productId), { forbidArchived: false });

  return runOperation(
    db,
    actor,
    {
      kind: 'CUSTOMER_RETURN',
      idempotencyKey: input.idempotencyKey,
      request: input,
      deliveryPointId: input.receivingPointId,
      customerId: input.customerId ?? null,
      notes: input.notes,
    },
    async (tx, ctx) => {
      for (const l of inLockOrder(input.lines)) {
        await applyMovement(tx, ctx, {
          type: 'CUSTOMER_RETURN',
          product: products.get(l.productId)!,
          quantity: l.quantity,
          fromColor: 'GREEN',
          fromPointId: l.fromPointId ?? input.receivingPointId,
          toColor: l.condition === 'GOOD' ? 'PURPLE' : 'RED',
          toPointId: input.receivingPointId,
          customerId: input.customerId ?? null,
          unitSerials: l.unitSerials,
          scannedBarcode: l.scannedBarcode,
          scanSource: l.scanSource,
          reason: l.reason,
          notes: l.notes,
        });
      }
    },
  );
}

// ─── 9) تحويل بين النقاط: برتقالي ← برتقالي ───────────────────

export async function transfer(db: Db, actor: Actor, raw: unknown): Promise<OperationResult> {
  requireRole(actor, STAFF);
  const input = transferSchema.parse(raw);
  assertPointAccess(actor, input.fromPointId);
  await loadActivePoint(db, input.fromPointId, 'نقطة المصدر');
  await loadActivePoint(db, input.toPointId, 'نقطة الوجهة');
  const products = await loadProducts(db, input.lines.map((l) => l.productId), { forbidArchived: true });

  return runOperation(
    db,
    actor,
    {
      kind: 'TRANSFER',
      idempotencyKey: input.idempotencyKey,
      request: input,
      deliveryPointId: input.fromPointId,
      toDeliveryPointId: input.toPointId,
      notes: input.notes,
    },
    async (tx, ctx) => {
      for (const l of inLockOrder(input.lines)) {
        await applyMovement(tx, ctx, {
          type: 'TRANSFER',
          product: products.get(l.productId)!,
          quantity: l.quantity,
          fromColor: 'ORANGE',
          fromPointId: input.fromPointId,
          toColor: 'ORANGE',
          toPointId: input.toPointId,
          unitSerials: l.unitSerials,
          scannedBarcode: l.scannedBarcode,
          scanSource: l.scanSource,
          notes: l.notes,
        });
      }
    },
  );
}

// ─── 10) تسوية عهدة السائق ─────────────────────────────────────

export interface SettlementSummary {
  periodStart: string | null;
  dispatched: number;
  delivered: number;
  returnedGood: number;
  returnedDamaged: number;
  shortageRecorded: number;
  remainingBefore: number;
}

export async function settleDriver(db: Db, actor: Actor, raw: unknown): Promise<OperationResult> {
  requireRole(actor, ['ADMIN', 'WAREHOUSE']);
  const input = settleSchema.parse(raw);
  const driver = await loadDriver(db, input.driverId);
  assertPointAccess(actor, driver.deliveryPointId);
  if (input.receivingPointId) await loadActivePoint(db, input.receivingPointId, 'نقطة الاستلام');

  const remaining = await custodyTotal(db, driver.id);
  if (remaining > 0 && !input.markRemainingAsShortage) {
    throw Errors.conflict(
      `لا تزال لدى السائق عهدة (${remaining} قطعة). سجّل الإرجاع أو التسليم أولاً، أو فعّل خيار تسجيل المتبقي كعجز`,
      { remaining },
    );
  }

  return runOperation(
    db,
    actor,
    {
      kind: 'SETTLEMENT',
      idempotencyKey: input.idempotencyKey,
      request: input,
      driverId: driver.id,
      deliveryPointId: input.receivingPointId ?? driver.deliveryPointId,
      reason: input.reason,
      notes: input.notes,
    },
    async (tx, ctx) => {
      let shortage = 0;
      if (input.markRemainingAsShortage) {
        const rows = await tx.driverCustody.findMany({
          where: { driverId: driver.id, quantity: { gt: 0 } },
          include: { product: { select: { id: true, name: true, trackUnits: true } } },
          orderBy: [{ productId: 'asc' }, { deliveryPointId: 'asc' }],
        });
        for (const r of rows) {
          let serials: string[] = [];
          if (r.product.trackUnits) {
            const units = await tx.inventoryUnit.findMany({
              where: { productId: r.productId, driverId: driver.id, color: 'BLUE', deliveryPointId: r.deliveryPointId },
              select: { serial: true },
            });
            serials = units.map((u) => u.serial);
          }
          await applyMovement(tx, ctx, {
            type: 'SHORTAGE',
            product: r.product,
            quantity: r.quantity,
            fromColor: 'BLUE',
            fromPointId: r.deliveryPointId,
            toColor: 'RED',
            toPointId: input.receivingPointId ?? r.deliveryPointId,
            driverId: driver.id,
            unitSerials: serials,
            reason: `[عجز تسوية] ${input.reason}`,
          });
          shortage += r.quantity;
        }
      }

      const since = driver.lastSettledAt ?? undefined;
      const sums = await tx.stockMovement.groupBy({
        by: ['type'],
        where: { driverId: driver.id, ...(since ? { createdAt: { gt: since } } : {}) },
        _sum: { quantity: true },
      });
      const sumOf = (t: string) => sums.find((s) => s.type === t)?._sum.quantity ?? 0;
      const summary: SettlementSummary = {
        periodStart: since ? since.toISOString() : null,
        dispatched: sumOf('DISPATCH'),
        delivered: sumOf('DELIVERED'),
        returnedGood: sumOf('RETURN_GOOD'),
        returnedDamaged: sumOf('RETURN_DAMAGED'),
        shortageRecorded: shortage,
        remainingBefore: remaining,
      };
      await tx.settlement.create({
        data: {
          driverId: driver.id,
          operationId: ctx.operationId,
          settledById: actor.id,
          summary: { ...summary },
          periodStart: since ?? null,
        },
      });
      await tx.driver.update({ where: { id: driver.id }, data: { lastSettledAt: new Date() } });
    },
    (tx) => refreshDriverStatus(tx, driver.id),
  );
}

// ─── 11) تعديل استثنائي للحالة (مدير فقط) ─────────────────────

export async function adminStatusChange(db: Db, actor: Actor, raw: unknown): Promise<OperationResult> {
  requireRole(actor, ['ADMIN']);
  const input = statusChangeSchema.parse(raw);
  if (input.fromColor === 'BLUE' || input.toColor === 'BLUE') {
    throw Errors.badTransition('اللون الأزرق مرتبط بعهدة سائق: استخدم الصرف أو الإرجاع أو التسوية بدلاً من التعديل اليدوي');
  }
  if (input.fromColor === input.toColor) throw Errors.badTransition('اللون الحالي والجديد متطابقان');
  await loadActivePoint(db, input.pointId);
  const products = await loadProducts(db, [input.productId], { forbidArchived: false });

  return runOperation(
    db,
    actor,
    {
      kind: 'ADJUSTMENT',
      idempotencyKey: input.idempotencyKey,
      request: input,
      deliveryPointId: input.pointId,
      reason: input.reason,
    },
    async (tx, ctx) => {
      await applyMovement(tx, ctx, {
        type: 'STATUS_CHANGE',
        product: products.get(input.productId)!,
        quantity: input.quantity,
        fromColor: input.fromColor,
        fromPointId: input.pointId,
        toColor: input.toColor,
        toPointId: input.pointId,
        unitSerials: input.unitSerials,
        reason: input.reason,
      });
    },
  );
}
