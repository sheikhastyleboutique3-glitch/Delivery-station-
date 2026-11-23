import { afterAll, describe, expect, it } from 'vitest';
import { createEmployee, changeEmployeeStatus, updateEmployee } from '@/lib/hr/employees';
import { markAttendance, getMonthlyAttendance } from '@/lib/hr/attendance';
import { sniffMime, safeFileName, uploadDocument, deleteDocument } from '@/lib/hr/documents';
import {
  addPayment,
  calculatePayout,
  createPayout,
  deactivateRate,
  deletePayout,
  previewPayout,
  updatePayout,
  upsertRate,
  myEarnings,
} from '@/lib/hr/payroll';
import { localDate } from '@/lib/hr/util';
import { getSettings } from '@/lib/settings';
import { createDriver } from '@/lib/services/master-data';
import { deliver, dispatch, returnToWarehouse, stockIn } from '@/lib/services/stock-ops';
import { getAlerts } from '@/lib/services/alerts';
import { actorOf, fixture, key, prisma, rejects, setSetting } from './helpers';

afterAll(async () => {
  await setSetting('defaultRatePerUnit', 200);
  await setSetting('defaultRatePerColis', 200);
  await prisma.$disconnect();
});

let n = 0;
const nid = () => `HR${Date.now().toString(36)}${++n}`;

/** موظف سائق مرتبط بحساب دخول، ومنتج برصيد في نقطة الاختبار */
async function hrFixture(opts: { payType?: 'PER_DELIVERY' | 'MONTHLY_OR_DAILY' | 'HYBRID'; mode?: 'PER_UNIT' | 'PER_COLIS'; monthly?: number; daily?: number | null; stock?: number; category?: string } = {}) {
  const fx = await fixture();
  const emp = await createEmployee(prisma, fx.A.admin, {
    fullName: 'سائق الموارد البشرية',
    phone: '+213550000000',
    nationalId: nid(),
    jobType: 'DRIVER',
    deliveryPointId: fx.point.id,
    hireDate: '2026-01-01',
    payType: opts.payType ?? 'PER_DELIVERY',
    commissionMode: opts.mode ?? 'PER_UNIT',
    monthlySalary: opts.monthly ?? 0,
    dailyRate: opts.daily ?? null,
  });
  const driver = await prisma.driver.findUniqueOrThrow({ where: { employeeId: emp.id } });
  const user = await prisma.user.create({
    data: { name: 'drv', email: `${nid().toLowerCase()}@t.local`, passwordHash: 'x', role: 'DRIVER', deliveryPointId: fx.point.id },
  });
  await prisma.driver.update({ where: { id: driver.id }, data: { userId: user.id } });
  const dA = actorOf(user, driver.id);
  if (opts.category) await prisma.product.update({ where: { id: fx.product.id }, data: { category: opts.category } });
  if (opts.stock) await stockIn(prisma, fx.A.keeper, { idempotencyKey: key(), pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: opts.stock }] });
  const settings = await getSettings(prisma);
  const today = localDate(new Date(), settings.timezone);
  return { ...fx, emp, driver, dA, user, today, monthStart: `${today.slice(0, 7)}-01`, settings };
}

async function dispatchTo(h: Awaited<ReturnType<typeof hrFixture>>, qty: number) {
  return dispatch(prisma, h.A.keeper, { idempotencyKey: key(), driverId: h.driver.id, pointId: h.point.id, lines: [{ productId: h.product.id, quantity: qty }] });
}
async function deliverQty(h: Awaited<ReturnType<typeof hrFixture>>, qty: number) {
  return deliver(prisma, h.dA, { idempotencyKey: key(), driverId: h.driver.id, customerId: h.customer.id, lines: [{ productId: h.product.id, quantity: qty }] });
}

describe('عمولة التوصيل بالقطعة / بالطرد', () => {
  it('100 قطعة × 200 دج = 20,000 دج تلقائياً، مع حضور تلقائي وعدد المسلّم', async () => {
    const h = await hrFixture({ stock: 150 });
    await dispatchTo(h, 100);
    await deliverQty(h, 100);
    const earnings = await prisma.deliveryEarning.findMany({ where: { employeeId: h.emp.id } });
    expect(earnings).toHaveLength(1);
    expect(earnings[0]).toMatchObject({ mode: 'PER_UNIT', quantity: 100, units: 100, rateSource: 'السعر الافتراضي' });
    expect(earnings[0].rate.toString()).toBe('200');
    expect(earnings[0].amount.toString()).toBe('20000');

    const att = await getMonthlyAttendance(prisma, h.A.admin, h.emp.id, h.today.slice(0, 7));
    const day = att.logs.find((l) => l.date === h.today)!;
    expect(day).toMatchObject({ status: 'PRESENT', receivedUnits: 100, deliveredUnits: 100, deliveredColis: 1 });

    const calc = await calculatePayout(prisma, h.emp.id, h.monthStart, h.today, h.settings);
    expect(calc).toMatchObject({ workedDays: 1, deliveredUnits: 100, deliveredColis: 1, commissionCents: 2_000_000, baseCents: 0, grossCents: 2_000_000 });
  });

  it('تغيير السعر لاحقاً لا يغيّر العمولات المسجلة (لقطة وقت التسليم)', async () => {
    const h = await hrFixture({ stock: 50 });
    await dispatchTo(h, 20);
    await deliverQty(h, 10);
    await setSetting('defaultRatePerUnit', 250);
    try {
      await deliverQty(h, 10);
    } finally {
      await setSetting('defaultRatePerUnit', 200);
    }
    const rows = await prisma.deliveryEarning.findMany({ where: { employeeId: h.emp.id }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.amount.toString())).toEqual(['2000', '2500']);
  });

  it('لكل طرد: 3 طلبات مكتملة × 300 دج (سعر خاص للسائق) = 900 دج بغض النظر عن عدد القطع', async () => {
    const h = await hrFixture({ stock: 30, mode: 'PER_COLIS' });
    await upsertRate(prisma, h.A.admin, { mode: 'PER_COLIS', amount: 300, employeeId: h.emp.id });
    await dispatchTo(h, 12);
    await deliverQty(h, 5);
    await deliverQty(h, 4);
    await deliverQty(h, 3);
    const calc = await calculatePayout(prisma, h.emp.id, h.monthStart, h.today, h.settings);
    expect(calc.commissionCents).toBe(90_000);
    expect(calc.deliveredColis).toBe(3);
    expect(calc.deliveredUnits).toBe(12);
  });

  it('أولوية السعر: موظف > فئة > نقطة > الافتراضي', async () => {
    const cat = `cat-${nid()}`;
    const h = await hrFixture({ stock: 40, category: cat });
    await upsertRate(prisma, h.A.admin, { mode: 'PER_UNIT', amount: 180, deliveryPointId: h.point.id });
    await upsertRate(prisma, h.A.admin, { mode: 'PER_UNIT', amount: 150, category: cat });
    const empRate = await upsertRate(prisma, h.A.admin, { mode: 'PER_UNIT', amount: 220, employeeId: h.emp.id });
    await dispatchTo(h, 30);
    await deliverQty(h, 1); // 220
    await deactivateRate(prisma, h.A.admin, empRate.id);
    await deliverQty(h, 1); // 150 (الفئة)
    await prisma.product.update({ where: { id: h.product.id }, data: { category: `other-${nid()}` } });
    await deliverQty(h, 1); // 180 (النقطة)
    const rows = await prisma.deliveryEarning.findMany({ where: { employeeId: h.emp.id }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => Number(r.rate))).toEqual([220, 150, 180]);
  });

  it('الراتب الشهري فقط لا يُنشئ عمولات، لكن يسجل الحضور', async () => {
    const h = await hrFixture({ stock: 10, payType: 'MONTHLY_OR_DAILY', monthly: 30000 });
    await dispatchTo(h, 5);
    await deliverQty(h, 5);
    expect(await prisma.deliveryEarning.count({ where: { employeeId: h.emp.id } })).toBe(0);
    const calc = await calculatePayout(prisma, h.emp.id, h.monthStart, h.today, h.settings);
    expect(calc.workedDays).toBe(1);
    expect(calc.deliveredUnits).toBe(5);
  });
});

describe('الراتب الشهري وأيام العمل والهجين', () => {
  async function presentDays(h: Awaited<ReturnType<typeof hrFixture>>, month: string, count: number) {
    for (let d = 1; d <= count; d++) {
      await markAttendance(prisma, h.A.admin, h.emp.id, { date: `${month}-${String(d).padStart(2, '0')}`, status: 'PRESENT' });
    }
  }

  it('راتب 2,000,000 دج ÷ 26 يوماً معيارياً × 23 يوم عمل = 1,769,230.77 دج', async () => {
    const h = await hrFixture({ payType: 'MONTHLY_OR_DAILY', monthly: 2_000_000 });
    await presentDays(h, '2026-10', 23);
    await markAttendance(prisma, h.A.admin, h.emp.id, { date: '2026-10-24', status: 'ABSENT' });
    const calc = await calculatePayout(prisma, h.emp.id, '2026-10-01', '2026-10-31', { ...h.settings, standardWorkDays: 26 });
    expect(calc.workedDays).toBe(23);
    expect(calc.baseCents).toBe(176_923_077);
    expect(calc.dailyRateCents).toBe(Math.round(200_000_000 / 26));
  });

  it('أجر يومي محدد × أيام العمل + عمولة (هجين)', async () => {
    const h = await hrFixture({ payType: 'HYBRID', daily: 1500, stock: 20 });
    await presentDays(h, '2026-10', 4);
    const oct = await calculatePayout(prisma, h.emp.id, '2026-10-01', '2026-10-31', h.settings);
    expect(oct).toMatchObject({ workedDays: 4, baseCents: 600_000, commissionCents: 0 });
    await dispatchTo(h, 10);
    await deliverQty(h, 10);
    const now = await calculatePayout(prisma, h.emp.id, h.monthStart, h.today, h.settings);
    expect(now).toMatchObject({ workedDays: 1, baseCents: 150_000, commissionCents: 200_000, grossCents: 350_000 });
  });

  it('لا يُسجَّل حضور يدوي في المستقبل أو قبل الالتحاق', async () => {
    const h = await hrFixture();
    const e1 = await rejects(markAttendance(prisma, h.A.admin, h.emp.id, { date: '2099-01-01', status: 'PRESENT' }));
    expect(e1.messageAr).toMatch(/المستقبل/);
    const e2 = await rejects(markAttendance(prisma, h.A.admin, h.emp.id, { date: '2025-12-31', status: 'PRESENT' }));
    expect(e2.messageAr).toMatch(/قبل تاريخ التحاق/);
  });
});

describe('الكشوف والدفعات', () => {
  it('إنشاء كشف، منع التداخل، دفعة جزئية ثم كاملة، منع الدفع الزائد، ومنع تكرار الدفعة', async () => {
    const h = await hrFixture({ stock: 120 });
    await dispatchTo(h, 100);
    await deliverQty(h, 100);
    const payout = await createPayout(prisma, h.A.admin, { employeeId: h.emp.id, from: h.monthStart, to: h.today, bonusAmount: 1000, deductionAmount: 500 });
    expect(payout).toMatchObject({ commissionAmount: '20000', netAmount: '20500', paidAmount: '0', status: 'PENDING', deliveredUnits: 100 });
    expect(await prisma.deliveryEarning.count({ where: { employeeId: h.emp.id, payoutId: payout.id } })).toBe(1);

    const overlap = await rejects(createPayout(prisma, h.A.admin, { employeeId: h.emp.id, from: h.today, to: h.today }));
    expect(overlap.message + (overlap.messageAr ?? '')).toMatch(/payouts_no_overlap|يتداخل/);

    const k = key();
    const p1 = await addPayment(prisma, h.A.admin, payout.id, { idempotencyKey: k, amount: 10000, method: 'CASH' });
    expect(p1).toMatchObject({ status: 'PARTIAL', paidAmount: '10000', remainingAmount: '10500.00' });
    const again = await addPayment(prisma, h.A.admin, payout.id, { idempotencyKey: k, amount: 10000, method: 'CASH' });
    expect(again.paidAmount).toBe('10000');
    const over = await rejects(addPayment(prisma, h.A.admin, payout.id, { idempotencyKey: key(), amount: 99999, method: 'CCP' }));
    expect(over.messageAr).toMatch(/أكبر من المتبقي/);
    const p2 = await addPayment(prisma, h.A.admin, payout.id, { idempotencyKey: key(), amount: 10500, method: 'BARIDIMOB', reference: 'TX-1' });
    expect(p2).toMatchObject({ status: 'PAID', paidAmount: '20500', remainingAmount: '0.00' });

    const del = await rejects(deletePayout(prisma, h.A.admin, payout.id));
    expect(del.code).toBe('CONFLICT');
  });

  it('إعادة الحساب تضيف التسليمات الجديدة داخل الفترة ولا تسمح بصافٍ أقل من المدفوع', async () => {
    const h = await hrFixture({ stock: 50 });
    await dispatchTo(h, 30);
    await deliverQty(h, 10);
    const p = await createPayout(prisma, h.A.admin, { employeeId: h.emp.id, from: h.monthStart, to: h.today });
    expect(p.commissionAmount).toBe('2000');
    await deliverQty(h, 5);
    const r = await updatePayout(prisma, h.A.admin, p.id, {});
    expect(r).toMatchObject({ commissionAmount: '3000', netAmount: '3000', deliveredUnits: 15 });
    await addPayment(prisma, h.A.admin, p.id, { idempotencyKey: key(), amount: 3000, method: 'CASH' });
    const e = await rejects(updatePayout(prisma, h.A.admin, p.id, { deductionAmount: 100 }));
    expect(e.messageAr).toMatch(/أقل من المدفوع/);
  });

  it('حذف كشف بلا دفعات يعيد العمولات لتُدرج في كشف جديد', async () => {
    const h = await hrFixture({ stock: 10 });
    await dispatchTo(h, 4);
    await deliverQty(h, 4);
    const p = await createPayout(prisma, h.A.admin, { employeeId: h.emp.id, from: h.monthStart, to: h.today });
    await deletePayout(prisma, h.A.admin, p.id);
    const preview = await previewPayout(prisma, h.A.admin, { employeeId: h.emp.id, from: h.monthStart, to: h.today });
    expect(preview.commissionAmount).toBe('800.00');
    expect(preview.overlapping).toBeNull();
  });

  it('العمولة المسجلة لا تُعدَّل ولا تُحذف على مستوى قاعدة البيانات', async () => {
    const h = await hrFixture({ stock: 5 });
    await dispatchTo(h, 2);
    await deliverQty(h, 2);
    const e = await prisma.deliveryEarning.findFirstOrThrow({ where: { employeeId: h.emp.id } });
    const e1 = await rejects(prisma.$executeRaw`UPDATE delivery_earnings SET amount = 1 WHERE id = ${e.id}`);
    expect(e1.message).toMatch(/لا يمكن تعديلها/);
    const e2 = await rejects(prisma.$executeRaw`DELETE FROM delivery_earnings WHERE id = ${e.id}`);
    expect(e2.message).toMatch(/لا يمكن حذف/);
  });

  it('السائق يرى مستحقاته فقط، وغير المدير لا يصل للرواتب', async () => {
    const h = await hrFixture({ stock: 5 });
    await dispatchTo(h, 3);
    await deliverQty(h, 3);
    const mine = await myEarnings(prisma, h.dA);
    expect(mine).toMatchObject({ deliveredUnits: 3, commissionAmount: '600.00', workedDays: 1 });
    for (const a of [h.A.keeper, h.A.hub, h.dA]) {
      expect((await rejects(previewPayout(prisma, a, { employeeId: h.emp.id, from: h.monthStart, to: h.today }))).status).toBe(403);
      expect((await rejects(createPayout(prisma, a, { employeeId: h.emp.id, from: h.monthStart, to: h.today }))).status).toBe(403);
    }
    expect((await rejects(myEarnings(prisma, h.A.keeper))).status).toBe(403);
  });
});

describe('ملف الموظف والحالة', () => {
  it('إنهاء خدمة سائق لديه عهدة مرفوض؛ بعد الإرجاع يُعطَّل السائق وحساب دخوله ويُمنع الصرف له', async () => {
    const h = await hrFixture({ stock: 10 });
    await dispatchTo(h, 2);
    const e = await rejects(changeEmployeeStatus(prisma, h.A.admin, h.emp.id, { status: 'TERMINATED', terminationDate: h.today, terminationReason: 'استقالة' }));
    expect(e.messageAr).toMatch(/عهدة مفتوحة/);
    await returnToWarehouse(prisma, h.A.keeper, { idempotencyKey: key(), driverId: h.driver.id, receivingPointId: h.point.id, lines: [{ productId: h.product.id, quantity: 2, condition: 'GOOD' }] });
    const reasonless = await rejects(changeEmployeeStatus(prisma, h.A.admin, h.emp.id, { status: 'TERMINATED', terminationDate: h.today }));
    expect(reasonless.message).toMatch(/إلزاميان/);
    await changeEmployeeStatus(prisma, h.A.admin, h.emp.id, { status: 'TERMINATED', terminationDate: h.today, terminationReason: 'استقالة' });
    const [d, u, emp] = await Promise.all([
      prisma.driver.findUniqueOrThrow({ where: { id: h.driver.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: h.user.id } }),
      prisma.employee.findUniqueOrThrow({ where: { id: h.emp.id } }),
    ]);
    expect(d.status).toBe('INACTIVE');
    expect(u.isActive).toBe(false);
    expect(u.tokenVersion).toBe(1);
    expect(emp).toMatchObject({ status: 'TERMINATED', terminationReason: 'استقالة' });
    expect((await rejects(dispatchTo(h, 1))).messageAr).toMatch(/غير نشط|موقوف أو منتهٍ/);

    await changeEmployeeStatus(prisma, h.A.admin, h.emp.id, { status: 'ACTIVE' });
    const back = await prisma.employee.findUniqueOrThrow({ where: { id: h.emp.id } });
    expect(back).toMatchObject({ status: 'ACTIVE', terminationDate: null, terminationReason: null });
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: h.driver.id } })).status).toBe('AVAILABLE');
  });

  it('تعديل الملف الوظيفي يُحدّث سجل السائق، وإضافة سائق من شاشة السائقين تُنشئ ملفاً وظيفياً', async () => {
    const h = await hrFixture();
    await updateEmployee(prisma, h.A.admin, h.emp.id, { fullName: 'الاسم الجديد', phone: '+213661111111', vehiclePlate: '12345-116-16' });
    const d = await prisma.driver.findUniqueOrThrow({ where: { id: h.driver.id } });
    expect(d).toMatchObject({ fullName: 'الاسم الجديد', phone: '+213661111111', vehiclePlate: '12345-116-16' });

    const created = await createDriver(prisma, h.A.keeper, { fullName: 'سائق قديم', phone: '+213770000000', nationalId: nid(), deliveryPointId: h.point.id });
    const linked = await prisma.driver.findUniqueOrThrow({ where: { id: created.id }, include: { employee: true } });
    expect(linked.employee).toMatchObject({ fullName: 'سائق قديم', jobType: 'DRIVER', payType: 'PER_DELIVERY', status: 'ACTIVE' });
  });

  it('التحقق من التواريخ والراتب', async () => {
    const fx = await fixture();
    const base = { fullName: 'x', phone: '+213550000009', nationalId: nid(), jobType: 'ADMINISTRATIVE', hireDate: '2026-01-01' };
    expect((await rejects(createEmployee(prisma, fx.A.admin, { ...base, payType: 'MONTHLY_OR_DAILY', monthlySalary: 0 }))).message).toMatch(/حدد الراتب/);
    expect((await rejects(createEmployee(prisma, fx.A.admin, { ...base, nationalId: nid(), dateOfBirth: '2027-01-01' }))).message).toMatch(/تاريخ الميلاد/);
    expect((await rejects(createEmployee(prisma, fx.A.admin, { ...base, nationalId: nid(), jobType: 'DRIVER' }))).message).toMatch(/نقطة دليفري/);
    expect((await rejects(createEmployee(prisma, fx.A.keeper, { ...base, nationalId: nid() }))).status).toBe(403);
  });
});

describe('الوثائق', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const form = (bytes: Uint8Array, name: string, extra: Record<string, string> = {}) => {
    const f = new FormData();
    f.set('file', new File([bytes as BlobPart], name));
    f.set('type', extra.type ?? 'ID_FRONT');
    for (const [k, v] of Object.entries(extra)) if (k !== 'type') f.set(k, v);
    return f;
  };

  it('يتعرف على النوع من المحتوى وليس من الاسم', () => {
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffMime(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
    expect(safeFileName('../../etc/passwd.png', 'image/png')).toBe('passwd.png');
    expect(safeFileName('بطاقة "الهوية".exe', 'application/pdf')).toBe('بطاقة الهوية.pdf');
  });

  it('رفع صورة الهوية يحدّث تاريخ انتهاء البطاقة ويظهر تنبيه، ورفض الملفات المزيفة والكبيرة وغير المدير', async () => {
    const h = await hrFixture();
    const soon = localDate(new Date(Date.now() + 5 * 86_400_000), h.settings.timezone);
    const doc = await uploadDocument(prisma, h.A.admin, h.emp.id, form(PNG, 'id.png', { type: 'ID_FRONT', expiryDate: soon, docNumber: '123' }));
    expect(doc).toMatchObject({ mimeType: 'image/png', sizeBytes: PNG.length, fileName: 'id.png' });
    const stored = await prisma.employeeDocumentFile.findUniqueOrThrow({ where: { documentId: doc.id } });
    expect(Buffer.from(stored.data).equals(Buffer.from(PNG))).toBe(true);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: h.emp.id } })).idExpiryDate?.toISOString().slice(0, 10)).toBe(soon);

    const alerts = await getAlerts(prisma, h.A.admin);
    expect(alerts.some((a) => a.kind === 'DOCUMENT_EXPIRY' && a.href.includes(h.emp.id) && /بعد 5 يوم/.test(a.message))).toBe(true);
    expect((await getAlerts(prisma, h.A.keeper)).some((a) => a.kind === 'DOCUMENT_EXPIRY')).toBe(false);

    const fake = await rejects(uploadDocument(prisma, h.A.admin, h.emp.id, form(new TextEncoder().encode('<html>'), 'photo.png')));
    expect(fake.messageAr).toMatch(/نوع الملف غير مسموح/);
    const big = await rejects(uploadDocument(prisma, h.A.admin, h.emp.id, form(new Uint8Array(5 * 1024 * 1024 + 1), 'big.png')));
    expect(big.messageAr).toMatch(/حجم الملف/);
    expect((await rejects(uploadDocument(prisma, h.A.keeper, h.emp.id, form(PNG, 'x.png')))).status).toBe(403);

    await deleteDocument(prisma, h.A.admin, doc.id);
    expect(await prisma.employeeDocumentFile.count({ where: { documentId: doc.id } })).toBe(0);
  });
});
