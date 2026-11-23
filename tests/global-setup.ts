import { execSync } from 'node:child_process';

/**
 * يعيد إنشاء قاعدة بيانات الاختبار من الصفر قبل التشغيل.
 * حماية: يرفض العمل إلا على قاعدة اسمها يحتوي "test"، حتى لا تُمسح قاعدة حقيقية بالخطأ.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL غير مضبوط. مثال: postgresql://rasd:rasd@localhost:5432/rasd_test');
  }
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) {
    throw new Error(`رفض تشغيل الاختبارات: اسم قاعدة البيانات "${dbName}" لا يحتوي "test". الاختبارات تمسح القاعدة بالكامل.`);
  }
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
}
