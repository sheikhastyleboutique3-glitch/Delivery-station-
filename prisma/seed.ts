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

  const admin = await upsertUser(adminEmail, 'مدير النظام', adminPassword, 'ADMIN');
  console.log(`✓ حساب المدير: ${adminEmail}`);
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
    data: { code: 'WH-MAIN', name: 'المستودع الرئيسي', type: 'WAREHOUSE', address: 'المنطقة الصناعية، شارع 24', phone: '+97440000001' },
  });
  const north = await prisma.deliveryPoint.create({
    data: { code: 'HUB-NORTH', name: 'نقطة الشمال', type: 'HUB', address: 'الخور، الشارع التجاري', phone: '+97440000002' },
  });
  const south = await prisma.deliveryPoint.create({
    data: { code: 'HUB-SOUTH', name: 'نقطة الجنوب', type: 'HUB', address: 'الوكرة، طريق الميناء', phone: '+97440000003' },
  });
  console.log('✓ 3 نقاط دليفري');

  // ─── المستخدمون ───
  const keeper = await upsertUser('warehouse@rasd.local', 'سالم أمين المستودع', 'Store@12345', 'WAREHOUSE', wh.id);
  const hubMgr = await upsertUser('hub@rasd.local', 'نورة مسؤولة نقطة الشمال', 'Hub@12345', 'HUB_MANAGER', north.id);

  // ─── السائقون ───
  const drivers = await Promise.all(
    [
      { fullName: 'أحمد محمود', phone: '+97455510001', altPhone: '+97466610001', nationalId: '28763400001', vehicleType: 'دراجة نارية', vehiclePlate: '123456', deliveryPointId: wh.id, address: 'الدوحة، فريج بن محمود، شارع 12' },
      { fullName: 'خالد يوسف', phone: '+97455510002', nationalId: '28763400002', vehicleType: 'سيارة فان', vehiclePlate: '234567', deliveryPointId: wh.id, address: 'الدوحة، المنصورة' },
      { fullName: 'محمد علي', phone: '+97455510003', nationalId: '28763400003', vehicleType: 'دراجة نارية', vehiclePlate: '345678', deliveryPointId: north.id, address: 'الخور' },
      { fullName: 'عمر حسن', phone: '+97455510004', nationalId: '28763400004', vehicleType: 'سيارة', vehiclePlate: '456789', deliveryPointId: south.id, address: 'الوكرة', status: 'INACTIVE' as const, notes: 'في إجازة' },
    ].map((d) => prisma.driver.create({ data: d })),
  );
  const [ahmed, khaled, mohammed] = drivers;
  const driverUser = await upsertUser('driver@rasd.local', 'أحمد محمود', 'Driver@12345', 'DRIVER', wh.id);
  await prisma.driver.update({ where: { id: ahmed.id }, data: { userId: driverUser.id } });
  console.log('✓ 4 سائقين + 4 مستخدمين (مدير، أمين مستودع، مسؤول نقطة، سائق)');

  // ─── العملاء ───
  const customers = await Promise.all(
    [
      { name: 'شركة النخبة للتجارة', phone: '+97444123001', address: 'الدوحة، الخليج الغربي، برج 5', deliveryNotes: 'الاستلام من الاستقبال' },
      { name: 'فاطمة الكواري', phone: '+97455123002', address: 'الريان، شارع 340، فيلا 18', deliveryNotes: 'الاتصال قبل الوصول' },
      { name: 'مطعم الديرة', phone: '+97444123003', address: 'سوق واقف، محل 41' },
      { name: 'يوسف المري', phone: '+97455123004', address: 'لوسيل، مارينا، شقة 1203' },
      { name: 'صيدلية الشفاء', phone: '+97444123005', address: 'الخور، الشارع التجاري' },
      { name: 'مريم العطية', phone: '+97455123006', address: 'الوكرة، فريج 7', deliveryNotes: 'لا يوجد مصعد' },
    ].map((c) => prisma.customer.create({ data: c })),
  );
  console.log('✓ 6 عملاء');

  // ─── المنتجات: 20 منتجاً في 4 فئات ───
  const catalog: [string, string, number, number, number][] = [
    ['إلكترونيات', 'سماعات لاسلكية', 189, 120, 10],
    ['إلكترونيات', 'شاحن سريع 30 واط', 59, 32, 15],
    ['إلكترونيات', 'باور بانك 20000', 119, 75, 10],
    ['إلكترونيات', 'ساعة ذكية', 349, 230, 10],
    ['إلكترونيات', 'كابل USB-C', 25, 9, 30],
    ['منزلية', 'خلاط كهربائي', 229, 150, 5],
    ['منزلية', 'مكواة بخار', 149, 95, 5],
    ['منزلية', 'طقم أواني 10 قطع', 399, 260, 3],
    ['منزلية', 'مصباح مكتب LED', 79, 40, 8],
    ['منزلية', 'ميزان مطبخ رقمي', 45, 22, 10],
    ['عناية شخصية', 'عطر عود 100 مل', 299, 140, 6],
    ['عناية شخصية', 'ماكينة حلاقة', 169, 105, 6],
    ['عناية شخصية', 'مجفف شعر', 139, 85, 6],
    ['عناية شخصية', 'طقم عناية بالبشرة', 219, 120, 5],
    ['عناية شخصية', 'فرشاة أسنان كهربائية', 129, 70, 8],
    ['ملابس وأحذية', 'حذاء رياضي', 259, 150, 6],
    ['ملابس وأحذية', 'حقيبة ظهر', 149, 80, 6],
    ['ملابس وأحذية', 'قميص قطني', 69, 30, 12],
    ['ملابس وأحذية', 'نظارة شمسية', 189, 90, 5],
    ['ملابس وأحذية', 'محفظة جلد', 99, 45, 8],
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

  // 2) تحويل جزء إلى نقطة الشمال ثم إدخال مباشر عند الشمال
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

  // 5) مسؤول نقطة الشمال يصرف لمحمد، يسلّم الكل، ثم إرجاع ومرتجع عميل
  await dispatch(prisma, hubA, {
    idempotencyKey: key('dsp-north'),
    driverId: mohammed.id,
    pointId: north.id,
    lines: [
      { productId: P('شاحن سريع 30 واط').id, quantity: 6 },
      { productId: P('كابل USB-C').id, quantity: 10 },
    ],
  });
  await deliver(prisma, hubA, {
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
    customerId: customers[4].id,
    lines: [{ productId: P('كابل USB-C').id, quantity: 1, condition: 'DAMAGED', reason: 'الكابل لا يشحن' }],
  });
  // فرز جزء من البنفسجي في الشمال
  await sortPurple(prisma, hubA, {
    idempotencyKey: key('srt'),
    pointId: north.id,
    lines: [{ productId: P('كابل USB-C').id, quantity: 1, result: 'AVAILABLE' }],
  });

  const report = await reconcile(prisma);
  console.log(report.ok ? '✓ فحص التطابق: كل الأرصدة مطابقة لسجل الحركات' : `✗ فحص التطابق: ${report.mismatches.length} فرق`);
  if (!report.ok) {
    console.error(report.mismatches);
    process.exitCode = 1;
  }

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
