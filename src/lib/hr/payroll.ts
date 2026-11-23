import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Db } from '../db';
import { requireRole, type Actor } from '../actor';
import { writeAudit } from '../audit';
import { Errors } from '../errors';
import { getSettings } from '../settings';
import { payTypeHasBase, PAYOUT_STATUSES, type AppSettings, type PayoutStatus } from '../domain';
import { attendanceFor } from './attendance';
import { decimal, dbDate, fromCents, localDate, toCents, ymdOf } from './util';
import { payoutBulkSchema, payoutCreateSchema, payoutUpdateSchema, paymentSchema, periodSchema, rateSchema } from './validation';
import { pageSchema, pageSizeSchema } from '../validation';

type Tx = Prisma.TransactionClient;
type Reader = Db | Tx;
const HR: ['ADMIN'] = ['ADMIN'];

// ─── أسعار التوصيل الخاصة ───────────────────────────────────────

export async function listRates(db: Db, actor: Actor) {
  requireRole(actor, HR);
  const rates = await db.deliveryRate.findMany({
    where: { isActive: true },
    include: { employee: { select: { id: true, fullName: true, employeeNo: true } }, deliveryPoint: { select: { id: true, name: true } } },
    orderBy: [{ mode: 'asc' }, { updatedAt: 'desc' }],
  });
  return rates.map((r) => ({ ...r, amount: r.amount.toString() }));
}

/** إضافة سعر خاص. إذا وُجد سعر نشط لنفس النطاق يُستبدل (ويبقى القديم في السجل غير نشط) */
export async function upsertRate(db: Db, actor: Actor, raw: unknown) {
  requireRole(actor, HR);
  const input = rateSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const same = await tx.deliveryRate.findFirst({
      where: { isActive: true, mode: input.mode, employeeId: input.employeeId, category: input.category, deliveryPointId: input.deliveryPointId },
    });
    if (same) await tx.deliveryRate.update({ where: { id: same.id }, data: { isActive: false } });
    const rate = await tx.deliveryRate.create({ data: { ...input, amount: new Prisma.Decimal(input.amount) } });
    await writeAudit(tx, actor, { action: 'payroll.rate.set', entityType: 'delivery_rate', entityId: rate.id, before: same, after: rate });
    return { ...rate, amount: rate.amount.toString() };
  });
}

export async function deactivateRate(db: Db, actor: Actor, id: string) {
  requireRole(actor, HR);
  return db.$transaction(async (tx) => {
    const before = await tx.deliveryRate.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('السعر');
    const r = await tx.deliveryRate.update({ where: { id }, data: { isActive: false } });
    await writeAudit(tx, actor, { action: 'payroll.rate.remove', entityType: 'delivery_rate', entityId: id, before, after: r });
    return { removed: true };
  });
}

// ─── حساب المستحقات ─────────────────────────────────────────────

export interface PayoutCalc {
  employeeId: string;
  from: string;
  to: string;
  payType: 'PER_DELIVERY' | 'MONTHLY_OR_DAILY' | 'HYBRID';
  commissionMode: 'PER_UNIT' | 'PER_COLIS';
  monthlySalaryCents: number;
  dailyRateCents: number;
  dailyRateIsCustom: boolean;
  standardDays: number;
  workedDays: number;
  baseCents: number;
  deliveredUnits: number;
  deliveredColis: number;
  commissionCents: number;
  /** القطع التي أرجعها العملاء ومجموع العمولة الملغاة عنها (تُطرح) */
  returnedUnits: number;
  reversalCents: number;
  earningIds: string[];
  earningsBreakdown: { kind: 'DELIVERY' | 'RETURN_REVERSAL'; rateCents: number; mode: string; quantity: number; units: number; amountCents: number; rateSource: string }[];
  grossCents: number;
}

/**
 * الحساب الأساسي (دالة واحدة تُستخدم في المعاينة والحفظ والاختبارات):
 * - أيام العمل = أيام الحضور (تلقائياً من الاستلام والتسليم، أو يدوياً).
 * - أجر الأيام = أجر اليوم × أيام العمل، أو (الراتب الشهري × أيام العمل ÷ أيام العمل المعيارية).
 * - العمولة = مجموع عمولات التوصيل المسجلة لحظة التسليم وغير المدرجة في كشف سابق.
 */
export async function calculatePayout(
  db: Reader,
  employeeId: string,
  from: string,
  to: string,
  settings: AppSettings,
  opts: { includePayoutId?: string; includeAllAttached?: boolean } = {},
): Promise<PayoutCalc> {
  const emp = await db.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw Errors.notFound('الموظف');

  // نحسب الحضور داخل فترة عمل الموظف فقط
  const hire = ymdOf(emp.hireDate);
  const end = emp.terminationDate ? ymdOf(emp.terminationDate) : null;
  const effFrom = from < hire ? hire : from;
  const effTo = end && to > end ? end : to;
  const att =
    effFrom <= effTo
      ? await attendanceFor(db as Db, employeeId, effFrom, effTo)
      : { summary: { presentDays: 0, deliveredUnits: 0, deliveredColis: 0 } };

  const standardDays = emp.workDaysPerMonth ?? settings.standardWorkDays;
  const monthlySalaryCents = toCents(emp.monthlySalary);
  const customDaily = emp.dailyRate !== null && toCents(emp.dailyRate) > 0;
  const dailyRateCents = customDaily ? toCents(emp.dailyRate) : Math.round(monthlySalaryCents / standardDays);
  const workedDays = att.summary.presentDays;
  const baseCents = payTypeHasBase(emp.payType)
    ? customDaily
      ? dailyRateCents * workedDays
      : Math.round((monthlySalaryCents * workedDays) / standardDays)
    : 0;

  const earnings = await db.deliveryEarning.findMany({
    where: {
      employeeId,
      date: { gte: dbDate(from), lte: dbDate(to) },
      ...(opts.includeAllAttached ? {} : { OR: [{ payoutId: null }, ...(opts.includePayoutId ? [{ payoutId: opts.includePayoutId }] : [])] }),
    },
    orderBy: { date: 'asc' },
  });
  const delivered = earnings.filter((e) => e.kind === 'DELIVERY');
  const reversals = earnings.filter((e) => e.kind === 'RETURN_REVERSAL');
  const commissionCents = delivered.reduce((s, e) => s + toCents(e.amount), 0);
  const reversalCents = reversals.reduce((s, e) => s + toCents(e.amount), 0);
  const returnedUnits = reversals.reduce((s, e) => s + e.units, 0);
  const groups = new Map<string, PayoutCalc['earningsBreakdown'][number]>();
  for (const e of earnings) {
    const source = e.kind === 'RETURN_REVERSAL' ? 'إلغاء عمولة: مرتجعات العملاء' : e.rateSource;
    const k = `${e.kind}|${e.mode}|${toCents(e.rate)}|${source}`;
    const g = groups.get(k) ?? { kind: e.kind, rateCents: toCents(e.rate), mode: e.mode, quantity: 0, units: 0, amountCents: 0, rateSource: source };
    g.quantity += e.quantity;
    g.units += e.units;
    g.amountCents += toCents(e.amount);
    groups.set(k, g);
  }

  return {
    employeeId,
    from,
    to,
    payType: emp.payType,
    commissionMode: emp.commissionMode,
    monthlySalaryCents,
    dailyRateCents,
    dailyRateIsCustom: customDaily,
    standardDays,
    workedDays,
    baseCents,
    deliveredUnits: att.summary.deliveredUnits,
    deliveredColis: att.summary.deliveredColis,
    commissionCents,
    returnedUnits,
    reversalCents,
    earningIds: earnings.map((e) => e.id),
    earningsBreakdown: [...groups.values()],
    grossCents: baseCents + commissionCents - reversalCents,
  };
}

export function statusFor(netCents: number, paidCents: number): PayoutStatus {
  if (paidCents >= netCents) return 'PAID';
  if (paidCents > 0) return 'PARTIAL';
  return 'PENDING';
}

function serializeCalc(c: PayoutCalc) {
  const { earningIds, ...rest } = c;
  return {
    ...rest,
    earningsCount: earningIds.length,
    monthlySalary: fromCents(c.monthlySalaryCents),
    dailyRate: fromCents(c.dailyRateCents),
    baseAmount: fromCents(c.baseCents),
    commissionAmount: fromCents(c.commissionCents),
    reversalAmount: fromCents(c.reversalCents),
    grossAmount: fromCents(c.grossCents),
    earningsBreakdown: c.earningsBreakdown.map((g) => ({ ...g, rate: fromCents(g.rateCents), amount: fromCents(g.amountCents) })),
  };
}

export async function previewPayout(db: Db, actor: Actor, raw: Record<string, string | undefined>) {
  requireRole(actor, HR);
  const p = periodSchema.parse(raw);
  const settings = await getSettings(db);
  const calc = await calculatePayout(db, p.employeeId, p.from, p.to, settings);
  const overlapping = await db.payout.findFirst({
    where: { employeeId: p.employeeId, periodStart: { lte: dbDate(p.to) }, periodEnd: { gte: dbDate(p.from) } },
    select: { id: true, payoutNo: true },
  });
  return { ...serializeCalc(calc), overlapping };
}

// ─── الكشوف ─────────────────────────────────────────────────────

const payoutInclude = {
  employee: { select: { id: true, fullName: true, employeeNo: true, jobType: true, payType: true, deliveryPoint: { select: { name: true } } } },
  payments: { orderBy: { paidAt: 'asc' }, include: { createdBy: { select: { name: true } } } },
  createdBy: { select: { name: true } },
} satisfies Prisma.PayoutInclude;

type PayoutRow = Prisma.PayoutGetPayload<{ include: typeof payoutInclude }>;

export function serializePayout(p: PayoutRow) {
  const net = toCents(p.netAmount);
  const paid = toCents(p.paidAmount);
  return {
    ...p,
    periodStart: ymdOf(p.periodStart),
    periodEnd: ymdOf(p.periodEnd),
    monthlySalary: p.monthlySalary.toString(),
    dailyRate: p.dailyRate.toString(),
    baseAmount: p.baseAmount.toString(),
    commissionAmount: p.commissionAmount.toString(),
    reversalAmount: p.reversalAmount.toString(),
    bonusAmount: p.bonusAmount.toString(),
    deductionAmount: p.deductionAmount.toString(),
    netAmount: p.netAmount.toString(),
    paidAmount: p.paidAmount.toString(),
    remainingAmount: fromCents(Math.max(0, net - paid)),
    payments: p.payments.map((x) => ({ ...x, amount: x.amount.toString() })),
  };
}

function netOf(calc: PayoutCalc, bonusCents: number, deductionCents: number) {
  const net = calc.grossCents + bonusCents - deductionCents;
  if (net < 0) {
    if (calc.grossCents < 0) {
      throw Errors.validation(
        `عمولات المرتجعات الملغاة (${fromCents(calc.reversalCents)}) أكبر من مستحقات هذه الفترة (${fromCents(calc.baseCents + calc.commissionCents)}). وسّع الفترة لتشمل تسليمات أخرى، أو أضف مكافأة تعويضية`,
      );
    }
    throw Errors.validation(`الخصم (${fromCents(deductionCents)}) أكبر من إجمالي المستحق (${fromCents(calc.grossCents + bonusCents)})`);
  }
  return net;
}

async function lockPayout(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payroll_and_delivery_payouts WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) throw Errors.notFound('كشف المستحقات');
}

async function attachEarnings(tx: Tx, payoutId: string, ids: string[]) {
  if (!ids.length) return;
  const res = await tx.deliveryEarning.updateMany({ where: { id: { in: ids }, OR: [{ payoutId: null }, { payoutId }] }, data: { payoutId } });
  if (res.count !== ids.length) throw Errors.conflict('بعض عمولات التوصيل أُدرجت في كشف آخر للتو. أعد المحاولة');
}

async function createOne(tx: Tx, actor: Actor, settings: AppSettings, input: z.infer<typeof payoutCreateSchema>) {
  const calc = await calculatePayout(tx, input.employeeId, input.from, input.to, settings);
  const bonus = toCents(input.bonusAmount);
  const deduction = toCents(input.deductionAmount);
  const net = netOf(calc, bonus, deduction);
  const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('payout_no_seq') AS n`;
  const payout = await tx.payout.create({
    data: {
      payoutNo: `PAY-${String(n).padStart(6, '0')}`,
      employeeId: input.employeeId,
      periodStart: dbDate(input.from),
      periodEnd: dbDate(input.to),
      payType: calc.payType,
      monthlySalary: decimal(calc.monthlySalaryCents),
      dailyRate: decimal(calc.dailyRateCents),
      standardDays: calc.standardDays,
      workedDays: calc.workedDays,
      baseAmount: decimal(calc.baseCents),
      deliveredUnits: calc.deliveredUnits,
      deliveredColis: calc.deliveredColis,
      commissionAmount: decimal(calc.commissionCents),
      returnedUnits: calc.returnedUnits,
      reversalAmount: decimal(calc.reversalCents),
      bonusAmount: decimal(bonus),
      deductionAmount: decimal(deduction),
      netAmount: decimal(net),
      paidAmount: decimal(0),
      status: statusFor(net, 0),
      notes: input.notes,
      createdById: actor.id,
    },
  });
  await attachEarnings(tx, payout.id, calc.earningIds);
  await writeAudit(tx, actor, { action: 'payroll.payout.create', entityType: 'payout', entityId: payout.id, after: payout });
  return payout;
}

export async function createPayout(db: Db, actor: Actor, raw: unknown) {
  requireRole(actor, HR);
  const input = payoutCreateSchema.parse(raw);
  const settings = await getSettings(db);
  const p = await db.$transaction((tx) => createOne(tx, actor, settings, input));
  return serializePayout(await db.payout.findUniqueOrThrow({ where: { id: p.id }, include: payoutInclude }));
}

/** إنشاء كشوف كل الموظفين النشطين لفترة (مثلاً شهر). يتخطى من له كشف متداخل */
export async function createPayoutsBulk(db: Db, actor: Actor, raw: unknown) {
  requireRole(actor, HR);
  const input = payoutBulkSchema.parse(raw);
  const settings = await getSettings(db);
  const employees = await db.employee.findMany({
    where: {
      hireDate: { lte: dbDate(input.to) },
      OR: [{ status: { not: 'TERMINATED' } }, { terminationDate: { gte: dbDate(input.from) } }],
      ...(input.deliveryPointId ? { deliveryPointId: input.deliveryPointId } : {}),
    },
    select: { id: true, fullName: true },
    orderBy: { fullName: 'asc' },
  });
  const created: string[] = [];
  const skipped: { employee: string; reason: string }[] = [];
  for (const e of employees) {
    const overlap = await db.payout.findFirst({
      where: { employeeId: e.id, periodStart: { lte: dbDate(input.to) }, periodEnd: { gte: dbDate(input.from) } },
      select: { payoutNo: true },
    });
    if (overlap) {
      skipped.push({ employee: e.fullName, reason: `له كشف ${overlap.payoutNo} في نفس الفترة` });
      continue;
    }
    try {
      const p = await db.$transaction((tx) => createOne(tx, actor, settings, { employeeId: e.id, from: input.from, to: input.to, bonusAmount: 0, deductionAmount: 0, notes: null }));
      created.push(p.payoutNo);
    } catch (err) {
      skipped.push({ employee: e.fullName, reason: (err as { messageAr?: string }).messageAr ?? 'تعذر الإنشاء' });
    }
  }
  return { created, skipped };
}

/** إعادة الحساب (مثلاً بعد تسليمات جديدة داخل الفترة أو تعديل المكافأة والخصم) */
export async function updatePayout(db: Db, actor: Actor, id: string, raw: unknown) {
  requireRole(actor, HR);
  const input = payoutUpdateSchema.parse(raw ?? {});
  const settings = await getSettings(db);
  await db.$transaction(async (tx) => {
    await lockPayout(tx, id);
    const before = await tx.payout.findUniqueOrThrow({ where: { id } });
    const calc = await calculatePayout(tx, before.employeeId, ymdOf(before.periodStart), ymdOf(before.periodEnd), settings, { includePayoutId: id });
    const bonus = input.bonusAmount !== undefined ? toCents(input.bonusAmount) : toCents(before.bonusAmount);
    const deduction = input.deductionAmount !== undefined ? toCents(input.deductionAmount) : toCents(before.deductionAmount);
    const net = netOf(calc, bonus, deduction);
    const paid = toCents(before.paidAmount);
    if (net < paid) throw Errors.conflict(`الصافي الجديد (${fromCents(net)}) أقل من المدفوع فعلاً (${fromCents(paid)}). احذف دفعة أولاً`);
    const after = await tx.payout.update({
      where: { id },
      data: {
        payType: calc.payType,
        monthlySalary: decimal(calc.monthlySalaryCents),
        dailyRate: decimal(calc.dailyRateCents),
        standardDays: calc.standardDays,
        workedDays: calc.workedDays,
        baseAmount: decimal(calc.baseCents),
        deliveredUnits: calc.deliveredUnits,
        deliveredColis: calc.deliveredColis,
        commissionAmount: decimal(calc.commissionCents),
        returnedUnits: calc.returnedUnits,
        reversalAmount: decimal(calc.reversalCents),
        bonusAmount: decimal(bonus),
        deductionAmount: decimal(deduction),
        netAmount: decimal(net),
        status: statusFor(net, paid),
        notes: input.notes !== undefined ? input.notes : before.notes,
      },
    });
    await attachEarnings(tx, id, calc.earningIds);
    await writeAudit(tx, actor, { action: 'payroll.payout.recalculate', entityType: 'payout', entityId: id, before, after });
  });
  return serializePayout(await db.payout.findUniqueOrThrow({ where: { id }, include: payoutInclude }));
}

export async function deletePayout(db: Db, actor: Actor, id: string) {
  requireRole(actor, HR);
  return db.$transaction(async (tx) => {
    await lockPayout(tx, id);
    const before = await tx.payout.findUniqueOrThrow({ where: { id } });
    if (toCents(before.paidAmount) > 0) throw Errors.conflict('لا يمكن حذف كشف عليه دفعات. احذف الدفعات أولاً');
    await tx.deliveryEarning.updateMany({ where: { payoutId: id }, data: { payoutId: null } });
    await tx.payout.delete({ where: { id } });
    await writeAudit(tx, actor, { action: 'payroll.payout.delete', entityType: 'payout', entityId: id, before });
    return { deleted: true };
  });
}

// ─── الدفعات ────────────────────────────────────────────────────

export async function addPayment(db: Db, actor: Actor, payoutId: string, raw: unknown) {
  requireRole(actor, HR);
  const input = paymentSchema.parse(raw);
  const existing = await db.payoutPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (existing.payoutId !== payoutId || toCents(existing.amount) !== toCents(input.amount)) {
      throw Errors.conflict('مفتاح منع التكرار مستخدم لدفعة مختلفة');
    }
    return serializePayout(await db.payout.findUniqueOrThrow({ where: { id: payoutId }, include: payoutInclude }));
  }
  try {
    await db.$transaction(async (tx) => {
      await lockPayout(tx, payoutId);
      const p = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
      const net = toCents(p.netAmount);
      const paid = toCents(p.paidAmount);
      const amount = toCents(input.amount);
      if (amount > net - paid) throw Errors.validation(`مبلغ الدفعة (${fromCents(amount)}) أكبر من المتبقي (${fromCents(net - paid)})`);
      const pay = await tx.payoutPayment.create({
        data: {
          payoutId,
          idempotencyKey: input.idempotencyKey,
          amount: decimal(amount),
          method: input.method,
          reference: input.reference,
          note: input.note,
          paidAt: input.paidAt,
          createdById: actor.id,
        },
      });
      await tx.payout.update({ where: { id: payoutId }, data: { paidAmount: decimal(paid + amount), status: statusFor(net, paid + amount) } });
      await writeAudit(tx, actor, { action: 'payroll.payment.add', entityType: 'payout', entityId: payoutId, after: pay });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return serializePayout(await db.payout.findUniqueOrThrow({ where: { id: payoutId }, include: payoutInclude }));
    }
    throw err;
  }
  return serializePayout(await db.payout.findUniqueOrThrow({ where: { id: payoutId }, include: payoutInclude }));
}

export async function deletePayment(db: Db, actor: Actor, paymentId: string) {
  requireRole(actor, HR);
  const pay = await db.payoutPayment.findUnique({ where: { id: paymentId } });
  if (!pay) throw Errors.notFound('الدفعة');
  await db.$transaction(async (tx) => {
    await lockPayout(tx, pay.payoutId);
    const p = await tx.payout.findUniqueOrThrow({ where: { id: pay.payoutId } });
    const paid = toCents(p.paidAmount) - toCents(pay.amount);
    await tx.payoutPayment.delete({ where: { id: paymentId } });
    await tx.payout.update({ where: { id: p.id }, data: { paidAmount: decimal(paid), status: statusFor(toCents(p.netAmount), paid) } });
    await writeAudit(tx, actor, { action: 'payroll.payment.delete', entityType: 'payout', entityId: p.id, before: pay });
  });
  return serializePayout(await db.payout.findUniqueOrThrow({ where: { id: pay.payoutId }, include: payoutInclude }));
}

// ─── القراءة ────────────────────────────────────────────────────

const listQuery = z.object({
  employeeId: z.string().max(64).optional(),
  status: z.enum(PAYOUT_STATUSES).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
});

export async function listPayouts(db: Db, actor: Actor, raw: Record<string, string | undefined>) {
  requireRole(actor, HR);
  const q = listQuery.parse(raw);
  const where: Prisma.PayoutWhereInput = {};
  if (q.employeeId) where.employeeId = q.employeeId;
  if (q.status) where.status = q.status;
  if (q.from) where.periodEnd = { gte: dbDate(q.from) };
  if (q.to) where.periodStart = { lte: dbDate(q.to) };
  const [total, items, sums] = await Promise.all([
    db.payout.count({ where }),
    db.payout.findMany({ where, include: payoutInclude, orderBy: [{ periodStart: 'desc' }, { payoutNo: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    db.payout.aggregate({ where, _sum: { netAmount: true, paidAmount: true, commissionAmount: true, reversalAmount: true, baseAmount: true, deliveredUnits: true, returnedUnits: true } }),
  ]);
  const net = toCents(sums._sum.netAmount);
  const paid = toCents(sums._sum.paidAmount);
  return {
    items: items.map(serializePayout),
    total,
    page: q.page,
    pageSize: q.pageSize,
    totals: {
      net: fromCents(net),
      paid: fromCents(paid),
      remaining: fromCents(net - paid),
      commission: fromCents(toCents(sums._sum.commissionAmount)),
      reversal: fromCents(toCents(sums._sum.reversalAmount)),
      returnedUnits: sums._sum.returnedUnits ?? 0,
      base: fromCents(toCents(sums._sum.baseAmount)),
      deliveredUnits: sums._sum.deliveredUnits ?? 0,
    },
  };
}

export async function getPayout(db: Db, actor: Actor, id: string) {
  requireRole(actor, HR);
  const p = await db.payout.findUnique({ where: { id }, include: payoutInclude });
  if (!p) throw Errors.notFound('كشف المستحقات');
  const earnings = await db.deliveryEarning.findMany({
    where: { payoutId: id },
    orderBy: { date: 'asc' },
    include: { operation: { select: { id: true, opNo: true } }, sourceOperation: { select: { id: true, opNo: true } } },
  });
  return {
    ...serializePayout(p),
    earnings: earnings.map((e) => ({ ...e, date: ymdOf(e.date), rate: e.rate.toString(), amount: e.amount.toString() })),
  };
}

/** مستحقات السائق نفسه (للعرض في تطبيقه، للقراءة فقط) */
export async function myEarnings(db: Db, actor: Actor) {
  if (actor.role !== 'DRIVER' || !actor.driverId) throw Errors.forbidden();
  const driver = await db.driver.findUnique({ where: { id: actor.driverId }, select: { employeeId: true } });
  if (!driver?.employeeId) return null;
  const settings = await getSettings(db);
  const today = localDate(new Date(), settings.timezone);
  const from = `${today.slice(0, 7)}-01`;
  // عرض الشهر كاملاً للسائق، بما فيه العمولات التي أُدرجت في كشف
  const calc = await calculatePayout(db, driver.employeeId, from, today, settings, { includeAllAttached: true });
  const payouts = await db.payout.findMany({
    where: { employeeId: driver.employeeId },
    orderBy: { periodStart: 'desc' },
    take: 6,
    select: { id: true, payoutNo: true, periodStart: true, periodEnd: true, netAmount: true, paidAmount: true, status: true },
  });
  const s = serializeCalc(calc);
  return {
    month: today.slice(0, 7),
    from,
    to: today,
    payType: s.payType,
    commissionMode: s.commissionMode,
    workedDays: s.workedDays,
    deliveredUnits: s.deliveredUnits,
    deliveredColis: s.deliveredColis,
    baseAmount: s.baseAmount,
    commissionAmount: s.commissionAmount,
    returnedUnits: s.returnedUnits,
    reversalAmount: s.reversalAmount,
    grossAmount: s.grossAmount,
    earningsBreakdown: s.earningsBreakdown,
    payouts: payouts.map((p) => ({
      ...p,
      periodStart: ymdOf(p.periodStart),
      periodEnd: ymdOf(p.periodEnd),
      netAmount: p.netAmount.toString(),
      paidAmount: p.paidAmount.toString(),
      remainingAmount: fromCents(Math.max(0, toCents(p.netAmount) - toCents(p.paidAmount))),
    })),
  };
}
