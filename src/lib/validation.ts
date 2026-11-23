import { z } from 'zod';
import { COLORS, DRIVER_STATUSES, ROLES, SCAN_SOURCES } from './domain';

// ─── Primitives ─────────────────────────────────────────────────

export const idSchema = z.string().trim().min(1, 'المعرّف مطلوب').max(64);
const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `النص أطول من ${max} حرف`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const requiredText = (label: string, max = 200) =>
  z.string({ error: `${label} مطلوب` }).trim().min(1, `${label} مطلوب`).max(max, `${label} أطول من ${max} حرف`);

export const quantitySchema = z
  .number({ error: 'الكمية يجب أن تكون رقماً' })
  .int('الكمية يجب أن تكون عدداً صحيحاً')
  .positive('الكمية يجب أن تكون أكبر من صفر')
  .max(1_000_000, 'الكمية كبيرة جداً');

export const idempotencyKeySchema = z
  .string({ error: 'مفتاح منع التكرار مطلوب' })
  .trim()
  .min(8, 'مفتاح منع التكرار قصير جداً')
  .max(100);

const phoneSchema = z
  .string({ error: 'رقم الهاتف مطلوب' })
  .trim()
  .min(6, 'رقم الهاتف قصير جداً')
  .max(20, 'رقم الهاتف طويل جداً')
  .regex(/^[+\d][\d\s-]*$/, 'رقم الهاتف يحتوي رموزاً غير مسموحة');

const optionalPhone = z
  .union([phoneSchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

const serialsSchema = z.array(z.string().trim().min(1).max(100)).max(5000).default([]);

const lineBase = {
  productId: idSchema,
  quantity: quantitySchema,
  unitSerials: serialsSchema,
  scannedBarcode: optionalText(100),
  scanSource: z.enum(SCAN_SOURCES).optional().nullable(),
  notes: optionalText(),
};

const lines = <T extends z.ZodTypeAny>(item: T) =>
  z.array(item).min(1, 'أضف منتجاً واحداً على الأقل').max(300, 'عدد الأصناف في العملية الواحدة كبير جداً');

// ─── Stock operations ───────────────────────────────────────────

export const stockInSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  pointId: idSchema,
  lines: lines(z.object(lineBase)),
  notes: optionalText(),
});

export const dispatchSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  driverId: idSchema,
  pointId: idSchema,
  lines: lines(z.object(lineBase)),
  notes: optionalText(),
});

export const newCustomerSchema = z.object({
  name: requiredText('اسم العميل', 120),
  phone: phoneSchema,
  address: optionalText(300),
  deliveryNotes: optionalText(),
});

export const deliverSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    driverId: idSchema,
    customerId: idSchema.optional().nullable(),
    newCustomer: newCustomerSchema.optional().nullable(),
    lines: lines(z.object(lineBase)),
    notes: optionalText(),
  })
  .refine((v) => !!v.customerId || !!v.newCustomer, { message: 'حدد العميل أو أدخل بيانات عميل جديد', path: ['customerId'] });

export const returnConditionSchema = z.enum(['GOOD', 'DAMAGED', 'MISSING']);

export const returnSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  driverId: idSchema,
  receivingPointId: idSchema,
  lines: lines(
    z
      .object({ ...lineBase, condition: returnConditionSchema, reason: optionalText() })
      .refine((l) => l.condition === 'GOOD' || !!l.reason, {
        message: 'سبب الإرجاع إلزامي للقطع التالفة أو المفقودة',
        path: ['reason'],
      }),
  ),
  notes: optionalText(),
});

export const sortSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  pointId: idSchema,
  lines: lines(
    z
      .object({ ...lineBase, result: z.enum(['AVAILABLE', 'DAMAGED']), reason: optionalText() })
      .refine((l) => l.result === 'AVAILABLE' || !!l.reason, { message: 'سبب التلف إلزامي', path: ['reason'] }),
  ),
  notes: optionalText(),
});

export const resolveRedSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  pointId: idSchema,
  lines: lines(
    z.object({
      ...lineBase,
      action: z.enum(['RESTOCK', 'WRITE_OFF']),
      reason: requiredText('سبب المعالجة', 500),
    }),
  ),
  notes: optionalText(),
});

export const customerReturnSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  receivingPointId: idSchema,
  customerId: idSchema.optional().nullable(),
  lines: lines(
    z.object({
      ...lineBase,
      fromPointId: idSchema.optional().nullable(),
      condition: z.enum(['GOOD', 'DAMAGED']),
      reason: requiredText('سبب الإرجاع', 500),
    }),
  ),
  notes: optionalText(),
});

export const transferSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    fromPointId: idSchema,
    toPointId: idSchema,
    lines: lines(z.object(lineBase)),
    notes: optionalText(),
  })
  .refine((v) => v.fromPointId !== v.toPointId, { message: 'نقطة المصدر والوجهة متطابقتان', path: ['toPointId'] });

export const settleSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    driverId: idSchema,
    receivingPointId: idSchema.optional().nullable(),
    markRemainingAsShortage: z.boolean().default(false),
    reason: optionalText(),
    notes: optionalText(),
  })
  .refine((v) => !v.markRemainingAsShortage || !!v.reason, {
    message: 'سبب العجز إلزامي عند تسجيل العهدة المتبقية كمفقودة',
    path: ['reason'],
  });

export const statusChangeSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  pointId: idSchema,
  productId: idSchema,
  fromColor: z.enum(COLORS),
  toColor: z.enum(COLORS),
  quantity: quantitySchema,
  unitSerials: serialsSchema,
  reason: requiredText('سبب التعديل', 500),
});

// ─── Master data ────────────────────────────────────────────────

const money = z.coerce
  .number({ error: 'القيمة يجب أن تكون رقماً' })
  .min(0, 'القيمة لا يمكن أن تكون سالبة')
  .max(100_000_000)
  .transform((v) => Math.round(v * 100) / 100);

export const productSchema = z.object({
  name: requiredText('اسم المنتج', 160),
  sku: requiredText('رمز SKU', 64).regex(/^[A-Za-z0-9._-]+$/, 'SKU يقبل الأحرف الإنجليزية والأرقام و . _ - فقط'),
  barcode: requiredText('الباركود', 64).regex(/^[A-Za-z0-9._-]+$/, 'الباركود يقبل الأحرف الإنجليزية والأرقام فقط'),
  category: requiredText('الفئة', 80),
  unit: z.string().trim().min(1).max(30).default('قطعة'),
  price: money,
  cost: money,
  minStockAlert: z.coerce.number().int('حد التنبيه عدد صحيح').min(0).max(1_000_000).default(0),
  trackUnits: z.boolean().default(false),
  imageUrl: z
    .union([z.url('رابط الصورة غير صحيح').max(500), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
});
export const productUpdateSchema = productSchema.partial().extend({ isArchived: z.boolean().optional() });

export const driverSchema = z.object({
  fullName: requiredText('اسم السائق', 120),
  phone: phoneSchema,
  altPhone: optionalPhone,
  address: optionalText(300),
  nationalId: requiredText('رقم الهوية', 40),
  vehicleType: optionalText(60),
  vehiclePlate: optionalText(30),
  deliveryPointId: idSchema,
  status: z.enum(DRIVER_STATUSES).default('AVAILABLE'),
  notes: optionalText(),
  userId: idSchema.optional().nullable(),
});
export const driverUpdateSchema = driverSchema.partial();

export const customerSchema = z.object({
  name: requiredText('اسم العميل', 120),
  phone: phoneSchema,
  altPhone: optionalPhone,
  address: optionalText(300),
  deliveryNotes: optionalText(),
});
export const customerUpdateSchema = customerSchema.partial();

export const pointSchema = z.object({
  code: requiredText('رمز النقطة', 20).regex(/^[A-Za-z0-9_-]+$/, 'الرمز بالأحرف الإنجليزية والأرقام فقط'),
  name: requiredText('اسم النقطة', 120),
  type: z.enum(['WAREHOUSE', 'HUB']).default('HUB'),
  address: optionalText(300),
  phone: optionalPhone,
  isActive: z.boolean().default(true),
});
export const pointUpdateSchema = pointSchema.partial();

export const passwordSchema = z
  .string({ error: 'كلمة المرور مطلوبة' })
  .min(8, 'كلمة المرور 8 أحرف على الأقل')
  .max(128)
  .refine((p) => /[A-Za-z\u0600-\u06FF]/.test(p) && /\d/.test(p), 'كلمة المرور يجب أن تحتوي حروفاً وأرقاماً');

export const userCreateSchema = z
  .object({
    name: requiredText('الاسم', 120),
    email: z.string({ error: 'البريد الإلكتروني مطلوب' }).trim().toLowerCase().max(160).pipe(z.email('البريد الإلكتروني غير صحيح')),
    password: passwordSchema,
    role: z.enum(ROLES),
    deliveryPointId: idSchema.optional().nullable(),
    driverId: idSchema.optional().nullable(),
  })
  .refine((u) => u.role !== 'HUB_MANAGER' || !!u.deliveryPointId, {
    message: 'مسؤول النقطة يجب ربطه بنقطة دليفري',
    path: ['deliveryPointId'],
  })
  .refine((u) => u.role !== 'DRIVER' || !!u.driverId, { message: 'حساب السائق يجب ربطه بسجل سائق', path: ['driverId'] });

export const userUpdateSchema = z.object({
  name: requiredText('الاسم', 120).optional(),
  role: z.enum(ROLES).optional(),
  deliveryPointId: idSchema.optional().nullable(),
  isActive: z.boolean().optional(),
  password: passwordSchema.optional(),
});

export const loginSchema = z.object({
  email: z.string({ error: 'البريد الإلكتروني مطلوب' }).trim().toLowerCase().max(160).pipe(z.email('البريد الإلكتروني غير صحيح')),
  password: z.string().min(1, 'كلمة المرور مطلوبة').max(128),
});

// ─── Query params ───────────────────────────────────────────────

export const pageSchema = z.coerce.number().int().min(1).max(100_000).default(1);
export const pageSizeSchema = z.coerce.number().int().min(1).max(200).default(50);
