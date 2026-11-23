import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

/** خطأ تطبيقي بشكل موحّد: { code, message_ar, details } */
export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    public messageAr: string,
    public details?: unknown,
  ) {
    super(`${code}: ${messageAr}`);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthorized: () => new AppError('UNAUTHORIZED', 401, 'يجب تسجيل الدخول أولاً'),
  forbidden: (msg = 'ليست لديك صلاحية لتنفيذ هذا الإجراء') => new AppError('FORBIDDEN', 403, msg),
  notFound: (what = 'العنصر') => new AppError('NOT_FOUND', 404, `${what} غير موجود`),
  validation: (msg: string, details?: unknown) => new AppError('VALIDATION', 400, msg, details),
  conflict: (msg: string, details?: unknown) => new AppError('CONFLICT', 409, msg, details),
  insufficient: (msg: string, details?: unknown) => new AppError('INSUFFICIENT_STOCK', 409, msg, details),
  badTransition: (msg: string, details?: unknown) => new AppError('INVALID_TRANSITION', 422, msg, details),
  rateLimited: (msg: string) => new AppError('RATE_LIMITED', 429, msg),
};

const UNIQUE_FIELD_LABELS: Record<string, string> = {
  sku: 'رمز SKU',
  barcode: 'الباركود',
  email: 'البريد الإلكتروني',
  national_id: 'رقم الهوية',
  nationalId: 'رقم الهوية',
  name: 'الاسم',
  code: 'الرمز',
  serial: 'الرقم التسلسلي',
  user_id: 'حساب المستخدم',
  userId: 'حساب المستخدم',
};

export interface ErrorBody {
  code: string;
  message_ar: string;
  details?: unknown;
}

/** يحوّل أي خطأ إلى الشكل الموحّد مع رمز HTTP مناسب */
export function toErrorBody(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof AppError) {
    return { status: err.status, body: { code: err.code, message_ar: err.messageAr, details: err.details } };
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const path = issue.path.join('.') || '_';
      if (!fields[path]) fields[path] = issue.message;
    }
    const first = err.issues[0];
    return {
      status: 400,
      body: { code: 'VALIDATION', message_ar: first ? `بيانات غير صحيحة: ${first.message}` : 'بيانات غير صحيحة', details: { fields } },
    };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | string | undefined) ?? [];
      const fields = Array.isArray(target) ? target : [target];
      const label = fields.map((f) => UNIQUE_FIELD_LABELS[f] ?? f).join('، ');
      return { status: 409, body: { code: 'DUPLICATE', message_ar: `القيمة مستخدمة مسبقاً: ${label}`, details: { fields } } };
    }
    if (err.code === 'P2025') {
      return { status: 404, body: { code: 'NOT_FOUND', message_ar: 'العنصر غير موجود' } };
    }
    if (err.code === 'P2003') {
      return { status: 409, body: { code: 'FK_VIOLATION', message_ar: 'لا يمكن تنفيذ العملية لأن العنصر مرتبط ببيانات أخرى' } };
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/check constraint/i.test(msg)) {
    return { status: 409, body: { code: 'CONSTRAINT', message_ar: 'العملية تخالف قيود سلامة البيانات (مثل رصيد سالب)' } };
  }
  console.error('[rasd] unexpected error', err);
  return { status: 500, body: { code: 'INTERNAL', message_ar: 'حدث خطأ غير متوقع. حاول مرة أخرى.' } };
}

/** هل الخطأ ناتج عن تعارض تزامن يستحق إعادة المحاولة؟ */
export function isRetryableTxError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /40001|40P01|deadlock detected|could not serialize/i.test(msg);
}
