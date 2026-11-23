import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Db } from '../db';
import { requireRole, type Actor } from '../actor';
import { writeAudit } from '../audit';
import { Errors } from '../errors';
import { getSettings } from '../settings';
import { pageSchema, pageSizeSchema } from '../validation';
import { EMPLOYEE_JOBS, EMPLOYEE_STATUSES, type EmployeeJob } from '../domain';
import { employeeCreateSchema, employeeStatusSchema, employeeUpdateSchema } from './validation';
import { dbDate, localDate } from './util';

type Tx = Prisma.TransactionClient;
const HR: ['ADMIN'] = ['ADMIN'];

async function nextEmployeeNo(tx: Tx) {
  const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('employee_no_seq') AS n`;
  return `EMP-${String(n).padStart(4, '0')}`;
}

const optDate = (v: string | null | undefined) => (v === undefined ? undefined : v ? dbDate(v) : null);

/** الحقول الشخصية التي تُنسخ من ملف الموظف إلى سجل السائق (المصدر الوحيد هو ملف الموظف) */
function driverFieldsFrom(e: {
  fullName?: string;
  phone?: string;
  altPhone?: string | null;
  address?: string | null;
  nationalId?: string;
  deliveryPointId?: string | null;
  vehicleType?: string | null;
  vehiclePlate?: string | null;
}) {
  const out: Prisma.DriverUncheckedUpdateInput = {};
  if (e.fullName !== undefined) out.fullName = e.fullName;
  if (e.phone !== undefined) out.phone = e.phone;
  if (e.altPhone !== undefined) out.altPhone = e.altPhone;
  if (e.address !== undefined) out.address = e.address;
  if (e.nationalId !== undefined) out.nationalId = e.nationalId;
  if (e.deliveryPointId) out.deliveryPointId = e.deliveryPointId;
  if (e.vehicleType !== undefined) out.vehicleType = e.vehicleType;
  if (e.vehiclePlate !== undefined) out.vehiclePlate = e.vehiclePlate;
  return out;
}

async function openCustody(tx: Tx | Db, driverId: string) {
  const agg = await tx.driverCustody.aggregate({ where: { driverId }, _sum: { quantity: true } });
  return agg._sum.quantity ?? 0;
}

/** يُستدعى من شاشة السائقين القديمة: ينشئ ملفاً وظيفياً للسائق الجديد تلقائياً */
export async function createEmployeeForDriver(
  tx: Tx,
  d: { fullName: string; phone: string; altPhone: string | null; address: string | null; nationalId: string; deliveryPointId: string },
  timezone: string,
) {
  const existing = await tx.employee.findUnique({ where: { nationalId: d.nationalId } });
  if (existing) return existing;
  return tx.employee.create({
    data: {
      employeeNo: await nextEmployeeNo(tx),
      fullName: d.fullName,
      phone: d.phone,
      altPhone: d.altPhone,
      address: d.address,
      nationalId: d.nationalId,
      jobType: 'DRIVER',
      jobTitle: 'سائق',
      deliveryPointId: d.deliveryPointId,
      hireDate: dbDate(localDate(new Date(), timezone)),
      payType: 'PER_DELIVERY',
    },
  });
}

/** يُستدعى عند تعديل السائق من شاشة السائقين: ينسخ البيانات الشخصية إلى ملفه الوظيفي */
export async function syncEmployeeFromDriver(tx: Tx, driver: { employeeId: string | null }, data: Record<string, unknown>) {
  if (!driver.employeeId) return;
  const patch: Prisma.EmployeeUncheckedUpdateInput = {};
  for (const k of ['fullName', 'phone', 'altPhone', 'address', 'nationalId', 'deliveryPointId'] as const) {
    if (data[k] !== undefined) (patch as Record<string, unknown>)[k] = data[k];
  }
  if (Object.keys(patch).length) await tx.employee.update({ where: { id: driver.employeeId }, data: patch });
}

// ─── Create ─────────────────────────────────────────────────────

export async function createEmployee(db: Db, actor: Actor, raw: unknown) {
  requireRole(actor, HR);
  const input = employeeCreateSchema.parse(raw);
  if (input.deliveryPointId) {
    const p = await db.deliveryPoint.findUnique({ where: { id: input.deliveryPointId } });
    if (!p) throw Errors.notFound('نقطة الدليفري');
  }
  return db.$transaction(async (tx) => {
    const { vehicleType, vehiclePlate, ...e } = input;
    const emp = await tx.employee.create({
      data: {
        ...e,
        employeeNo: await nextEmployeeNo(tx),
        dateOfBirth: optDate(e.dateOfBirth),
        idExpiryDate: optDate(e.idExpiryDate),
        hireDate: dbDate(e.hireDate),
        drivingLicenseExpiry: optDate(e.drivingLicenseExpiry),
        monthlySalary: new Prisma.Decimal(e.monthlySalary),
        dailyRate: e.dailyRate === null ? null : new Prisma.Decimal(e.dailyRate),
      },
    });
    if (input.jobType === 'DRIVER') {
      // سائق موجود سابقاً بنفس رقم الهوية وبدون ملف؟ نربطه بدل إنشاء سجل مكرر
      const existing = await tx.driver.findUnique({ where: { nationalId: input.nationalId } });
      if (existing) {
        if (existing.employeeId) throw Errors.conflict('يوجد سائق مرتبط بملف آخر بنفس رقم الهوية');
        await tx.driver.update({ where: { id: existing.id }, data: { employeeId: emp.id, ...driverFieldsFrom({ ...input }) } });
      } else {
        await tx.driver.create({
          data: {
            employeeId: emp.id,
            fullName: input.fullName,
            phone: input.phone,
            altPhone: input.altPhone,
            address: input.address,
            nationalId: input.nationalId,
            vehicleType,
            vehiclePlate,
            deliveryPointId: input.deliveryPointId!,
          },
        });
      }
    }
    await writeAudit(tx, actor, { action: 'employee.create', entityType: 'employee', entityId: emp.id, after: emp });
    return emp;
  });
}

// ─── Update ─────────────────────────────────────────────────────

export async function updateEmployee(db: Db, actor: Actor, id: string, raw: unknown) {
  requireRole(actor, HR);
  const input = employeeUpdateSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.employee.findUnique({ where: { id }, include: { driver: true } });
    if (!before) throw Errors.notFound('الموظف');
    const merged = {
      jobType: (input.jobType ?? before.jobType) as EmployeeJob,
      deliveryPointId: input.deliveryPointId !== undefined ? input.deliveryPointId : before.deliveryPointId,
      payType: input.payType ?? before.payType,
      monthlySalary: input.monthlySalary ?? Number(before.monthlySalary),
      dailyRate: input.dailyRate !== undefined ? input.dailyRate : before.dailyRate ? Number(before.dailyRate) : null,
      dateOfBirth: input.dateOfBirth !== undefined ? input.dateOfBirth : before.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      hireDate: input.hireDate ?? before.hireDate.toISOString().slice(0, 10),
    };
    if (merged.jobType === 'DRIVER' && !merged.deliveryPointId) throw Errors.validation('السائق يجب ربطه بنقطة دليفري');
    if (merged.payType !== 'PER_DELIVERY' && merged.monthlySalary <= 0 && !(merged.dailyRate && merged.dailyRate > 0)) {
      throw Errors.validation('حدد الراتب الشهري أو أجر اليوم لهذا النظام');
    }
    if (merged.dateOfBirth && merged.dateOfBirth >= merged.hireDate) throw Errors.validation('تاريخ الميلاد يجب أن يسبق تاريخ الالتحاق');

    const driver = before.driver;
    if (driver) {
      const custody = await openCustody(tx, driver.id);
      if (custody > 0 && merged.deliveryPointId !== driver.deliveryPointId && merged.jobType === 'DRIVER') {
        throw Errors.conflict('لا يمكن نقل سائق لديه عهدة مفتوحة إلى نقطة أخرى. قم بالتسوية أولاً');
      }
      if (custody > 0 && merged.jobType !== 'DRIVER') {
        throw Errors.conflict('لا يمكن تغيير وظيفة سائق لديه عهدة مفتوحة. قم بالتسوية أولاً');
      }
    }

    const { vehicleType, vehiclePlate, ...e } = input;
    const emp = await tx.employee.update({
      where: { id },
      data: {
        ...e,
        dateOfBirth: optDate(e.dateOfBirth),
        idExpiryDate: optDate(e.idExpiryDate),
        hireDate: e.hireDate ? dbDate(e.hireDate) : undefined,
        drivingLicenseExpiry: optDate(e.drivingLicenseExpiry),
        monthlySalary: e.monthlySalary !== undefined ? new Prisma.Decimal(e.monthlySalary) : undefined,
        dailyRate: e.dailyRate === undefined ? undefined : e.dailyRate === null ? null : new Prisma.Decimal(e.dailyRate),
      },
    });

    if (driver) {
      const data = driverFieldsFrom({ ...input, vehicleType, vehiclePlate });
      if (merged.jobType !== 'DRIVER') data.status = 'INACTIVE';
      if (Object.keys(data).length) await tx.driver.update({ where: { id: driver.id }, data });
    } else if (merged.jobType === 'DRIVER') {
      await tx.driver.create({
        data: {
          employeeId: emp.id,
          fullName: emp.fullName,
          phone: emp.phone,
          altPhone: emp.altPhone,
          address: emp.address,
          nationalId: emp.nationalId,
          vehicleType: vehicleType ?? null,
          vehiclePlate: vehiclePlate ?? null,
          deliveryPointId: merged.deliveryPointId!,
          status: emp.status === 'ACTIVE' ? 'AVAILABLE' : 'INACTIVE',
        },
      });
    }
    await writeAudit(tx, actor, { action: 'employee.update', entityType: 'employee', entityId: id, before, after: emp });
    return emp;
  });
}

// ─── Status (نشط / موقوف / متوقف عن العمل) ─────────────────────

export async function changeEmployeeStatus(db: Db, actor: Actor, id: string, raw: unknown) {
  requireRole(actor, HR);
  const input = employeeStatusSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.employee.findUnique({ where: { id }, include: { driver: true } });
    if (!before) throw Errors.notFound('الموظف');
    if (input.status === 'TERMINATED' && input.terminationDate! < before.hireDate.toISOString().slice(0, 10)) {
      throw Errors.validation('تاريخ التوقف قبل تاريخ الالتحاق');
    }
    const driver = before.driver;
    if (driver && input.status !== 'ACTIVE') {
      const custody = await openCustody(tx, driver.id);
      if (custody > 0) {
        throw Errors.conflict(`لدى السائق عهدة مفتوحة (${custody} قطعة). سجّل الإرجاع أو التسوية قبل إيقافه أو إنهاء خدمته`, { custody });
      }
    }
    const emp = await tx.employee.update({
      where: { id },
      data:
        input.status === 'TERMINATED'
          ? { status: 'TERMINATED', terminationDate: dbDate(input.terminationDate!), terminationReason: input.terminationReason }
          : input.status === 'SUSPENDED'
            ? { status: 'SUSPENDED', terminationReason: input.terminationReason ?? before.terminationReason }
            : { status: 'ACTIVE', terminationDate: null, terminationReason: null },
    });
    if (driver) {
      const active = input.status === 'ACTIVE' && emp.jobType === 'DRIVER';
      await tx.driver.update({ where: { id: driver.id }, data: { status: active ? 'AVAILABLE' : 'INACTIVE' } });
      // حساب الدخول المرتبط يُعطَّل مع الإيقاف ويُطرد من كل الأجهزة، ويُعاد تفعيله مع العودة للعمل
      if (driver.userId) {
        await tx.user.update({
          where: { id: driver.userId },
          data: active ? { isActive: true } : { isActive: false, tokenVersion: { increment: 1 } },
        });
      }
    }
    await writeAudit(tx, actor, {
      action: `employee.status.${input.status.toLowerCase()}`,
      entityType: 'employee',
      entityId: id,
      before: { status: before.status, terminationDate: before.terminationDate, terminationReason: before.terminationReason },
      after: { status: emp.status, terminationDate: emp.terminationDate, terminationReason: emp.terminationReason },
    });
    return emp;
  });
}

// ─── Read ───────────────────────────────────────────────────────

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  jobType: z.enum(EMPLOYEE_JOBS).optional(),
  pointId: z.string().max(64).optional(),
  expiring: z.enum(['1']).optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
});

export async function listEmployees(db: Db, actor: Actor, raw: Record<string, string | undefined>) {
  requireRole(actor, HR);
  const q = listQuery.parse(raw);
  const settings = await getSettings(db);
  const soon = dbDate(localDate(new Date(Date.now() + settings.documentExpiryAlertDays * 86_400_000), settings.timezone));
  const where: Prisma.EmployeeWhereInput = {};
  if (q.status) where.status = q.status;
  if (q.jobType) where.jobType = q.jobType;
  if (q.pointId) where.deliveryPointId = q.pointId;
  if (q.q) {
    where.OR = [
      { fullName: { contains: q.q, mode: 'insensitive' } },
      { phone: { contains: q.q } },
      { nationalId: { contains: q.q } },
      { employeeNo: { contains: q.q, mode: 'insensitive' } },
      { jobTitle: { contains: q.q, mode: 'insensitive' } },
    ];
  }
  if (q.expiring) {
    where.AND = [
      { status: { not: 'TERMINATED' } },
      { OR: [{ idExpiryDate: { lte: soon } }, { drivingLicenseExpiry: { lte: soon } }, { documents: { some: { expiryDate: { lte: soon } } } }] },
    ];
  }
  const [total, items] = await Promise.all([
    db.employee.count({ where }),
    db.employee.findMany({
      where,
      orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        deliveryPoint: { select: { id: true, name: true } },
        driver: { select: { id: true, status: true, vehiclePlate: true } },
        documents: {
          select: { id: true, type: true, expiryDate: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    }),
  ]);
  return {
    items: items.map(({ documents, ...e }) => {
      const dates = [e.idExpiryDate, e.drivingLicenseExpiry, ...documents.map((d) => d.expiryDate)].filter((d): d is Date => !!d);
      const nearest = dates.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      return {
        ...e,
        monthlySalary: e.monthlySalary.toString(),
        dailyRate: e.dailyRate?.toString() ?? null,
        photoId: documents.find((d) => d.type === 'PHOTO')?.id ?? null,
        documentsCount: documents.length,
        nearestExpiry: nearest,
      };
    }),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function getEmployee(db: Db, actor: Actor, id: string) {
  requireRole(actor, HR);
  const e = await db.employee.findUnique({
    where: { id },
    include: {
      deliveryPoint: { select: { id: true, name: true } },
      driver: {
        include: { user: { select: { id: true, email: true, isActive: true } }, deliveryPoint: { select: { id: true, name: true } } },
      },
      documents: { orderBy: { createdAt: 'desc' }, include: { uploadedBy: { select: { name: true } } } },
      rates: { where: { isActive: true } },
    },
  });
  if (!e) throw Errors.notFound('الموظف');

  // سجل السائق حسب الألوان: ماذا أخذ، ماذا سلّم، ماذا أرجع
  let driverStats: Record<string, number> | null = null;
  let custody = 0;
  if (e.driver) {
    const sums = await db.stockMovement.groupBy({ by: ['type'], where: { driverId: e.driver.id }, _sum: { quantity: true } });
    driverStats = Object.fromEntries(sums.map((s) => [s.type, s._sum.quantity ?? 0]));
    custody = await openCustody(db, e.driver.id);
  }
  return {
    ...e,
    monthlySalary: e.monthlySalary.toString(),
    dailyRate: e.dailyRate?.toString() ?? null,
    rates: e.rates.map((r) => ({ ...r, amount: r.amount.toString() })),
    driverStats,
    custody,
  };
}
