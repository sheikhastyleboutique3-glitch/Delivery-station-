import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { DEFAULT_SETTINGS, type AppSettings } from './domain';
import type { Db } from './db';

type Reader = Db | Prisma.TransactionClient;

export const settingsSchema = z.object({
  companyName: z.string().trim().min(1, 'اسم الشركة مطلوب').max(80),
  autoRestockGoodReturns: z.boolean(),
  redAlertHours: z.number().int().min(1).max(24 * 30),
  custodyAlertHours: z.number().int().min(1).max(24 * 30),
  pendingAckAlertHours: z.number().int().min(1).max(24 * 7),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, 'رمز العملة يجب أن يكون 3 أحرف إنجليزية كبيرة مثل QAR'),
  timezone: z.string().trim().refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'المنطقة الزمنية غير صحيحة'),
  numerals: z.enum(['latin', 'arabic']),
  barcodeFormat: z.enum(['CODE128', 'EAN13', 'QR']),
  labelWidthMm: z.number().int().min(20).max(150),
  labelHeightMm: z.number().int().min(10).max(150),
});

export async function getSettings(db: Reader): Promise<AppSettings> {
  const rows = await db.setting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) merged[r.key] = r.value;
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}
