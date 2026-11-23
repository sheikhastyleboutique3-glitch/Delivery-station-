import { randomUUID } from 'node:crypto';
import { PrismaClient, type Role } from '@prisma/client';
import type { Actor } from '@/lib/actor';
import { stockIn } from '@/lib/services/stock-ops';

export const prisma = new PrismaClient();

export const key = () => `test-${randomUUID()}`;
let n = 0;
const uniq = () => `${Date.now().toString(36)}${(++n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function actorOf(u: { id: string; name: string; role: Role; deliveryPointId: string | null }, driverId: string | null = null): Actor {
  return { id: u.id, name: u.name, role: u.role, deliveryPointId: u.deliveryPointId, driverId, ip: '127.0.0.1', userAgent: 'vitest' };
}

/** بيئة معزولة لكل اختبار: نقطتان، مستخدم لكل دور، سائقان، ومنتج برصيد برتقالي */
export async function fixture(opts: { orange?: number; trackUnits?: boolean } = {}) {
  const u = uniq();
  const point = await prisma.deliveryPoint.create({ data: { code: `P${u}`, name: `نقطة ${u}`, type: 'WAREHOUSE' } });
  const other = await prisma.deliveryPoint.create({ data: { code: `Q${u}`, name: `نقطة أخرى ${u}`, type: 'HUB' } });
  let i = 0;
  const mk = (role: Role, pointId: string | null) =>
    prisma.user.create({ data: { name: `${role} ${u}`, email: `${role.toLowerCase()}-${++i}-${u}@t.local`, passwordHash: 'x', role, deliveryPointId: pointId } });
  const [admin, keeper, hub, otherHub, driverUser, driverUser2] = await Promise.all([
    mk('ADMIN', null),
    mk('WAREHOUSE', point.id),
    mk('HUB_MANAGER', point.id),
    mk('HUB_MANAGER', other.id),
    mk('DRIVER', point.id),
    mk('DRIVER', point.id),
  ]);
  const driver = await prisma.driver.create({
    data: { fullName: `سائق ${u}`, phone: '+97450000000', nationalId: `N${u}`, deliveryPointId: point.id, userId: driverUser.id },
  });
  const driver2 = await prisma.driver.create({
    data: { fullName: `سائق2 ${u}`, phone: '+97450000001', nationalId: `M${u}`, deliveryPointId: point.id, userId: driverUser2.id },
  });
  const product = await prisma.product.create({
    data: { name: `منتج ${u}`, sku: `SKU-${u}`, barcode: `BC${u}`, category: 'اختبار', price: 10, cost: 5, trackUnits: !!opts.trackUnits },
  });
  const customer = await prisma.customer.create({ data: { name: `عميل ${u}`, phone: '+97444000000' } });

  const A = {
    admin: actorOf(admin),
    keeper: actorOf(keeper),
    hub: actorOf(hub),
    otherHub: actorOf(otherHub),
    driver: actorOf(driverUser, driver.id),
    driver2: actorOf(driverUser2, driver2.id),
  };

  const serials = opts.trackUnits ? Array.from({ length: opts.orange ?? 0 }, (_, i) => `S-${u}-${i + 1}`) : [];
  if (opts.orange) {
    await stockIn(prisma, A.keeper, {
      idempotencyKey: key(),
      pointId: point.id,
      lines: [{ productId: product.id, quantity: opts.orange, unitSerials: serials }],
    });
  }
  return { point, other, driver, driver2, product, customer, A, serials };
}

export async function balance(productId: string, pointId: string) {
  const rows = await prisma.stockColorBalance.findMany({ where: { productId, deliveryPointId: pointId } });
  const out = { ORANGE: 0, BLUE: 0, GREEN: 0, RED: 0, PURPLE: 0 };
  for (const r of rows) out[r.color] = r.quantity;
  return out;
}

export async function setSetting(k: string, v: unknown) {
  await prisma.setting.upsert({ where: { key: k }, create: { key: k, value: v as never }, update: { value: v as never } });
}

/** ينتظر رفض الوعد ويعيد الخطأ (لفحص الرمز والرسالة) */
export async function rejects(p: Promise<unknown>): Promise<{ code?: string; status?: number; messageAr?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; status?: number; messageAr?: string; message: string };
  }
  throw new Error('كان متوقعاً أن تفشل العملية لكنها نجحت');
}
