import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { Db } from '../db';
import { requireRole, scopedPointId, type Actor } from '../actor';
import { COLORS, COLOR_META, MOVEMENT_LABELS, SCAN_SOURCE_LABELS, type StockColor } from '../domain';
import { getSettings } from '../settings';
import { movementInclude, movementWhere, movementQuerySchema, parseDateRange } from './queries';

export const REPORT_KINDS = ['movements', 'custody', 'drivers', 'returns', 'inventory'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_TITLES: Record<ReportKind, string> = {
  movements: 'حركة المستودع',
  custody: 'عهدة السائقين الحالية',
  drivers: 'أداء السائقين',
  returns: 'المرتجعات والتالف',
  inventory: 'الجرد حسب اللون',
};

export interface Report {
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
}

const MAX_ROWS = 20_000;

const reportQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  pointId: z.string().max(64).optional(),
  driverId: z.string().max(64).optional(),
});

export async function buildReport(db: Db, actor: Actor, kind: ReportKind, raw: Record<string, string | undefined>): Promise<Report> {
  requireRole(actor, ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER']);
  const q = reportQuery.parse(raw);
  const settings = await getSettings(db);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const date = (d: Date | null | undefined) => (d ? fmt.format(d) : '');
  const color = (c: StockColor | null) => (c ? COLOR_META[c].label : '—');
  const scope = scopedPointId(actor);
  const pointId = scope ?? q.pointId;

  if (kind === 'movements' || kind === 'returns') {
    const mq = movementQuerySchema.parse({ from: q.from, to: q.to, pointId, driverId: q.driverId });
    const where = movementWhere(actor, mq);
    if (kind === 'returns') {
      where.AND = [
        ...((where.AND as object[]) ?? []),
        { type: { in: ['RETURN_GOOD', 'RETURN_DAMAGED', 'SORT_TO_DAMAGED', 'CUSTOMER_RETURN', 'SHORTAGE', 'WRITE_OFF'] } },
      ];
    }
    const rows = await db.stockMovement.findMany({ where, include: movementInclude, orderBy: { movementNo: 'asc' }, take: MAX_ROWS });
    return {
      title: REPORT_TITLES[kind],
      columns: [
        { key: 'no', label: 'رقم الحركة' },
        { key: 'date', label: 'التاريخ' },
        { key: 'op', label: 'السند' },
        { key: 'type', label: 'نوع الحركة' },
        { key: 'product', label: 'المنتج' },
        { key: 'sku', label: 'SKU' },
        { key: 'qty', label: 'الكمية' },
        { key: 'from', label: 'من' },
        { key: 'to', label: 'إلى' },
        { key: 'point', label: 'النقطة' },
        { key: 'driver', label: 'السائق' },
        { key: 'customer', label: 'العميل' },
        { key: 'reason', label: 'السبب' },
        { key: 'serials', label: 'الأرقام التسلسلية' },
        { key: 'scan', label: 'مصدر المسح' },
        { key: 'user', label: 'المنفّذ' },
      ],
      rows: rows.map((m) => ({
        no: m.movementNo,
        date: date(m.createdAt),
        op: m.operation.opNo,
        type: MOVEMENT_LABELS[m.type],
        product: m.product.name,
        sku: m.product.sku,
        qty: m.quantity,
        from: color(m.fromColor),
        to: color(m.toColor),
        point: [m.fromPoint?.name, m.toPoint?.name].filter((v, i, a) => v && a.indexOf(v) === i).join(' ← '),
        driver: m.driver?.fullName ?? '',
        customer: m.customer?.name ?? '',
        reason: m.reason ?? '',
        serials: m.unitSerials.join(' '),
        scan: m.scanSource ? SCAN_SOURCE_LABELS[m.scanSource] : '',
        user: m.performedBy.name,
      })),
    };
  }

  if (kind === 'custody') {
    const rows = await db.driverCustody.findMany({
      where: { quantity: { gt: 0 }, ...(pointId ? { deliveryPointId: pointId } : {}), ...(q.driverId ? { driverId: q.driverId } : {}) },
      include: {
        driver: { select: { fullName: true, phone: true } },
        product: { select: { name: true, sku: true, price: true } },
        deliveryPoint: { select: { name: true } },
      },
      orderBy: [{ driverId: 'asc' }, { nonzeroSince: 'asc' }],
      take: MAX_ROWS,
    });
    return {
      title: REPORT_TITLES.custody,
      columns: [
        { key: 'driver', label: 'السائق' },
        { key: 'phone', label: 'الهاتف' },
        { key: 'product', label: 'المنتج' },
        { key: 'sku', label: 'SKU' },
        { key: 'qty', label: 'الكمية' },
        { key: 'value', label: `القيمة (${settings.currency})` },
        { key: 'point', label: 'نقطة المصدر' },
        { key: 'since', label: 'منذ' },
      ],
      rows: rows.map((r) => ({
        driver: r.driver.fullName,
        phone: r.driver.phone,
        product: r.product.name,
        sku: r.product.sku,
        qty: r.quantity,
        value: Number(r.product.price) * r.quantity,
        point: r.deliveryPoint.name,
        since: date(r.nonzeroSince),
      })),
    };
  }

  if (kind === 'drivers') {
    const range = parseDateRange(q.from, q.to);
    const drivers = await db.driver.findMany({
      where: pointId ? { deliveryPointId: pointId } : {},
      select: { id: true, fullName: true, phone: true, status: true, lastSettledAt: true, deliveryPoint: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
    });
    const sums = await db.stockMovement.groupBy({
      by: ['driverId', 'type'],
      where: { driverId: { in: drivers.map((d) => d.id) }, ...(range ? { createdAt: range } : {}) },
      _sum: { quantity: true },
    });
    const custody = await db.driverCustody.groupBy({ by: ['driverId'], where: { quantity: { gt: 0 } }, _sum: { quantity: true } });
    const get = (id: string, t: string) => sums.find((s) => s.driverId === id && s.type === t)?._sum.quantity ?? 0;
    return {
      title: REPORT_TITLES.drivers,
      columns: [
        { key: 'driver', label: 'السائق' },
        { key: 'point', label: 'النقطة' },
        { key: 'dispatched', label: 'المصروف' },
        { key: 'delivered', label: 'المسلّم' },
        { key: 'returnedGood', label: 'مرتجع سليم' },
        { key: 'returnedDamaged', label: 'مرتجع تالف' },
        { key: 'shortage', label: 'عجز' },
        { key: 'rate', label: 'نسبة التسليم %' },
        { key: 'custody', label: 'العهدة الحالية' },
        { key: 'lastSettled', label: 'آخر تسوية' },
      ],
      rows: drivers.map((d) => {
        const dispatched = get(d.id, 'DISPATCH');
        const delivered = get(d.id, 'DELIVERED');
        return {
          driver: d.fullName,
          point: d.deliveryPoint.name,
          dispatched,
          delivered,
          returnedGood: get(d.id, 'RETURN_GOOD'),
          returnedDamaged: get(d.id, 'RETURN_DAMAGED'),
          shortage: get(d.id, 'SHORTAGE'),
          rate: dispatched ? Math.round((delivered / dispatched) * 1000) / 10 : 0,
          custody: custody.find((c) => c.driverId === d.id)?._sum.quantity ?? 0,
          lastSettled: date(d.lastSettledAt),
        };
      }),
    };
  }

  // inventory
  const balances = await db.stockColorBalance.findMany({
    where: { quantity: { gt: 0 }, ...(pointId ? { deliveryPointId: pointId } : {}), product: { isArchived: false } },
    include: { product: { select: { name: true, sku: true, barcode: true, category: true } }, deliveryPoint: { select: { name: true } } },
  });
  const map = new Map<string, Record<string, string | number | null>>();
  for (const b of balances) {
    const key = `${b.productId}|${b.deliveryPointId}`;
    if (!map.has(key)) {
      map.set(key, {
        product: b.product.name,
        sku: b.product.sku,
        barcode: b.product.barcode,
        category: b.product.category,
        point: b.deliveryPoint.name,
        ...Object.fromEntries(COLORS.map((c) => [c, 0])),
      });
    }
    (map.get(key)![b.color] as number) += b.quantity;
  }
  const rows = [...map.values()].sort((a, b) => String(a.product).localeCompare(String(b.product), 'ar'));
  for (const r of rows) r.total = COLORS.reduce((s, c) => s + Number(r[c]), 0);
  return {
    title: REPORT_TITLES.inventory,
    columns: [
      { key: 'product', label: 'المنتج' },
      { key: 'sku', label: 'SKU' },
      { key: 'barcode', label: 'الباركود' },
      { key: 'category', label: 'الفئة' },
      { key: 'point', label: 'النقطة' },
      ...COLORS.map((c) => ({ key: c, label: COLOR_META[c].label })),
      { key: 'total', label: 'الإجمالي' },
    ],
    rows,
  };
}

// ─── Export formats ─────────────────────────────────────────────

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  // منع حقن الصيغ في Excel (CSV injection)
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV بترميز UTF-8 مع BOM ليظهر العربي صحيحاً عند فتحه في Excel */
export function toCsv(report: Report): string {
  const lines = [report.columns.map((c) => csvCell(c.label)).join(',')];
  for (const r of report.rows) lines.push(report.columns.map((c) => csvCell(r[c.key])).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export async function toXlsx(report: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Rasd';
  wb.created = new Date();
  const ws = wb.addWorksheet(report.title.slice(0, 31), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = report.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 6) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  for (const r of report.rows) ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: report.columns.length } };
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
