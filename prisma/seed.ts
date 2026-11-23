/**
 * البيانات الأولية لرصد.
 * - ينشئ دائماً حساب مدير (من SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD أو الحساب التجريبي).
 * - عند SEED_DEMO=true (الافتراضي) ينشئ بيانات تجريبية كاملة تعرض الألوان الخمسة،
 *   وكل الحركات تمر عبر نفس خدمات النظام فتبقى الأرصدة مطابقة للسجل.
 * - آمن للتشغيل أكثر من مرة: لا يكرر البيانات التجريبية إذا وُجدت منتجات.
 */
import { PrismaClient, type Product, type Role } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/password';
import { writeAudit } from '../src/lib/audit';
import type { Actor } from '../src/lib/actor';
import { ean13CheckDigit, DEFAULT_SETTINGS } from '../src/lib/domain';
import { reconcile } from '../src/lib/services/reconcile';
import { createEmployee, changeEmployeeStatus } from '../src/lib/hr/employees';
import { markAttendance } from '../src/lib/hr/attendance';
import { addPayment, createPayout, upsertRate } from '../src/lib/hr/payroll';
import { localDate } from '../src/lib/hr/util';
import { ensureDirectUrl } from '../src/lib/env';
import { passwordSchema } from '../src/lib/validation';

ensureDirectUrl();
import {
  customerReturn,
  deliver,
  dispatch,
  returnToWarehouse,
  sortPurple,
  stockIn,
  transfer,
  acknowledgeDispatch,
} from '../src/lib/services/stock-ops';

const prisma = new PrismaClient();
let keyN = 0;
const key = (label: string) => `seed-${label}-${++keyN}`;

function ean(n: number) {
  // البادئة 200 مخصصة للاستخدام الداخلي في نظام GS1 (لا تتعارض مع باركودات الموردين)
  const first12 = `200${String(n).padStart(9, '0')}`;
  return first12 + ean13CheckDigit(first12);
}

function actorOf(u: { id: string; name: string; role: Role; deliveryPointId: string | null }, driverId: string | null = null): Actor {
  return { id: u.id, name: u.name, role: u.role, deliveryPointId: u.deliveryPointId, driverId, ip: '127.0.0.1', userAgent: 'seed' };
}

async function upsertUser(email: string, name: string, password: string, role: Role, deliveryPointId: string | null = null) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({ data: { email, name, role, deliveryPointId, passwordHash: await hashPassword(password) } });
}

async function main() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@rasd.local').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';
  const demo = (process.env.SEED_DEMO ?? 'true') !== 'false';

  // الإعدادات الافتراضية
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({ where: { key: k }, create: { key: k, value: v }, update: {} });
  }

  if (process.env.SEED_ADMIN_PASSWORD && !passwordSchema.safeParse(adminPassword).success) {
    throw new Error('SEED_ADMIN_PASSWORD is too weak: at least 8 characters with letters and digits');
  }
  const existed = await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } });
  const admin = await upsertUser(adminEmail, 'مدير النظام', adminPassword, 'ADMIN');
  console.log(existed ? `• Admin account already exists (password unchanged): ${adminEmail}` : `✓ Admin account created: ${adminEmail}`);
  const adminActor = actorOf(admin);

  if (!demo) {
    if ((await prisma.deliveryPoint.count()) === 0) {
      await prisma.deliveryPoint.create({ data: { code: 'WH-MAIN', name: 'المستودع الرئيسي', type: 'WAREHOUSE' } });
      console.log('✓ أُنشئ المستودع الرئيسي');
    }
    return;
  }

  if ((await prisma.product.count()) > 0) {
    console.log('• توجد منتجات مسبقاً، تم تخطي البيانات التجريبية');
    return;
  }

  // ─── نقاط الدليفري ───
  const wh = await prisma.deliveryPoint.create({
    data: { code: 'WH-MAIN', name: 'المستودع الرئيسي', type: 'WAREHOUSE', address: 'الجزائر العاصمة، المنطقة الصناعية الرغاية', phone: '+213560000001' },
  });
  const north = await prisma.deliveryPoint.create({
    data: { code: 'HUB-ORAN', name: 'نقطة وهران', type: 'HUB', address: 'وهران، حي العقيد لطفي', phone: '+213560000002' },
  });
  const south = await prisma.deliveryPoint.create({
    data: { code: 'HUB-BLIDA', name: 'نقطة البليدة', type: 'HUB', address: 'البليدة، طريق الجزائر', phone: '+213560000003' },
  });
  console.log('✓ 3 نقاط دليفري');

  // ─── المستخدمون ───
  const keeper = await upsertUser('warehouse@rasd.local', 'سليم أمين المستودع', 'Store@12345', 'WAREHOUSE', wh.id);
  const hubMgr = await upsertUser('hub@rasd.local', 'نسرين مسؤولة نقطة وهران', 'Hub@12345', 'HUB_MANAGER', north.id);

  // ─── الموظفون والسائقون (كل سائق له ملف وظيفي ونظام دفع) ───
  const tz = (await prisma.setting.findUnique({ where: { key: 'timezone' } }))?.value as string | undefined;
  const today = localDate(new Date(), tz ?? DEFAULT_SETTINGS.timezone);
  const inDays = (n: number) => localDate(new Date(Date.now() + n * 86_400_000), tz ?? DEFAULT_SETTINGS.timezone);
  const mkEmp = (data: Record<string, unknown>) => createEmployee(prisma, adminActor, { hireDate: '2026-01-05', nationality: 'جزائرية', ...data });

  const eAhmed = await mkEmp({
    fullName: 'أحمد بن علي', phone: '+213550100001', altPhone: '+213660100001', nationalId: '109870012345678', idExpiryDate: inDays(20),
    dateOfBirth: '1995-04-12', address: 'الجزائر العاصمة، باب الزوار، حي 5 جويلية', jobType: 'DRIVER', jobTitle: 'سائق دراجة نارية',
    deliveryPointId: wh.id, vehicleType: 'دراجة نارية', vehiclePlate: '01234-110-16', drivingLicenseNumber: 'DZ-16-778812', drivingLicenseExpiry: '2028-06-30',
    payType: 'PER_DELIVERY', commissionMode: 'PER_UNIT',
  });
  const eKhaled = await mkEmp({
    fullName: 'خالد بوزيد', phone: '+213550100002', nationalId: '109870012345679', dateOfBirth: '1990-09-01',
    address: 'الجزائر العاصمة، الحراش', jobType: 'DRIVER', jobTitle: 'سائق فان', deliveryPointId: wh.id, vehicleType: 'فان', vehiclePlate: '05678-112-16',
    drivingLicenseNumber: 'DZ-16-110034', drivingLicenseExpiry: inDays(-3),
    payType: 'HYBRID', dailyRate: 1500, monthlySalary: 0, commissionMode: 'PER_COLIS',
  });
  const eMohammed = await mkEmp({
    fullName: 'محمد قادري', phone: '+213550100003', nationalId: '109870012345680', address: 'وهران، بئر الجير', jobType: 'DRIVER',
    deliveryPointId: north.id, vehicleType: 'دراجة نارية', vehiclePlate: '04567-119-31', payType: 'PER_DELIVERY', commissionMode: 'PER_UNIT',
  });
  const eOmar = await mkEmp({
    fullName: 'عمر سعيدي', phone: '+213550100004', nationalId: '109870012345681', address: 'البليدة، أولاد يعيش', jobType: 'DRIVER',
    deliveryPointId: south.id, vehicleType: 'سيارة', vehiclePlate: '07890-115-09', payType: 'MONTHLY_OR_DAILY', monthlySalary: 40000,
  });
  const eSalim = await mkEmp({
    fullName: 'سليم مرابط', phone: '+213550100005', nationalId: '109870012345682', jobType: 'WAREHOUSE_KEEPER', jobTitle: 'أمين المستودع الرئيسي',
    deliveryPointId: wh.id, payType: 'MONTHLY_OR_DAILY', monthlySalary: 45000, hireDate: '2025-11-01',
  });
  await mkEmp({
    fullName: 'نسرين حداد', phone: '+213550100006', nationalId: '109870012345683', jobType: 'HUB_MANAGER', deliveryPointId: north.id,
    payType: 'MONTHLY_OR_DAILY', monthlySalary: 55000,
  });
  await mkEmp({
    fullName: 'كريمة عياش', phone: '+213550100007', nationalId: '109870012345684', jobType: 'ADMINISTRATIVE', jobTitle: 'محاسبة',
    payType: 'MONTHLY_OR_DAILY', monthlySalary: 60000, idExpiryDate: inDays(-10),
  });
  const driverOf = async (empId: string) => prisma.driver.findUniqueOrThrow({ where: { employeeId: empId } });
  const [ahmed, khaled, mohammed] = await Promise.all([driverOf(eAhmed.id), driverOf(eKhaled.id), driverOf(eMohammed.id)]);
  await changeEmployeeStatus(prisma, adminActor, eOmar.id, { status: 'SUSPENDED', terminationReason: 'في عطلة مرضية' });
  const driverUser = await upsertUser('driver@rasd.local', 'أحمد بن علي', 'Driver@12345', 'DRIVER', wh.id);
  await prisma.driver.update({ where: { id: ahmed.id }, data: { userId: driverUser.id } });
  console.log('✓ 7 موظفين (4 سائقين بأنظمة دفع مختلفة، أمين مستودع، مسؤولة نقطة، محاسبة) + 4 حسابات دخول');

  // أسعار توصيل خاصة: خالد 300 دج لكل طرد، ونقطة وهران 250 دج للقطعة
  await upsertRate(prisma, adminActor, { mode: 'PER_COLIS', amount: 300, employeeId: eKhaled.id, label: 'سعر خالد للطرد' });
  await upsertRate(prisma, adminActor, { mode: 'PER_UNIT', amount: 250, deliveryPointId: north.id, label: 'منطقة وهران' });

  // ─── العملاء ───
  const customers = await Promise.all(
    [
      { name: 'شركة الأمل للتوزيع', phone: '+213021450001', address: 'الجزائر العاصمة، حيدرة، شارع سويداني بوجمعة 12', deliveryNotes: 'الاستلام من الاستقبال' },
      { name: 'فاطمة الزهراء بن يوسف', phone: '+213551230002', address: 'الجزائر العاصمة، بئر مراد رايس، عمارة 18', deliveryNotes: 'الاتصال قبل الوصول' },
      { name: 'مطعم القصبة', phone: '+213021450003', address: 'الجزائر العاصمة، القصبة، محل 41' },
      { name: 'يوسف بلقاسم', phone: '+213551230004', address: 'باب الزوار، حي الجرف، شقة 12' },
      { name: 'صيدلية الشفاء', phone: '+213041230005', address: 'وهران، شارع العربي بن مهيدي' },
      { name: 'مريم بوعلام', phone: '+213551230006', address: 'البليدة، حي بن بولعيد', deliveryNotes: 'لا يوجد مصعد' },
    ].map((c) => prisma.customer.create({ data: c })),
  );
  console.log('✓ 6 عملاء');

  // ─── المنتجات: 20 منتجاً في 4 فئات ───
  // الأسعار بالدينار الجزائري
  const catalog: [string, string, number, number, number][] = [
    ['إلكترونيات', 'سماعات لاسلكية', 4500, 3000, 10],
    ['إلكترونيات', 'شاحن سريع 30 واط', 1800, 1000, 15],
    ['إلكترونيات', 'باور بانك 20000', 3500, 2300, 10],
    ['إلكترونيات', 'ساعة ذكية', 9900, 6800, 10],
    ['إلكترونيات', 'كابل USB-C', 600, 250, 30],
    ['أجهزة منزلية', 'خلاط كهربائي', 7500, 5200, 5],
    ['أجهزة منزلية', 'مكواة بخار', 4900, 3300, 5],
    ['أجهزة منزلية', 'طقم أواني 10 قطع', 12900, 8900, 3],
    ['أجهزة منزلية', 'مصباح مكتب LED', 2500, 1300, 8],
    ['أجهزة منزلية', 'ميزان مطبخ رقمي', 1600, 800, 10],
    ['عناية شخصية', 'عطر عود 100 مل', 8500, 4200, 6],
    ['عناية شخصية', 'ماكينة حلاقة', 5200, 3300, 6],
    ['عناية شخصية', 'مجفف شعر', 4300, 2700, 6],
    ['عناية شخصية', 'طقم عناية بالبشرة', 6900, 3900, 5],
    ['عناية شخصية', 'فرشاة أسنان كهربائية', 3900, 2200, 8],
    ['ملابس وأحذية', 'حذاء رياضي', 7900, 4800, 6],
    ['ملابس وأحذية', 'حقيبة ظهر', 4500, 2500, 6],
    ['ملابس وأحذية', 'قميص قطني', 2200, 1000, 12],
    ['ملابس وأحذية', 'نظارة شمسية', 5500, 2800, 5],
    ['ملابس وأحذية', 'محفظة جلد', 3000, 1400, 8],
  ];
  const products: Product[] = [];
  for (let i = 0; i < catalog.length; i++) {
    const [category, name, price, cost, min] = catalog[i];
    products.push(
      await prisma.product.create({
        data: {
          name,
          category,
          price,
          cost,
          minStockAlert: min,
          sku: `RSD-${String(i + 1).padStart(4, '0')}`,
          barcode: ean(i + 1),
          // الساعة الذكية تُتتبع بالقطعة (رقم تسلسلي لكل قطعة)
          trackUnits: name === 'ساعة ذكية',
        },
      }),
    );
  }
  await prisma.$transaction((tx) => writeAudit(tx, adminActor, { action: 'seed.demo', entityType: 'system', entityId: 'seed', after: { products: products.length } }));
  console.log('✓ 20 منتجاً في 4 فئات (باركود EAN-13 صحيح)');

  const P = (name: string) => products.find((p) => p.name === name)!;
  const keeperA = actorOf(keeper);
  const hubA = actorOf(hubMgr);
  const watch = P('ساعة ذكية');
  const watchSerials = Array.from({ length: 12 }, (_, i) => `SW-2026-${String(i + 1).padStart(4, '0')}`);

  // 1) إدخال مخزون للمستودع الرئيسي (برتقالي)
  await stockIn(prisma, keeperA, {
    idempotencyKey: key('in'),
    pointId: wh.id,
    notes: 'فاتورة مورد رقم 5521',
    lines: [
      ...products
        .filter((p) => !p.trackUnits)
        .map((p, i) => ({ productId: p.id, quantity: 20 + ((i * 7) % 25), scanSource: 'EXTERNAL_SCANNER' as const, scannedBarcode: p.barcode })),
      { productId: watch.id, quantity: watchSerials.length, unitSerials: watchSerials, scanSource: 'CAMERA' as const },
    ],
  });
  // منتج تحت الحد الأدنى لإظهار التنبيه
  // (طقم الأواني: حد التنبيه 3، نصرف معظمه لاحقاً)

  // 2) تحويل جزء إلى نقطة وهران ثم إدخال مباشر عند وهران
  await transfer(prisma, keeperA, {
    idempotencyKey: key('trf'),
    fromPointId: wh.id,
    toPointId: north.id,
    lines: [
      { productId: P('سماعات لاسلكية').id, quantity: 8 },
      { productId: P('شاحن سريع 30 واط').id, quantity: 10 },
      { productId: P('عطر عود 100 مل').id, quantity: 6 },
    ],
  });
  await stockIn(prisma, hubA, {
    idempotencyKey: key('in-north'),
    pointId: north.id,
    lines: [{ productId: P('كابل USB-C').id, quantity: 25 }],
  });

  // 3) صرف لأحمد (أزرق) ثم يؤكد الاستلام ويسلّم جزءاً (أخضر) ويرجع جزءاً (بنفسجي/أحمر)
  const d1 = await dispatch(prisma, keeperA, {
    idempotencyKey: key('dsp'),
    driverId: ahmed.id,
    pointId: wh.id,
    lines: [
      { productId: P('سماعات لاسلكية').id, quantity: 6 },
      { productId: P('خلاط كهربائي').id, quantity: 4 },
      { productId: P('حذاء رياضي').id, quantity: 5 },
      { productId: P('طقم أواني 10 قطع').id, quantity: 20 },
      { productId: watch.id, quantity: 3, unitSerials: watchSerials.slice(0, 3) },
    ],
  });
  await acknowledgeDispatch(prisma, actorOf(driverUser, ahmed.id), d1.operation.id);
  const ahmedA = actorOf(driverUser, ahmed.id);
  await deliver(prisma, ahmedA, {
    idempotencyKey: key('dlv'),
    driverId: ahmed.id,
    customerId: customers[0].id,
    lines: [
      { productId: P('سماعات لاسلكية').id, quantity: 3 },
      { productId: watch.id, quantity: 1, unitSerials: [watchSerials[0]] },
    ],
  });
  await deliver(prisma, ahmedA, {
    idempotencyKey: key('dlv'),
    driverId: ahmed.id,
    customerId: customers[1].id,
    lines: [
      { productId: P('خلاط كهربائي').id, quantity: 2 },
      { productId: P('طقم أواني 10 قطع').id, quantity: 15 },
      { productId: P('حذاء رياضي').id, quantity: 2 },
    ],
  });
  await returnToWarehouse(prisma, keeperA, {
    idempotencyKey: key('ret'),
    driverId: ahmed.id,
    receivingPointId: wh.id,
    lines: [
      { productId: P('سماعات لاسلكية').id, quantity: 2, condition: 'GOOD' },
      { productId: P('سماعات لاسلكية').id, quantity: 1, condition: 'DAMAGED', reason: 'كسر في العلبة' },
      { productId: P('خلاط كهربائي').id, quantity: 1, condition: 'MISSING', reason: 'قطعة الشفرة غير موجودة' },
    ],
  });
  // يبقى مع أحمد: خلاط 1، حذاء 3، أواني 5، ساعتان (عهدة مفتوحة)

  // 4) صرف لخالد (يبقى معه عهدة مفتوحة بالكامل - لم يؤكد الاستلام بعد)
  await dispatch(prisma, keeperA, {
    idempotencyKey: key('dsp'),
    driverId: khaled.id,
    pointId: wh.id,
    notes: 'طلبات منطقة الريان',
    lines: [
      { productId: P('مكواة بخار').id, quantity: 3 },
      { productId: P('عطر عود 100 مل').id, quantity: 4 },
      { productId: P('حقيبة ظهر').id, quantity: 6 },
    ],
  });

  // 5) مسؤولة نقطة وهران تصرف لمحمد، يسلّم الكل، ثم إرجاع ومرتجع عميل
  await dispatch(prisma, hubA, {
    idempotencyKey: key('dsp-north'),
    driverId: mohammed.id,
    pointId: north.id,
    lines: [
      { productId: P('شاحن سريع 30 واط').id, quantity: 6 },
      { productId: P('كابل USB-C').id, quantity: 10 },
    ],
  });
  const dlvNorth = await deliver(prisma, hubA, {
    idempotencyKey: key('dlv-north'),
    driverId: mohammed.id,
    customerId: customers[4].id,
    lines: [
      { productId: P('شاحن سريع 30 واط').id, quantity: 5 },
      { productId: P('كابل USB-C').id, quantity: 8 },
    ],
  });
  await returnToWarehouse(prisma, hubA, {
    idempotencyKey: key('ret-north'),
    driverId: mohammed.id,
    receivingPointId: north.id,
    lines: [
      { productId: P('شاحن سريع 30 واط').id, quantity: 1, condition: 'GOOD' },
      { productId: P('كابل USB-C').id, quantity: 2, condition: 'GOOD' },
    ],
  });
  await customerReturn(prisma, hubA, {
    idempotencyKey: key('crt'),
    receivingPointId: north.id,
    deliveryOperationId: dlvNorth.operation.id, // يلغي عمولة القطعة المرتجعة من مستحقات محمد
    lines: [{ productId: P('كابل USB-C').id, quantity: 1, condition: 'DAMAGED', reason: 'الكابل لا يشحن' }],
  });
  // فرز جزء من البنفسجي في الشمال
  await sortPurple(prisma, hubA, {
    idempotencyKey: key('srt'),
    pointId: north.id,
    lines: [{ productId: P('كابل USB-C').id, quantity: 1, result: 'AVAILABLE' }],
  });

  // ─── الحضور اليدوي للموظفين الإداريين في الشهر الماضي + كشف مدفوع جزئياً ───
  const [ty, tm] = today.split('-').map(Number);
  const prev = new Date(Date.UTC(ty, tm - 2, 1));
  const prevYm = prev.toISOString().slice(0, 7);
  const prevLast = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0)).getUTCDate();
  let marked = 0;
  for (let d = 1; d <= prevLast && marked < 22; d++) {
    const date = `${prevYm}-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (dow === 5 || dow === 6) continue; // عطلة نهاية الأسبوع في الجزائر: الجمعة والسبت
    await markAttendance(prisma, adminActor, eSalim.id, { date, status: 'PRESENT' });
    marked++;
  }
  const salimPayout = await createPayout(prisma, adminActor, {
    employeeId: eSalim.id,
    from: `${prevYm}-01`,
    to: `${prevYm}-${String(prevLast).padStart(2, '0')}`,
    bonusAmount: 2000,
    deductionAmount: 5000,
    notes: 'خصم سلفة 5000 دج',
  });
  await addPayment(prisma, adminActor, salimPayout.id, { idempotencyKey: key('pay'), amount: 20000, method: 'CCP', reference: 'CCP-0099812' });
  console.log(`✓ حضور ${marked} يوماً لأمين المستودع في ${prevYm} + كشف ${salimPayout.payoutNo} (صافي ${salimPayout.netAmount} دج، مدفوع جزئياً)`);

  const report = await reconcile(prisma);
  console.log(report.ok ? '✓ فحص التطابق: كل الأرصدة مطابقة لسجل الحركات' : `✗ فحص التطابق: ${report.mismatches.length} فرق`);
  if (!report.ok) {
    console.error(report.mismatches);
    process.exitCode = 1;
  }

  const earned = await prisma.deliveryEarning.aggregate({ where: { kind: 'DELIVERY' }, _sum: { amount: true, units: true } });
  const reversed = await prisma.deliveryEarning.aggregate({ where: { kind: 'RETURN_REVERSAL' }, _sum: { amount: true, units: true } });
  console.log(`✓ عمولات التوصيل: ${earned._sum.units ?? 0} قطعة = ${earned._sum.amount ?? 0} دج، ملغاة بسبب مرتجعات العملاء: ${reversed._sum.units ?? 0} قطعة = ${reversed._sum.amount ?? 0} دج`);
  const totals = await prisma.stockColorBalance.groupBy({ by: ['color'], _sum: { quantity: true } });
  console.log('الأرصدة حسب اللون:', Object.fromEntries(totals.map((t) => [t.color, t._sum.quantity])));
  console.log('\nحسابات الدخول التجريبية (غيّر كلمات المرور بعد أول دخول):');
  console.log(`  مدير النظام      ${adminEmail} / ${process.env.SEED_ADMIN_PASSWORD ? '(من SEED_ADMIN_PASSWORD)' : adminPassword}`);
  console.log('  أمين المستودع    warehouse@rasd.local / Store@12345');
  console.log('  مسؤول نقطة       hub@rasd.local / Hub@12345');
  console.log('  سائق             driver@rasd.local / Driver@12345');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
