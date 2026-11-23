import { Prisma } from '@prisma/client';
import { Errors } from '../errors';

// ─── التواريخ ───────────────────────────────────────────────────
// أيام الحضور والفترات تُحسب بالتاريخ المحلي حسب المنطقة الزمنية في الإعدادات (افتراضياً Africa/Algiers)

/** يعيد التاريخ المحلي بصيغة YYYY-MM-DD */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** يحوّل YYYY-MM-DD إلى Date (منتصف ليل UTC) لعمود @db.Date */
export function dbDate(ymd: string): Date {
  if (!DATE_RE.test(ymd)) throw Errors.validation(`تاريخ غير صحيح: ${ymd}`);
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd) throw Errors.validation(`تاريخ غير صحيح: ${ymd}`);
  return d;
}

export function ymdOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** عدد الأيام بين تاريخين شاملاً الطرفين */
export function daysInclusive(from: string, to: string): number {
  return Math.round((dbDate(to).getTime() - dbDate(from).getTime()) / 86_400_000) + 1;
}

/** بداية ونهاية شهر بصيغة YYYY-MM */
export function monthRange(ym: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}$/.test(ym)) throw Errors.validation('الشهر يجب أن يكون بصيغة YYYY-MM');
  const [y, m] = ym.split('-').map(Number);
  if (m < 1 || m > 12) throw Errors.validation('شهر غير صحيح');
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

// ─── المبالغ ────────────────────────────────────────────────────
// الحساب يتم بأعداد صحيحة (سنتيمات) لتفادي أخطاء الكسور العشرية، ثم يُخزَّن Decimal(14,2)

export type Money = Prisma.Decimal | number | string | null | undefined;

export function toCents(v: Money): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'object' ? Number(v.toString()) : Number(v);
  if (!Number.isFinite(n)) throw Errors.validation('مبلغ غير صحيح');
  return Math.round(n * 100);
}

export function fromCents(c: number): string {
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(Math.round(c));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function decimal(c: number): Prisma.Decimal {
  return new Prisma.Decimal(fromCents(c));
}
