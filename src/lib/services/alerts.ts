import type { Db } from '../db';
import type { Actor } from '../actor';
import { scopedPointId } from '../actor';
import { getSettings } from '../settings';
import { DOCUMENT_TYPE_LABELS } from '../domain';
import { dbDate, localDate, ymdOf } from '../hr/util';

export type AlertKind = 'LOW_STOCK' | 'RED_PENDING' | 'CUSTODY_OVERDUE' | 'PENDING_ACK' | 'DOCUMENT_EXPIRY';

export interface Alert {
  kind: AlertKind;
  severity: 'warning' | 'danger' | 'info';
  title: string;
  message: string;
  href: string;
  meta: Record<string, unknown>;
}

const HOUR = 3_600_000;

/** التنبيهات تُحسب مباشرة من البيانات عند كل طلب، فلا يمكن أن تكون قديمة */
export async function getAlerts(db: Db, actor: Actor): Promise<Alert[]> {
  if (actor.role === 'DRIVER') return [];
  const settings = await getSettings(db);
  const scope = scopedPointId(actor);
  const now = Date.now();
  const alerts: Alert[] = [];

  // 1) المخزون البرتقالي أقل من الحد الأدنى
  const low = await db.$queryRaw<{ id: string; name: string; sku: string; min: number; orange: number }[]>`
    SELECT p.id, p.name, p.sku, p.min_stock_alert AS min,
           COALESCE(SUM(b.quantity) FILTER (WHERE b.color = 'ORANGE'
             AND (${scope}::text IS NULL OR b.delivery_point_id = ${scope}::text)), 0)::int AS orange
      FROM products p
      LEFT JOIN stock_color_balances b ON b.product_id = p.id
     WHERE p.is_archived = false AND p.min_stock_alert > 0
     GROUP BY p.id
    HAVING COALESCE(SUM(b.quantity) FILTER (WHERE b.color = 'ORANGE'
             AND (${scope}::text IS NULL OR b.delivery_point_id = ${scope}::text)), 0) < p.min_stock_alert
     ORDER BY p.name
     LIMIT 100`;
  for (const p of low) {
    alerts.push({
      kind: 'LOW_STOCK',
      severity: p.orange === 0 ? 'danger' : 'warning',
      title: 'مخزون منخفض',
      message: `"${p.name}" المتاح ${p.orange} والحد الأدنى ${p.min}`,
      href: `/warehouse?q=${encodeURIComponent(p.sku)}`,
      meta: { productId: p.id, available: p.orange, min: p.min },
    });
  }

  // 2) مرتجعات حمراء لم تُعالج منذ أكثر من X ساعة
  const redCutoff = new Date(now - settings.redAlertHours * HOUR);
  const reds = await db.stockColorBalance.findMany({
    where: { color: 'RED', quantity: { gt: 0 }, nonzeroSince: { lt: redCutoff }, ...(scope ? { deliveryPointId: scope } : {}) },
    include: { product: { select: { name: true, sku: true } }, deliveryPoint: { select: { name: true } } },
    orderBy: { nonzeroSince: 'asc' },
    take: 100,
  });
  for (const r of reds) {
    const hours = Math.floor((now - r.nonzeroSince!.getTime()) / HOUR);
    alerts.push({
      kind: 'RED_PENDING',
      severity: 'danger',
      title: 'مرتجعات تحتاج معالجة',
      message: `${r.quantity} من "${r.product.name}" بالأحمر في ${r.deliveryPoint.name} منذ ${hours} ساعة`,
      href: `/sorting?tab=red`,
      meta: { productId: r.productId, pointId: r.deliveryPointId, quantity: r.quantity, hours },
    });
  }

  // 3) عهدة سائق مفتوحة أكثر من Y ساعة
  const custodyCutoff = new Date(now - settings.custodyAlertHours * HOUR);
  const overdue = await db.driverCustody.groupBy({
    by: ['driverId'],
    where: { quantity: { gt: 0 }, nonzeroSince: { lt: custodyCutoff }, ...(scope ? { deliveryPointId: scope } : {}) },
    _sum: { quantity: true },
    _min: { nonzeroSince: true },
  });
  if (overdue.length) {
    const drivers = await db.driver.findMany({
      where: { id: { in: overdue.map((o) => o.driverId) } },
      select: { id: true, fullName: true },
    });
    const names = new Map(drivers.map((d) => [d.id, d.fullName]));
    for (const o of overdue) {
      const hours = Math.floor((now - o._min.nonzeroSince!.getTime()) / HOUR);
      alerts.push({
        kind: 'CUSTODY_OVERDUE',
        severity: 'warning',
        title: 'تأخر تسوية عهدة',
        message: `السائق ${names.get(o.driverId) ?? ''} لديه ${o._sum.quantity} قطعة منذ ${hours} ساعة دون تسوية`,
        href: `/drivers/${o.driverId}`,
        meta: { driverId: o.driverId, quantity: o._sum.quantity, hours },
      });
    }
  }

  // 4) سندات صرف لم يؤكد السائق استلامها
  const ackCutoff = new Date(now - settings.pendingAckAlertHours * HOUR);
  const pending = await db.operation.findMany({
    where: { kind: 'DISPATCH', status: 'PENDING_DRIVER_ACK', createdAt: { lt: ackCutoff }, ...(scope ? { deliveryPointId: scope } : {}) },
    include: { driver: { select: { fullName: true } } },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  for (const op of pending) {
    alerts.push({
      kind: 'PENDING_ACK',
      severity: 'info',
      title: 'بانتظار تأكيد السائق',
      message: `السند ${op.opNo} للسائق ${op.driver?.fullName ?? ''} لم يُؤكَّد استلامه`,
      href: `/ops/${op.id}`,
      meta: { operationId: op.id },
    });
  }

  // 5) وثائق منتهية أو قاربت على الانتهاء (للمدير فقط لأنها بيانات شخصية)
  if (actor.role === 'ADMIN') alerts.push(...(await documentExpiryAlerts(db, settings.timezone, settings.documentExpiryAlertDays)));

  return alerts;
}

export async function documentExpiryAlerts(db: Db, timezone: string, days: number): Promise<Alert[]> {
  const today = localDate(new Date(), timezone);
  const limit = dbDate(localDate(new Date(Date.now() + days * 86_400_000), timezone));
  const employees = await db.employee.findMany({
    where: {
      status: { not: 'TERMINATED' },
      OR: [{ idExpiryDate: { lte: limit } }, { drivingLicenseExpiry: { lte: limit } }, { documents: { some: { expiryDate: { lte: limit } } } }],
    },
    select: {
      id: true,
      fullName: true,
      idExpiryDate: true,
      drivingLicenseExpiry: true,
      documents: { where: { expiryDate: { lte: limit } }, select: { type: true, title: true, expiryDate: true } },
    },
    take: 200,
  });
  const out: Alert[] = [];
  const push = (e: { id: string; fullName: string }, what: string, d: Date) => {
    const ymd = ymdOf(d);
    const left = Math.round((dbDate(ymd).getTime() - dbDate(today).getTime()) / 86_400_000);
    out.push({
      kind: 'DOCUMENT_EXPIRY',
      severity: left < 0 ? 'danger' : 'warning',
      title: left < 0 ? 'وثيقة منتهية الصلاحية' : 'وثيقة تقترب من الانتهاء',
      message: `${what} للموظف ${e.fullName} ${left < 0 ? `انتهت منذ ${-left} يوم` : left === 0 ? 'تنتهي اليوم' : `تنتهي بعد ${left} يوم`} (${ymd})`,
      href: `/employees/${e.id}?tab=documents`,
      meta: { employeeId: e.id, date: ymd, daysLeft: left },
    });
  };
  for (const e of employees) {
    const seen = new Set<string>();
    if (e.idExpiryDate && e.idExpiryDate <= limit) {
      push(e, 'بطاقة التعريف', e.idExpiryDate);
      seen.add(`ID|${ymdOf(e.idExpiryDate)}`);
    }
    if (e.drivingLicenseExpiry && e.drivingLicenseExpiry <= limit) {
      push(e, 'رخصة القيادة', e.drivingLicenseExpiry);
      seen.add(`DL|${ymdOf(e.drivingLicenseExpiry)}`);
    }
    for (const d of e.documents) {
      const key = `${d.type === 'ID_FRONT' || d.type === 'ID_BACK' ? 'ID' : d.type === 'DRIVING_LICENSE' ? 'DL' : d.type}|${ymdOf(d.expiryDate!)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      push(e, d.title || DOCUMENT_TYPE_LABELS[d.type], d.expiryDate!);
    }
  }
  return out.sort((a, b) => Number(a.meta.daysLeft) - Number(b.meta.daysLeft));
}
