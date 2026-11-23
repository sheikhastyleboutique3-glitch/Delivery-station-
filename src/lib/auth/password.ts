import bcrypt from 'bcryptjs';

// bcrypt بتكلفة 12 (≈ 250ms). bcryptjs مكتوب بـ JavaScript فيعمل على Vercel دون مكتبات أصلية.
const COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// تُقارن عند عدم وجود المستخدم حتى يستغرق الرد نفس الوقت تقريباً (منع كشف الحسابات)
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= bcrypt.hash('rasd-dummy-password', COST);
  return dummy;
}
