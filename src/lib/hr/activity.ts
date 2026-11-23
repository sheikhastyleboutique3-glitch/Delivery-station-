import type { Prisma } from '@prisma/client';
import { getSettings } from '../settings';
import { payTypeHasCommission, type AppSettings, type CommissionMode } from '../domain';
import { decimal, localDate, dbDate, toCents } from './util';

type Tx = Prisma.TransactionClient;

export interface ResolvedRate {
  cents: number;
  source: string;
}

/**
 * سعر التوصيل المعتمد. الأكثر تحديداً يفوز:
 * موظف (+ فئة) > فئة المنتج > نقطة الدليفري > السعر الافتراضي في الإعدادات.
 * في نمط "لكل طرد" لا معنى للفئة لأن الطرد قد يجمع عدة فئات، فتُتجاهل.
 */
export async function resolveRate(
  tx: Tx,
  args: { employeeId: string; mode: CommissionMode; category: string | null; pointId: string | null; settings: AppSettings },
): Promise<ResolvedRate> {
  const category = args.mode === 'PER_COLIS' ? null : args.category;
  const rates = await tx.deliveryRate.findMany({
    where: {
      isActive: true,
      mode: args.mode,
      AND: [
        { OR: [{ employeeId: null }, { employeeId: args.employeeId }] },
        { OR: [{ category: null }, ...(category ? [{ category }] : [])] },
        { OR: [{ deliveryPointId: null }, ...(args.pointId ? [{ deliveryPointId: args.pointId }] : [])] },
      ],
    },
  });
  const score = (r: (typeof rates)[number]) => (r.employeeId ? 4 : 0) + (r.category ? 2 : 0) + (r.deliveryPointId ? 1 : 0);
  const best = rates.sort((a, b) => score(b) - score(a) || b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  if (best) {
    const parts = [best.employeeId && 'موظف', best.category && `فئة: ${best.category}`, best.deliveryPointId && 'نقطة'].filter(Boolean);
    return { cents: toCents(best.amount), source: `${best.label ?? 'سعر خاص'} (${parts.join(' + ')})` };
  }
  const dflt = args.mode === 'PER_COLIS' ? args.settings.defaultRatePerColis : args.settings.defaultRatePerUnit;
  return { cents: toCents(dflt), source: 'السعر الافتراضي' };
}

/** تسجيل الحضور تلقائياً (إدخال أو زيادة ذرّية، آمن مع الطلبات المتزامنة) */
async function upsertAttendance(
  tx: Tx,
  employeeId: string,
  day: Date,
  source: 'AUTO_DISPATCH' | 'AUTO_DELIVERY',
  counts: { received: number; units: number; colis: number },
) {
  await tx.$executeRaw`
    INSERT INTO attendance_logs (id, employee_id, date, status, source, received_units, delivered_units, delivered_colis,
                                 first_activity_at, last_activity_at, created_at, updated_at)
    VALUES (gen_random_uuid()::text, ${employeeId}, ${day}::date, 'PRESENT', ${source}::"AttendanceSource",
            ${counts.received}::int, ${counts.units}::int, ${counts.colis}::int, now(), now(), now(), now())
    ON CONFLICT (employee_id, date) DO UPDATE SET
      status = 'PRESENT',
      source = CASE WHEN attendance_logs.status = 'PRESENT' THEN attendance_logs.source ELSE EXCLUDED.source END,
      received_units = attendance_logs.received_units + EXCLUDED.received_units,
      delivered_units = attendance_logs.delivered_units + EXCLUDED.delivered_units,
      delivered_colis = attendance_logs.delivered_colis + EXCLUDED.delivered_colis,
      first_activity_at = LEAST(COALESCE(attendance_logs.first_activity_at, now()), now()),
      last_activity_at = now(),
      updated_at = now()`;
}

async function employeeOfDriver(tx: Tx, driverId: string) {
  const d = await tx.driver.findUnique({
    where: { id: driverId },
    select: { id: true, deliveryPointId: true, employee: { select: { id: true, payType: true, commissionMode: true, status: true } } },
  });
  return d;
}

/** عند صرف بضاعة للسائق: يُحتسب حاضراً في ذلك اليوم */
export async function recordDispatchActivity(tx: Tx, driverId: string, units: number) {
  const d = await employeeOfDriver(tx, driverId);
  if (!d?.employee) return;
  const settings = await getSettings(tx);
  const day = dbDate(localDate(new Date(), settings.timezone));
  await upsertAttendance(tx, d.employee.id, day, 'AUTO_DISPATCH', { received: units, units: 0, colis: 0 });
}

/**
 * عند التسليم للعميل: حضور + عدد القطع والطرود المسلّمة + عمولة التوصيل
 * بالسعر المعتمد لحظة التسليم (تُحفظ ولا تتغير إذا تغيّر السعر لاحقاً).
 */
export async function recordDeliveryActivity(tx: Tx, args: { driverId: string; operationId: string; lines: { productId: string; quantity: number }[] }) {
  const d = await employeeOfDriver(tx, args.driverId);
  if (!d?.employee) return;
  const emp = d.employee;
  const settings = await getSettings(tx);
  const today = localDate(new Date(), settings.timezone);
  const day = dbDate(today);
  const units = args.lines.reduce((s, l) => s + l.quantity, 0);
  if (units <= 0) return;

  await upsertAttendance(tx, emp.id, day, 'AUTO_DELIVERY', { received: 0, units, colis: 1 });

  if (!payTypeHasCommission(emp.payType)) return;

  if (emp.commissionMode === 'PER_COLIS') {
    const rate = await resolveRate(tx, { employeeId: emp.id, mode: 'PER_COLIS', category: null, pointId: d.deliveryPointId, settings });
    await tx.deliveryEarning.create({
      data: {
        employeeId: emp.id,
        driverId: d.id,
        operationId: args.operationId,
        date: day,
        mode: 'PER_COLIS',
        quantity: 1,
        units,
        rate: decimal(rate.cents),
        amount: decimal(rate.cents),
        rateSource: rate.source,
      },
    });
    return;
  }

  // لكل قطعة: سطر لكل فئة منتج لأن السعر قد يختلف حسب الفئة
  const products = await tx.product.findMany({
    where: { id: { in: [...new Set(args.lines.map((l) => l.productId))] } },
    select: { id: true, category: true },
  });
  const catOf = new Map(products.map((p) => [p.id, p.category]));
  const byCategory = new Map<string, number>();
  for (const l of args.lines) {
    const c = catOf.get(l.productId) ?? '';
    byCategory.set(c, (byCategory.get(c) ?? 0) + l.quantity);
  }
  for (const [category, qty] of [...byCategory.entries()].sort()) {
    const rate = await resolveRate(tx, { employeeId: emp.id, mode: 'PER_UNIT', category: category || null, pointId: d.deliveryPointId, settings });
    await tx.deliveryEarning.create({
      data: {
        employeeId: emp.id,
        driverId: d.id,
        operationId: args.operationId,
        date: day,
        mode: 'PER_UNIT',
        category: category || null,
        quantity: qty,
        units: qty,
        rate: decimal(rate.cents),
        amount: decimal(rate.cents * qty),
        rateSource: rate.source,
      },
    });
  }
}
