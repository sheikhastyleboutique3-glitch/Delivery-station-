import type { Db } from '../db';
import type { StockColor } from '../domain';

export interface BalanceMismatch {
  kind: 'balance' | 'custody' | 'units';
  productId: string;
  productName: string;
  pointId: string;
  pointName: string;
  color: StockColor | null;
  driverId: string | null;
  expected: number;
  actual: number;
}

export interface ReconcileReport {
  ok: boolean;
  checkedAt: string;
  balanceRows: number;
  custodyRows: number;
  mismatches: BalanceMismatch[];
}

/**
 * يقارن الأرصدة المخبّأة بما يجب أن تكون عليه حسب سجل الحركات:
 * 1) stock_color_balances مقابل Σ(إلى) − Σ(من) لكل (منتج، نقطة، لون).
 * 2) driver_custody مقابل حركات الأزرق لكل (سائق، منتج، نقطة).
 * 3) عدد القطع في inventory_units مقابل الرصيد (للمنتجات المتتبعة بالقطعة).
 */
export async function reconcile(db: Db): Promise<ReconcileReport> {
  const balance = await db.$queryRaw<
    { product_id: string; point_id: string; color: StockColor; expected: number; actual: number }[]
  >`
    WITH deltas AS (
      SELECT product_id, to_point_id AS point_id, to_color AS color, quantity AS q
        FROM stock_movements WHERE to_color IS NOT NULL
      UNION ALL
      SELECT product_id, from_point_id, from_color, -quantity
        FROM stock_movements WHERE from_color IS NOT NULL
    ), expected AS (
      SELECT product_id, point_id, color, SUM(q)::int AS expected FROM deltas GROUP BY 1, 2, 3
    )
    SELECT COALESCE(e.product_id, b.product_id) AS product_id,
           COALESCE(e.point_id, b.delivery_point_id) AS point_id,
           COALESCE(e.color, b.color) AS color,
           COALESCE(e.expected, 0) AS expected,
           COALESCE(b.quantity, 0) AS actual
      FROM expected e
      FULL OUTER JOIN stock_color_balances b
        ON b.product_id = e.product_id AND b.delivery_point_id = e.point_id AND b.color = e.color
     WHERE COALESCE(e.expected, 0) <> COALESCE(b.quantity, 0)`;

  const custody = await db.$queryRaw<
    { driver_id: string; product_id: string; point_id: string; expected: number; actual: number }[]
  >`
    WITH deltas AS (
      SELECT driver_id, product_id, to_point_id AS point_id, quantity AS q
        FROM stock_movements WHERE to_color = 'BLUE'
      UNION ALL
      SELECT driver_id, product_id, from_point_id, -quantity
        FROM stock_movements WHERE from_color = 'BLUE'
    ), expected AS (
      SELECT driver_id, product_id, point_id, SUM(q)::int AS expected FROM deltas GROUP BY 1, 2, 3
    )
    SELECT COALESCE(e.driver_id, c.driver_id) AS driver_id,
           COALESCE(e.product_id, c.product_id) AS product_id,
           COALESCE(e.point_id, c.delivery_point_id) AS point_id,
           COALESCE(e.expected, 0) AS expected,
           COALESCE(c.quantity, 0) AS actual
      FROM expected e
      FULL OUTER JOIN driver_custody c
        ON c.driver_id = e.driver_id AND c.product_id = e.product_id AND c.delivery_point_id = e.point_id
     WHERE COALESCE(e.expected, 0) <> COALESCE(c.quantity, 0)`;

  const units = await db.$queryRaw<
    { product_id: string; point_id: string; color: StockColor; expected: number; actual: number }[]
  >`
    WITH counts AS (
      SELECT u.product_id, u.delivery_point_id AS point_id, u.color, COUNT(*)::int AS n
        FROM inventory_units u WHERE u.color IS NOT NULL GROUP BY 1, 2, 3
    ), bal AS (
      SELECT b.product_id, b.delivery_point_id AS point_id, b.color, b.quantity
        FROM stock_color_balances b JOIN products p ON p.id = b.product_id
       WHERE p.track_units = true
    )
    SELECT COALESCE(b.product_id, c.product_id) AS product_id,
           COALESCE(b.point_id, c.point_id) AS point_id,
           COALESCE(b.color, c.color) AS color,
           COALESCE(b.quantity, 0) AS expected,
           COALESCE(c.n, 0) AS actual
      FROM bal b FULL OUTER JOIN counts c
        ON c.product_id = b.product_id AND c.point_id = b.point_id AND c.color = b.color
     WHERE COALESCE(b.quantity, 0) <> COALESCE(c.n, 0)`;

  const productIds = [...new Set([...balance, ...custody, ...units].map((r) => r.product_id))];
  const pointIds = [...new Set([...balance, ...custody, ...units].map((r) => r.point_id))];
  const [products, points, balanceRows, custodyRows] = await Promise.all([
    db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }),
    db.deliveryPoint.findMany({ where: { id: { in: pointIds } }, select: { id: true, name: true } }),
    db.stockColorBalance.count(),
    db.driverCustody.count(),
  ]);
  const pName = new Map(products.map((p) => [p.id, p.name]));
  const ptName = new Map(points.map((p) => [p.id, p.name]));

  const mismatches: BalanceMismatch[] = [
    ...balance.map((r) => ({ kind: 'balance' as const, driverId: null, ...base(r), color: r.color })),
    ...custody.map((r) => ({ kind: 'custody' as const, driverId: r.driver_id, ...base(r), color: 'BLUE' as const })),
    ...units.map((r) => ({ kind: 'units' as const, driverId: null, ...base(r), color: r.color })),
  ];

  function base(r: { product_id: string; point_id: string; expected: number; actual: number }) {
    return {
      productId: r.product_id,
      productName: pName.get(r.product_id) ?? r.product_id,
      pointId: r.point_id,
      pointName: ptName.get(r.point_id) ?? r.point_id,
      expected: Number(r.expected),
      actual: Number(r.actual),
    };
  }

  return { ok: mismatches.length === 0, checkedAt: new Date().toISOString(), balanceRows, custodyRows, mismatches };
}
