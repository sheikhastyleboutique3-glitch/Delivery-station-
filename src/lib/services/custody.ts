import type { Db } from '../db';

export interface CustodyLine {
  productId: string;
  productName: string;
  sku: string;
  barcode: string;
  unit: string;
  trackUnits: boolean;
  pointId: string;
  pointName: string;
  quantity: number;
  since: Date | null;
  serials: string[];
}

export interface DriverCustody {
  driverId: string;
  total: number;
  oldestSince: Date | null;
  lines: CustodyLine[];
}

/**
 * عهدة السائق الحالية = Σ(صرف) − Σ(تسليم) − Σ(إرجاع) − Σ(عجز) لكل منتج.
 * تُقرأ من جدول driver_custody المحدَّث داخل نفس Transaction كل حركة،
 * وتتحقق أداة reconcile (والاختبارات) من تطابقه مع stock_movements.
 */
export async function getDriverCustody(db: Db, driverId: string): Promise<DriverCustody> {
  const rows = await db.driverCustody.findMany({
    where: { driverId, quantity: { gt: 0 } },
    include: {
      product: { select: { id: true, name: true, sku: true, barcode: true, unit: true, trackUnits: true } },
      deliveryPoint: { select: { id: true, name: true } },
    },
    orderBy: [{ nonzeroSince: 'asc' }, { productId: 'asc' }],
  });

  const tracked = rows.filter((r) => r.product.trackUnits).map((r) => r.productId);
  const units = tracked.length
    ? await db.inventoryUnit.findMany({
        where: { driverId, color: 'BLUE', productId: { in: tracked } },
        select: { serial: true, productId: true, deliveryPointId: true },
        orderBy: { serial: 'asc' },
      })
    : [];

  const lines: CustodyLine[] = rows.map((r) => ({
    productId: r.productId,
    productName: r.product.name,
    sku: r.product.sku,
    barcode: r.product.barcode,
    unit: r.product.unit,
    trackUnits: r.product.trackUnits,
    pointId: r.deliveryPointId,
    pointName: r.deliveryPoint.name,
    quantity: r.quantity,
    since: r.nonzeroSince,
    serials: units.filter((u) => u.productId === r.productId && u.deliveryPointId === r.deliveryPointId).map((u) => u.serial),
  }));

  const total = lines.reduce((s, l) => s + l.quantity, 0);
  const oldestSince = lines.reduce<Date | null>((min, l) => (l.since && (!min || l.since < min) ? l.since : min), null);
  return { driverId, total, oldestSince, lines };
}

/** يحسب العهدة مباشرة من سجل الحركات (للتحقق وليس للاستخدام اليومي) */
export async function computeCustodyFromMovements(db: Db, driverId: string): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ product_id: string; point_id: string; qty: number }[]>`
    SELECT product_id, point_id, SUM(q)::int AS qty FROM (
      SELECT product_id, to_point_id AS point_id, quantity AS q
        FROM stock_movements WHERE driver_id = ${driverId} AND to_color = 'BLUE'
      UNION ALL
      SELECT product_id, from_point_id AS point_id, -quantity AS q
        FROM stock_movements WHERE driver_id = ${driverId} AND from_color = 'BLUE'
    ) d
    GROUP BY product_id, point_id
    HAVING SUM(q) <> 0`;
  return new Map(rows.map((r) => [`${r.product_id}|${r.point_id}`, r.qty]));
}
