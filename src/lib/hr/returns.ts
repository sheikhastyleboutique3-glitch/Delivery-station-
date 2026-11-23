import type { Prisma } from '@prisma/client';
import type { Db } from '../db';
import { scopedPointId, type Actor } from '../actor';
import { Errors } from '../errors';
import { getSettings } from '../settings';
import { dbDate, decimal, localDate, toCents } from './util';

type Tx = Prisma.TransactionClient;
type Reader = Db | Tx;

export interface ReturnableLine {
  productId: string;
  productName: string;
  sku: string;
  barcode: string;
  trackUnits: boolean;
  delivered: number;
  returned: number;
  remaining: number;
  /** الكمية المتبقية لكل نقطة (النقطة التي سُجّل فيها الأخضر) */
  byPoint: { pointId: string; remaining: number }[];
  serialsRemaining: string[];
}

/**
 * ما يمكن إرجاعه من سند تسليم: المسلّم − ما أُرجع سابقاً من نفس السند، لكل منتج ولكل نقطة.
 * يُستدعى داخل Transaction بعد قفل السند (FOR UPDATE) عند التسجيل الفعلي.
 */
export async function returnableFor(db: Reader, deliveryOperationId: string) {
  const op = await db.operation.findUnique({
    where: { id: deliveryOperationId },
    include: {
      driver: { select: { id: true, fullName: true, deliveryPointId: true } },
      customer: { select: { id: true, name: true, phone: true } },
      movements: {
        where: { type: 'DELIVERED' },
        include: { product: { select: { id: true, name: true, sku: true, barcode: true, trackUnits: true } } },
      },
    },
  });
  if (!op || op.kind !== 'DELIVERY') throw Errors.notFound('سند التسليم');

  const returnedMoves = await db.stockMovement.findMany({
    where: { type: 'CUSTOMER_RETURN', operation: { sourceOperationId: op.id } },
    select: { productId: true, quantity: true, fromPointId: true, unitSerials: true },
  });

  const lines = new Map<string, ReturnableLine & { _points: Map<string, number>; _serials: Set<string> }>();
  for (const m of op.movements) {
    const l =
      lines.get(m.productId) ??
      ({
        productId: m.productId,
        productName: m.product.name,
        sku: m.product.sku,
        barcode: m.product.barcode,
        trackUnits: m.product.trackUnits,
        delivered: 0,
        returned: 0,
        remaining: 0,
        byPoint: [],
        serialsRemaining: [],
        _points: new Map(),
        _serials: new Set(),
      } as ReturnableLine & { _points: Map<string, number>; _serials: Set<string> });
    l.delivered += m.quantity;
    l._points.set(m.toPointId!, (l._points.get(m.toPointId!) ?? 0) + m.quantity);
    for (const s of m.unitSerials) l._serials.add(s);
    lines.set(m.productId, l);
  }
  for (const r of returnedMoves) {
    const l = lines.get(r.productId);
    if (!l) continue;
    l.returned += r.quantity;
    if (r.fromPointId) l._points.set(r.fromPointId, (l._points.get(r.fromPointId) ?? 0) - r.quantity);
    for (const s of r.unitSerials) l._serials.delete(s);
  }
  const out: ReturnableLine[] = [...lines.values()].map(({ _points, _serials, ...l }) => ({
    ...l,
    remaining: l.delivered - l.returned,
    byPoint: [..._points.entries()].filter(([, q]) => q > 0).map(([pointId, remaining]) => ({ pointId, remaining })),
    serialsRemaining: [..._serials],
  }));
  return { op, lines: out };
}

/** للواجهة: تفاصيل سند تسليم وما يمكن إرجاعه منه */
export async function getReturnable(db: Db, actor: Actor, deliveryOperationId: string) {
  if (actor.role === 'DRIVER') throw Errors.forbidden();
  const { op, lines } = await returnableFor(db, deliveryOperationId);
  const scope = scopedPointId(actor);
  if (scope && op.driver?.deliveryPointId !== scope && !lines.some((l) => l.byPoint.some((p) => p.pointId === scope))) {
    throw Errors.forbidden('هذا التسليم يخص نقطة أخرى');
  }
  return {
    operation: { id: op.id, opNo: op.opNo, createdAt: op.createdAt, driver: op.driver, customer: op.customer },
    lines,
  };
}

/**
 * إلغاء عمولة السائق عن القطع التي أرجعها العميل، بنفس السعر الذي حُسبت به وقت التسليم.
 * - لكل قطعة: يُلغى سعر القطعة × الكمية المرتجعة (مثلاً 200 دج × 1).
 * - لكل طرد: تُلغى عمولة الطرد فقط عندما يُرجَع الطلب بالكامل.
 * يُسجَّل كسطر مستقل (RETURN_REVERSAL) بتاريخ المرتجع، فيُطرح من كشف الفترة التي حدث فيها المرتجع.
 */
export async function recordCustomerReturnReversal(
  tx: Tx,
  args: { deliveryOperationId: string; returnOperationId: string; lines: { productId: string; quantity: number }[]; fullyReturned: boolean },
) {
  const earnings = await tx.deliveryEarning.findMany({ where: { operationId: args.deliveryOperationId, kind: 'DELIVERY' } });
  if (earnings.length === 0) return { reversedCents: 0 }; // السائق لم يكن على نظام العمولة وقت التسليم
  const settings = await getSettings(tx);
  const day = dbDate(localDate(new Date(), settings.timezone));
  const delivery = await tx.operation.findUniqueOrThrow({ where: { id: args.deliveryOperationId }, select: { opNo: true } });
  const base = { employeeId: earnings[0].employeeId, driverId: earnings[0].driverId, operationId: args.returnOperationId, sourceOperationId: args.deliveryOperationId, kind: 'RETURN_REVERSAL' as const, date: day };
  let reversedCents = 0;

  const colis = earnings.find((e) => e.mode === 'PER_COLIS');
  if (colis) {
    if (!args.fullyReturned) return { reversedCents: 0 };
    const already = await tx.deliveryEarning.count({ where: { sourceOperationId: args.deliveryOperationId, kind: 'RETURN_REVERSAL', mode: 'PER_COLIS' } });
    if (already > 0) return { reversedCents: 0 };
    await tx.deliveryEarning.create({
      data: {
        ...base,
        mode: 'PER_COLIS',
        quantity: 1,
        units: args.lines.reduce((s, l) => s + l.quantity, 0),
        rate: colis.rate,
        amount: colis.amount,
        rateSource: `إلغاء: إرجاع الطلب ${delivery.opNo} بالكامل`,
      },
    });
    return { reversedCents: toCents(colis.amount) };
  }

  // لكل قطعة: نطابق فئة المنتج مع سطر العمولة الأصلي لنأخذ نفس السعر
  const products = await tx.product.findMany({ where: { id: { in: args.lines.map((l) => l.productId) } }, select: { id: true, category: true } });
  const catOf = new Map(products.map((p) => [p.id, p.category]));
  const byCategory = new Map<string, { qty: number; rateCents: number; category: string | null }>();
  for (const l of args.lines) {
    const cat = catOf.get(l.productId) ?? null;
    const orig = earnings.find((e) => e.category === cat) ?? earnings[0];
    const key = `${orig.category ?? ''}|${toCents(orig.rate)}`;
    const g = byCategory.get(key) ?? { qty: 0, rateCents: toCents(orig.rate), category: orig.category };
    g.qty += l.quantity;
    byCategory.set(key, g);
  }
  for (const g of byCategory.values()) {
    const amount = g.rateCents * g.qty;
    reversedCents += amount;
    await tx.deliveryEarning.create({
      data: {
        ...base,
        mode: 'PER_UNIT',
        category: g.category,
        quantity: g.qty,
        units: g.qty,
        rate: decimal(g.rateCents),
        amount: decimal(amount),
        rateSource: `إلغاء: مرتجع عميل من التسليم ${delivery.opNo}`,
      },
    });
  }
  return { reversedCents };
}
