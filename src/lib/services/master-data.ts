import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Db } from '../db';
import { assertDriverSelf, assertPointAccess, requireRole, scopedPointId, type Actor } from '../actor';
import { writeAudit } from '../audit';
import { Errors } from '../errors';
import { hashPassword } from '../auth/password';
import { getSettings, settingsSchema } from '../settings';
import { canSeeCost } from './queries';
import {
  customerSchema,
  customerUpdateSchema,
  driverSchema,
  driverUpdateSchema,
  pageSchema,
  pageSizeSchema,
  pointSchema,
  pointUpdateSchema,
  productSchema,
  productUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
} from '../validation';

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
  archived: z.enum(['1', '0']).optional(),
  pointId: z.string().max(64).optional(),
  status: z.enum(['AVAILABLE', 'ON_TRIP', 'INACTIVE']).optional(),
});

// ─── Products ───────────────────────────────────────────────────

function serializeProduct<T extends { price: Prisma.Decimal; cost: Prisma.Decimal }>(actor: Actor, p: T) {
  return { ...p, price: p.price.toString(), cost: canSeeCost(actor) ? p.cost.toString() : null };
}

export async function listProducts(db: Db, actor: Actor, raw: Record<string, string | undefined>) {
  const q = listQuery.parse(raw);
  const where: Prisma.ProductWhereInput = { isArchived: q.archived === '1' };
  if (q.q) {
    where.OR = [
      { name: { contains: q.q, mode: 'insensitive' } },
      { sku: { contains: q.q, mode: 'insensitive' } },
      { barcode: { contains: q.q } },
      { category: { contains: q.q, mode: 'insensitive' } },
    ];
  }
  const [total, items] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { items: items.map((p) => serializeProduct(actor, p)), total, page: q.page, pageSize: q.pageSize };
}

export async function getProduct(db: Db, actor: Actor, id: string) {
  const p = await db.product.findUnique({ where: { id } });
  if (!p) throw Errors.notFound('المنتج');
  return serializeProduct(actor, p);
}

export async function createProduct(db: Db, actor: Actor, raw: unknown) {
  requireRole(actor, ['ADMIN', 'WAREHOUSE']);
  const data = productSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const p = await tx.product.create({ data });
    await writeAudit(tx, actor, { action: 'product.create', entityType: 'product', entityId: p.id, after: p });
    return serializeProduct(actor, p);
  });
}

export async function updateProduct(db: Db, actor: Actor, id: string, raw: unknown) {
  requireRole(actor, ['ADMIN', 'WAREHOUSE']);
  const data = productUpdateSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('المنتج');
    if (data.trackUnits !== undefined && data.trackUnits !== before.trackUnits) {
      const hasStock = await tx.stockMovement.count({ where: { productId: id } });
      if (hasStock > 0) throw Errors.conflict('لا يمكن تغيير نوع التتبع (بالقطعة/بالكمية) لمنتج له حركات مسجلة');
    }
    const p = await tx.product.update({ where: { id }, data });
    await writeAudit(tx, actor, {
      action: data.isArchived === true ? 'product.archive' : 'product.update',
      entityType: 'product',
      entityId: id,
      before,
      after: p,
    });
    return serializeProduct(actor, p);
  });
}

// ─── Delivery points ────────────────────────────────────────────

export async function listPoints(db: Db, actor: Actor) {
  const points = await db.deliveryPoint.findMany({
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { drivers: true, users: true } } },
  });
  return points;
}

export async function createPoint(db: Db, actor: Actor, raw: unknown) {
  requireRole(actor, ['ADMIN']);
  const data = pointSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const p = await tx.deliveryPoint.create({ data: { ...data, code: data.code.toUpperCase() } });
    await writeAudit(tx, actor, { action: 'point.create', entityType: 'delivery_point', entityId: p.id, after: p });
    return p;
  });
}

export async function updatePoint(db: Db, actor: Actor, id: string, raw: unknown) {
  requireRole(actor, ['ADMIN']);
  const data = pointUpdateSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.deliveryPoint.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('نقطة الدليفري');
    const p = await tx.deliveryPoint.update({ where: { id }, data: { ...data, code: data.code?.toUpperCase() } });
    await writeAudit(tx, actor, { action: 'point.update', entityType: 'delivery_point', entityId: id, before, after: p });
    return p;
  });
}

// ─── Drivers ────────────────────────────────────────────────────

export async function listDrivers(db: Db, actor: Actor, raw: Record<string, string | undefined>) {
  requireRole(actor, ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER']);
  const q = listQuery.parse(raw);
  const scope = scopedPointId(actor);
  const where: Prisma.DriverWhereInput = {};
  if (scope) where.deliveryPointId = scope;
  else if (q.pointId) where.deliveryPointId = q.pointId;
  if (q.status) where.status = q.status;
  if (q.q) {
    where.OR = [
      { fullName: { contains: q.q, mode: 'insensitive' } },
      { phone: { contains: q.q } },
      { nationalId: { contains: q.q } },
      { vehiclePlate: { contains: q.q, mode: 'insensitive' } },
    ];
  }
  const [total, drivers] = await Promise.all([
    db.driver.count({ where }),
    db.driver.findMany({
      where,
      orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { deliveryPoint: { select: { id: true, name: true } }, user: { select: { id: true, email: true } } },
    }),
  ]);
  const custody = await db.driverCustody.groupBy({
    by: ['driverId'],
    where: { driverId: { in: drivers.map((d) => d.id) }, quantity: { gt: 0 } },
    _sum: { quantity: true },
    _min: { nonzeroSince: true },
  });
  const byDriver = new Map(custody.map((c) => [c.driverId, c]));
  return {
    items: drivers.map((d) => ({
      ...d,
      custodyTotal: byDriver.get(d.id)?._sum.quantity ?? 0,
      custodySince: byDriver.get(d.id)?._min.nonzeroSince ?? null,
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function getDriver(db: Db, actor: Actor, id: string) {
  assertDriverSelf(actor, id);
  const d = await db.driver.findUnique({
    where: { id },
    include: {
      deliveryPoint: { select: { id: true, name: true } },
      user: { select: { id: true, email: true, isActive: true } },
      settlements: { orderBy: { createdAt: 'desc' }, take: 10, include: { settledBy: { select: { name: true } }, operation: { select: { opNo: true } } } },
    },
  });
  if (!d) throw Errors.notFound('السائق');
  if (actor.role !== 'DRIVER') {
    const scope = scopedPointId(actor);
    if (scope && d.deliveryPointId !== scope) throw Errors.forbidden('هذا السائق يتبع نقطة أخرى');
  }
  return d;
}

export async function createDriver(db: Db, actor: Actor, raw: unknown) {
  requireRole(actor, ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER']);
  const data = driverSchema.parse(raw);
  assertPointAccess(actor, data.deliveryPointId);
  return db.$transaction(async (tx) => {
    const d = await tx.driver.create({ data });
    await writeAudit(tx, actor, { action: 'driver.create', entityType: 'driver', entityId: d.id, after: d });
    return d;
  });
}

export async function updateDriver(db: Db, actor: Actor, id: string, raw: unknown) {
  requireRole(actor, ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER']);
  const data = driverUpdateSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.driver.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('السائق');
    assertPointAccess(actor, before.deliveryPointId);
    if (data.deliveryPointId) assertPointAccess(actor, data.deliveryPointId);
    if (data.deliveryPointId && data.deliveryPointId !== before.deliveryPointId) {
      const open = await tx.driverCustody.aggregate({ where: { driverId: id }, _sum: { quantity: true } });
      if ((open._sum.quantity ?? 0) > 0) throw Errors.conflict('لا يمكن نقل سائق لديه عهدة مفتوحة إلى نقطة أخرى. قم بالتسوية أولاً');
    }
    const d = await tx.driver.update({ where: { id }, data });
    await writeAudit(tx, actor, { action: 'driver.update', entityType: 'driver', entityId: id, before, after: d });
    return d;
  });
}

// ─── Customers ──────────────────────────────────────────────────

export async function listCustomers(db: Db, actor: Actor, raw: Record<string, string | undefined>) {
  const q = listQuery.parse(raw);
  const where: Prisma.CustomerWhereInput = {};
  if (q.q) {
    where.OR = [
      { name: { contains: q.q, mode: 'insensitive' } },
      { phone: { contains: q.q } },
      { address: { contains: q.q, mode: 'insensitive' } },
    ];
  }
  const [total, items] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({ where, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

export async function createCustomer(db: Db, actor: Actor, raw: unknown) {
  const data = customerSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const c = await tx.customer.create({ data });
    await writeAudit(tx, actor, { action: 'customer.create', entityType: 'customer', entityId: c.id, after: c });
    return c;
  });
}

export async function updateCustomer(db: Db, actor: Actor, id: string, raw: unknown) {
  requireRole(actor, ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER']);
  const data = customerUpdateSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.customer.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('العميل');
    const c = await tx.customer.update({ where: { id }, data });
    await writeAudit(tx, actor, { action: 'customer.update', entityType: 'customer', entityId: id, before, after: c });
    return c;
  });
}

// ─── Users ──────────────────────────────────────────────────────

const userPublic = {
  id: true,
  name: true,
  email: true,
  role: true,
  deliveryPointId: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  deliveryPoint: { select: { id: true, name: true } },
  driver: { select: { id: true, fullName: true } },
} satisfies Prisma.UserSelect;

export async function listUsers(db: Db, actor: Actor) {
  requireRole(actor, ['ADMIN']);
  return db.user.findMany({ select: userPublic, orderBy: [{ role: 'asc' }, { name: 'asc' }] });
}

export async function createUser(db: Db, actor: Actor, raw: unknown) {
  requireRole(actor, ['ADMIN']);
  const input = userCreateSchema.parse(raw);
  const passwordHash = await hashPassword(input.password);
  return db.$transaction(async (tx) => {
    let deliveryPointId = input.deliveryPointId ?? null;
    if (input.role === 'DRIVER') {
      const driver = await tx.driver.findUnique({ where: { id: input.driverId! } });
      if (!driver) throw Errors.notFound('السائق');
      if (driver.userId) throw Errors.conflict('هذا السائق مرتبط بحساب آخر');
      deliveryPointId = driver.deliveryPointId;
    }
    const user = await tx.user.create({
      data: { name: input.name, email: input.email, passwordHash, role: input.role, deliveryPointId },
      select: userPublic,
    });
    if (input.role === 'DRIVER') await tx.driver.update({ where: { id: input.driverId! }, data: { userId: user.id } });
    await writeAudit(tx, actor, { action: 'user.create', entityType: 'user', entityId: user.id, after: user });
    return user;
  });
}

export async function updateUser(db: Db, actor: Actor, id: string, raw: unknown) {
  requireRole(actor, ['ADMIN']);
  const input = userUpdateSchema.parse(raw);
  if (id === actor.id && (input.isActive === false || (input.role && input.role !== 'ADMIN'))) {
    throw Errors.validation('لا يمكنك تعطيل حسابك أو إزالة صلاحية المدير عن نفسك');
  }
  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  return db.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id }, select: userPublic });
    if (!before) throw Errors.notFound('المستخدم');
    const role = input.role ?? before.role;
    const pointId = input.deliveryPointId !== undefined ? input.deliveryPointId : before.deliveryPointId;
    if (role === 'HUB_MANAGER' && !pointId) throw Errors.validation('مسؤول النقطة يجب ربطه بنقطة دليفري');
    if (role === 'DRIVER' && !before.driver) throw Errors.validation('لا يمكن تحويل حساب إلى سائق من هنا؛ أنشئ حساب السائق من شاشة المستخدمين');
    const invalidate = !!passwordHash || input.isActive === false || (input.role && input.role !== before.role);
    const user = await tx.user.update({
      where: { id },
      data: {
        name: input.name,
        role: input.role,
        deliveryPointId: input.deliveryPointId,
        isActive: input.isActive,
        ...(passwordHash ? { passwordHash } : {}),
        ...(invalidate ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: userPublic,
    });
    await writeAudit(tx, actor, {
      action: passwordHash ? 'user.password_reset' : 'user.update',
      entityType: 'user',
      entityId: id,
      before,
      after: user,
    });
    return user;
  });
}

// ─── Settings ───────────────────────────────────────────────────

export async function updateSettings(db: Db, actor: Actor, raw: unknown) {
  requireRole(actor, ['ADMIN']);
  const next = settingsSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await getSettings(tx);
    for (const [key, value] of Object.entries(next)) {
      await tx.setting.upsert({
        where: { key },
        create: { key, value: value as Prisma.InputJsonValue, updatedById: actor.id },
        update: { value: value as Prisma.InputJsonValue, updatedById: actor.id },
      });
    }
    await writeAudit(tx, actor, { action: 'settings.update', entityType: 'settings', entityId: 'global', before, after: next });
    return next;
  });
}
