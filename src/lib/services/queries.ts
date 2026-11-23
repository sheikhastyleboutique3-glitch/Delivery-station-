import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Db } from '../db';
import { scopedPointId, assertPointAccess, type Actor } from '../actor';
import { COLORS, MOVEMENT_TYPES, OPERATION_KINDS, type StockColor } from '../domain';
import { Errors } from '../errors';
import { pageSchema, pageSizeSchema } from '../validation';

export type ColorTotals = Record<StockColor, number>;
const emptyTotals = (): ColorTotals => ({ ORANGE: 0, BLUE: 0, GREEN: 0, RED: 0, PURPLE: 0 });

/** يزيل التكلفة من بيانات المنتج للسائقين */
export function canSeeCost(actor: Actor) {
  return actor.role !== 'DRIVER';
}

// ─── Warehouse color view ───────────────────────────────────────

export const warehouseQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  color: z.enum(COLORS).optional(),
  category: z.string().trim().max(80).optional(),
  pointId: z.string().trim().max(64).optional(),
  lowOnly: z.enum(['1', '0']).optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
});

export async function getWarehouseView(db: Db, actor: Actor, raw: Record<string, string | undefined>) {
  const q = warehouseQuerySchema.parse(raw);
  const scope = scopedPointId(actor);
  if (q.pointId && scope && q.pointId !== scope) throw Errors.forbidden('لا يمكنك عرض مخزون نقطة أخرى');
  const pointId = q.pointId || scope || undefined;

  const productWhere: Prisma.ProductWhereInput = { isArchived: false };
  if (q.category) productWhere.category = q.category;
  if (q.q) {
    const unitMatch = await db.inventoryUnit.findFirst({ where: { serial: q.q }, select: { productId: true } });
    productWhere.OR = [
      { name: { contains: q.q, mode: 'insensitive' } },
      { sku: { contains: q.q, mode: 'insensitive' } },
      { barcode: { contains: q.q } },
      ...(unitMatch ? [{ id: unitMatch.productId }] : []),
    ];
  }
  if (q.color) {
    productWhere.balances = { some: { color: q.color, quantity: { gt: 0 }, ...(pointId ? { deliveryPointId: pointId } : {}) } };
  }

  let lowIds: string[] | null = null;
  if (q.lowOnly === '1') {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM products p
        LEFT JOIN stock_color_balances b ON b.product_id = p.id AND b.color = 'ORANGE'
             AND (${pointId ?? null}::text IS NULL OR b.delivery_point_id = ${pointId ?? null}::text)
       WHERE p.is_archived = false AND p.min_stock_alert > 0
       GROUP BY p.id HAVING COALESCE(SUM(b.quantity), 0) < p.min_stock_alert`;
    lowIds = rows.map((r) => r.id);
    productWhere.id = { in: lowIds };
  }

  const [total, products, grouped] = await Promise.all([
    db.product.count({ where: productWhere }),
    db.product.findMany({
      where: productWhere,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        balances: { where: { quantity: { gt: 0 }, ...(pointId ? { deliveryPointId: pointId } : {}) } },
      },
    }),
    db.stockColorBalance.groupBy({
      by: ['color'],
      where: { product: productWhere, ...(pointId ? { deliveryPointId: pointId } : {}) },
      _sum: { quantity: true },
    }),
  ]);

  const totals = emptyTotals();
  for (const g of grouped) totals[g.color] = g._sum.quantity ?? 0;

  const showCost = canSeeCost(actor);
  const items = products.map((p) => {
    const colors = emptyTotals();
    const byPoint: Record<string, ColorTotals> = {};
    for (const b of p.balances) {
      colors[b.color] += b.quantity;
      byPoint[b.deliveryPointId] ??= emptyTotals();
      byPoint[b.deliveryPointId][b.color] += b.quantity;
    }
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      category: p.category,
      unit: p.unit,
      price: p.price.toString(),
      cost: showCost ? p.cost.toString() : null,
      minStockAlert: p.minStockAlert,
      trackUnits: p.trackUnits,
      imageUrl: p.imageUrl,
      colors,
      byPoint,
      lowStock: p.minStockAlert > 0 && colors.ORANGE < p.minStockAlert,
    };
  });

  const categories = await db.product.findMany({
    where: { isArchived: false },
    distinct: ['category'],
    select: { category: true },
    orderBy: { category: 'asc' },
  });

  return {
    items,
    totals,
    categories: categories.map((c) => c.category),
    pointId: pointId ?? null,
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

// ─── Movement history ───────────────────────────────────────────

export const movementQuerySchema = z.object({
  productId: z.string().max(64).optional(),
  driverId: z.string().max(64).optional(),
  customerId: z.string().max(64).optional(),
  pointId: z.string().max(64).optional(),
  operationId: z.string().max(64).optional(),
  color: z.enum(COLORS).optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
});

export function parseDateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  const f = from ? new Date(from) : null;
  const t = to ? new Date(to) : null;
  if (f && Number.isNaN(f.getTime())) throw Errors.validation('تاريخ البداية غير صحيح');
  if (t && Number.isNaN(t.getTime())) throw Errors.validation('تاريخ النهاية غير صحيح');
  if (!f && !t) return undefined;
  // "to" بصيغة YYYY-MM-DD تشمل اليوم كاملاً
  if (t && to && /^\d{4}-\d{2}-\d{2}$/.test(to)) t.setUTCDate(t.getUTCDate() + 1);
  return { ...(f ? { gte: f } : {}), ...(t ? { lt: t } : {}) };
}

export function movementWhere(actor: Actor, q: z.infer<typeof movementQuerySchema>): Prisma.StockMovementWhereInput {
  const and: Prisma.StockMovementWhereInput[] = [];
  const scope = scopedPointId(actor);
  if (actor.role === 'DRIVER') {
    if (!actor.driverId) throw Errors.forbidden();
    and.push({ driverId: actor.driverId });
  } else if (scope) {
    and.push({ OR: [{ fromPointId: scope }, { toPointId: scope }] });
  }
  if (q.productId) and.push({ productId: q.productId });
  if (q.driverId) and.push({ driverId: q.driverId });
  if (q.customerId) and.push({ customerId: q.customerId });
  if (q.operationId) and.push({ operationId: q.operationId });
  if (q.type) and.push({ type: q.type });
  if (q.pointId) and.push({ OR: [{ fromPointId: q.pointId }, { toPointId: q.pointId }] });
  if (q.color) and.push({ OR: [{ fromColor: q.color }, { toColor: q.color }] });
  if (q.q) and.push({ OR: [{ scannedBarcode: q.q }, { unitSerials: { has: q.q } }, { product: { barcode: q.q } }] });
  const range = parseDateRange(q.from, q.to);
  if (range) and.push({ createdAt: range });
  return and.length ? { AND: and } : {};
}

export const movementInclude = {
  product: { select: { id: true, name: true, sku: true, barcode: true, unit: true } },
  fromPoint: { select: { id: true, name: true } },
  toPoint: { select: { id: true, name: true } },
  driver: { select: { id: true, fullName: true } },
  customer: { select: { id: true, name: true, phone: true } },
  performedBy: { select: { id: true, name: true } },
  operation: { select: { id: true, opNo: true, kind: true, status: true } },
} satisfies Prisma.StockMovementInclude;

export async function listMovements(db: Db, actor: Actor, raw: Record<string, string | undefined>) {
  const q = movementQuerySchema.parse(raw);
  const where = movementWhere(actor, q);
  const [total, items] = await Promise.all([
    db.stockMovement.count({ where }),
    db.stockMovement.findMany({
      where,
      include: movementInclude,
      orderBy: { movementNo: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

// ─── Operations list ────────────────────────────────────────────

export const operationQuerySchema = z.object({
  kind: z.enum(OPERATION_KINDS).optional(),
  customerId: z.string().max(64).optional(),
  q: z.string().trim().max(40).optional(),
  driverId: z.string().max(64).optional(),
  status: z.enum(['COMPLETED', 'PENDING_DRIVER_ACK', 'ACKNOWLEDGED']).optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
});

export async function listOperations(db: Db, actor: Actor, raw: Record<string, string | undefined>) {
  const q = operationQuerySchema.parse(raw);
  const where: Prisma.OperationWhereInput = {};
  if (q.kind) where.kind = q.kind;
  if (q.status) where.status = q.status;
  if (q.driverId) where.driverId = q.driverId;
  if (q.customerId) where.customerId = q.customerId;
  if (q.q) where.opNo = { contains: q.q.toUpperCase() };
  if (actor.role === 'DRIVER') where.driverId = actor.driverId ?? '__none__';
  else {
    const scope = scopedPointId(actor);
    if (scope) where.OR = [{ deliveryPointId: scope }, { toDeliveryPointId: scope }, { driver: { deliveryPointId: scope } }];
  }
  const [total, items] = await Promise.all([
    db.operation.count({ where }),
    db.operation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        driver: { select: { id: true, fullName: true } },
        customer: { select: { id: true, name: true } },
        deliveryPoint: { select: { id: true, name: true } },
        toDeliveryPoint: { select: { id: true, name: true } },
        performedBy: { select: { id: true, name: true } },
        _count: { select: { movements: true } },
        movements: { select: { quantity: true } },
      },
    }),
  ]);
  return {
    items: items.map(({ movements, ...op }) => ({ ...op, totalQuantity: movements.reduce((s, m) => s + m.quantity, 0) })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** يتحقق أن المستخدم يحق له رؤية سند معيّن */
export function assertOperationAccess(
  actor: Actor,
  op: { driverId: string | null; deliveryPointId: string | null; toDeliveryPointId: string | null; driver?: { deliveryPointId?: string } | null },
) {
  if (actor.role === 'DRIVER') {
    if (!op.driverId || op.driverId !== actor.driverId) throw Errors.forbidden('هذا السند لا يخصك');
    return;
  }
  const scope = scopedPointId(actor);
  if (!scope) return;
  const points = [op.deliveryPointId, op.toDeliveryPointId, op.driver?.deliveryPointId].filter(Boolean);
  if (!points.includes(scope)) throw Errors.forbidden('هذا السند يخص نقطة أخرى');
}

// ─── Barcode lookup ─────────────────────────────────────────────

/** يبحث بالباركود أو SKU أو الرقم التسلسلي لقطعة */
export async function lookupCode(db: Db, actor: Actor, code: string) {
  const c = code.trim();
  if (!c) throw Errors.validation('أدخل الباركود');
  const select = {
    id: true,
    name: true,
    sku: true,
    barcode: true,
    unit: true,
    category: true,
    price: true,
    cost: true,
    trackUnits: true,
    isArchived: true,
  } as const;
  let product = await db.product.findFirst({ where: { OR: [{ barcode: c }, { sku: c }] }, select });
  let unit: { serial: string; color: StockColor | null; deliveryPointId: string | null; driverId: string | null } | null = null;
  if (!product) {
    const u = await db.inventoryUnit.findUnique({
      where: { serial: c },
      select: { serial: true, color: true, deliveryPointId: true, driverId: true, product: { select } },
    });
    if (u) {
      product = u.product;
      unit = { serial: u.serial, color: u.color, deliveryPointId: u.deliveryPointId, driverId: u.driverId };
    }
  }
  if (!product) return { found: false as const, code: c };
  const scope = scopedPointId(actor);
  const balances = await db.stockColorBalance.findMany({
    where: { productId: product.id, quantity: { gt: 0 }, ...(scope ? { deliveryPointId: scope } : {}) },
    select: { color: true, quantity: true, deliveryPointId: true },
  });
  return {
    found: true as const,
    code: c,
    product: { ...product, price: product.price.toString(), cost: canSeeCost(actor) ? product.cost.toString() : null },
    unit,
    balances,
  };
}

// ─── Dashboard ──────────────────────────────────────────────────

export async function getDashboard(db: Db, actor: Actor) {
  const scope = scopedPointId(actor);
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const [grouped, drivers, todayOps, recent, openCustody] = await Promise.all([
    db.stockColorBalance.groupBy({
      by: ['color'],
      where: { product: { isArchived: false }, ...(scope ? { deliveryPointId: scope } : {}) },
      _sum: { quantity: true },
    }),
    db.driver.groupBy({ by: ['status'], where: scope ? { deliveryPointId: scope } : {}, _count: { _all: true } }),
    db.operation.groupBy({
      by: ['kind'],
      where: { createdAt: { gte: since }, ...(scope ? { OR: [{ deliveryPointId: scope }, { toDeliveryPointId: scope }] } : {}) },
      _count: { _all: true },
    }),
    db.operation.findMany({
      where: scope ? { OR: [{ deliveryPointId: scope }, { toDeliveryPointId: scope }] } : {},
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        driver: { select: { fullName: true } },
        customer: { select: { name: true } },
        performedBy: { select: { name: true } },
        movements: { select: { quantity: true } },
      },
    }),
    db.driverCustody.groupBy({
      by: ['driverId'],
      where: { quantity: { gt: 0 }, ...(scope ? { deliveryPointId: scope } : {}) },
      _sum: { quantity: true },
    }),
  ]);
  const totals = emptyTotals();
  for (const g of grouped) totals[g.color] = g._sum.quantity ?? 0;
  return {
    totals,
    drivers: Object.fromEntries(drivers.map((d) => [d.status, d._count._all])),
    todayOps: Object.fromEntries(todayOps.map((o) => [o.kind, o._count._all])),
    driversWithCustody: openCustody.length,
    recent: recent.map(({ movements, ...op }) => ({ ...op, totalQuantity: movements.reduce((s, m) => s + m.quantity, 0) })),
  };
}

export { assertPointAccess };

// ─── Balances for specific products (used by operation screens) ─

export async function getBalances(db: Db, actor: Actor, pointId: string | undefined, productIdsCsv: string | undefined) {
  const scope = scopedPointId(actor);
  if (pointId && scope && pointId !== scope) throw Errors.forbidden('لا يمكنك عرض مخزون نقطة أخرى');
  const pid = pointId || scope || undefined;
  const ids = (productIdsCsv ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 500);
  if (ids.length === 0) return {} as Record<string, ColorTotals>;
  const rows = await db.stockColorBalance.groupBy({
    by: ['productId', 'color'],
    where: { productId: { in: ids }, ...(pid ? { deliveryPointId: pid } : {}) },
    _sum: { quantity: true },
  });
  const out: Record<string, ColorTotals> = {};
  for (const id of ids) out[id] = emptyTotals();
  for (const r of rows) out[r.productId][r.color] = r._sum.quantity ?? 0;
  return out;
}
