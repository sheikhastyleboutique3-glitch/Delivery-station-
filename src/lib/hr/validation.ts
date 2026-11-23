import { z } from 'zod';
import {
  ATTENDANCE_STATUSES,
  COMMISSION_MODES,
  DOCUMENT_TYPES,
  EMPLOYEE_JOBS,
  EMPLOYEE_STATUSES,
  PAYMENT_METHODS,
  PAY_TYPES,
} from '../domain';
import { DATE_RE } from './util';
import { idSchema, idempotencyKeySchema } from '../validation';

const text = (max = 300) =>
  z
    .string()
    .trim()
    .max(max, `النص أطول من ${max} حرف`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const required = (label: string, max = 160) =>
  z.string({ error: `${label} مطلوب` }).trim().min(1, `${label} مطلوب`).max(max);
const phone = z
  .string({ error: 'رقم الهاتف مطلوب' })
  .trim()
  .min(6, 'رقم الهاتف قصير جداً')
  .max(20)
  .regex(/^[+\d][\d\s-]*$/, 'رقم الهاتف يحتوي رموزاً غير مسموحة');
const optPhone = z.union([phone, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));
const date = (label: string) => z.string({ error: `${label} مطلوب` }).regex(DATE_RE, `${label}: صيغة التاريخ YYYY-MM-DD`);
const optDate = (label: string) => z.union([date(label), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));

/** مبلغ بالدينار (يقبل نصاً أو رقماً) */
export const amountSchema = z.coerce
  .number({ error: 'المبلغ يجب أن يكون رقماً' })
  .min(0, 'المبلغ لا يمكن أن يكون سالباً')
  .max(1_000_000_000, 'المبلغ كبير جداً')
  .transform((v) => Math.round(v * 100) / 100);
const optAmount = z.union([amountSchema, z.literal(''), z.null()]).optional().transform((v) => (v === '' || v === undefined ? null : v));

const employeeBase = z.object({
  fullName: required('الاسم الكامل', 120),
  phone,
  altPhone: optPhone,
  address: text(300),
  dateOfBirth: optDate('تاريخ الميلاد'),
  nationality: text(60),
  notes: text(1000),
  nationalId: required('رقم بطاقة التعريف', 40),
  idExpiryDate: optDate('تاريخ انتهاء البطاقة'),
  jobType: z.enum(EMPLOYEE_JOBS),
  jobTitle: text(80),
  deliveryPointId: idSchema.optional().nullable().transform((v) => v || null),
  hireDate: date('تاريخ الالتحاق'),
  drivingLicenseNumber: text(40),
  drivingLicenseExpiry: optDate('تاريخ انتهاء الرخصة'),
  payType: z.enum(PAY_TYPES).default('PER_DELIVERY'),
  monthlySalary: amountSchema.default(0),
  dailyRate: optAmount,
  workDaysPerMonth: z
    .union([z.literal(''), z.null(), z.coerce.number().int().min(1, 'أيام العمل بين 1 و 31').max(31, 'أيام العمل بين 1 و 31')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  commissionMode: z.enum(COMMISSION_MODES).default('PER_UNIT'),
  // بيانات المركبة (للسائقين)
  vehicleType: text(60),
  vehiclePlate: text(30),
});

function refineEmployee<T extends z.ZodType<Partial<z.infer<typeof employeeBase>>>>(schema: T) {
  return schema
    .refine((e) => !e.dateOfBirth || !e.hireDate || e.dateOfBirth < e.hireDate, {
      message: 'تاريخ الميلاد يجب أن يسبق تاريخ الالتحاق',
      path: ['dateOfBirth'],
    })
    .refine((e) => e.jobType !== 'DRIVER' || !!e.deliveryPointId, {
      message: 'السائق يجب ربطه بنقطة دليفري',
      path: ['deliveryPointId'],
    })
    .refine((e) => e.payType !== 'MONTHLY_OR_DAILY' && e.payType !== 'HYBRID' ? true : (e.monthlySalary ?? 0) > 0 || (e.dailyRate ?? 0) > 0, {
      message: 'حدد الراتب الشهري أو أجر اليوم لهذا النظام',
      path: ['monthlySalary'],
    });
}

export const employeeCreateSchema = refineEmployee(employeeBase);
export const employeeUpdateSchema = employeeBase.partial();

export const employeeStatusSchema = z
  .object({
    status: z.enum(EMPLOYEE_STATUSES),
    terminationDate: optDate('تاريخ التوقف'),
    terminationReason: text(500),
  })
  .refine((v) => v.status !== 'TERMINATED' || (!!v.terminationDate && !!v.terminationReason), {
    message: 'تاريخ التوقف وسببه إلزاميان عند إنهاء الخدمة',
    path: ['terminationReason'],
  });

export const attendanceMarkSchema = z.object({
  date: date('التاريخ'),
  status: z.enum(ATTENDANCE_STATUSES),
  notes: text(300),
});

export const documentMetaSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  title: text(120),
  docNumber: text(60),
  issueDate: optDate('تاريخ الإصدار'),
  expiryDate: optDate('تاريخ الانتهاء'),
});

export const rateSchema = z
  .object({
    mode: z.enum(COMMISSION_MODES),
    amount: amountSchema.refine((v) => v > 0, 'السعر يجب أن يكون أكبر من صفر'),
    employeeId: idSchema.optional().nullable().transform((v) => v || null),
    category: text(80),
    deliveryPointId: idSchema.optional().nullable().transform((v) => v || null),
    label: text(120),
  })
  .refine((r) => r.employeeId || r.category || r.deliveryPointId, {
    message: 'حدد موظفاً أو فئة منتج أو نقطة دليفري. السعر العام يُعدَّل من الإعدادات',
    path: ['employeeId'],
  });

export const periodSchema = z
  .object({ employeeId: idSchema, from: date('بداية الفترة'), to: date('نهاية الفترة') })
  .refine((p) => p.from <= p.to, { message: 'بداية الفترة بعد نهايتها', path: ['to'] });

export const payoutCreateSchema = z
  .object({
    employeeId: idSchema,
    from: date('بداية الفترة'),
    to: date('نهاية الفترة'),
    bonusAmount: amountSchema.default(0),
    deductionAmount: amountSchema.default(0),
    notes: text(500),
  })
  .refine((p) => p.from <= p.to, { message: 'بداية الفترة بعد نهايتها', path: ['to'] });

export const payoutBulkSchema = z
  .object({ from: date('بداية الفترة'), to: date('نهاية الفترة'), deliveryPointId: idSchema.optional().nullable() })
  .refine((p) => p.from <= p.to, { message: 'بداية الفترة بعد نهايتها', path: ['to'] });

export const payoutUpdateSchema = z.object({
  bonusAmount: amountSchema.optional(),
  deductionAmount: amountSchema.optional(),
  notes: text(500),
});

export const paymentSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  amount: amountSchema.refine((v) => v > 0, 'مبلغ الدفعة يجب أن يكون أكبر من صفر'),
  method: z.enum(PAYMENT_METHODS),
  reference: text(80),
  note: text(300),
  paidAt: z
    .string()
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (!v) return new Date();
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: 'custom', message: 'تاريخ الدفع غير صحيح' });
        return z.NEVER;
      }
      return d;
    }),
});
