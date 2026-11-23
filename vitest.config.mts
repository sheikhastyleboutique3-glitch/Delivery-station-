import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const testDb = process.env.TEST_DATABASE_URL ?? '';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: './tests/global-setup.ts',
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // الاختبارات تشترك في قاعدة بيانات واحدة (وفي جدول الإعدادات)؛ نشغّل الملفات بالتتابع
    fileParallelism: false,
    env: {
      DATABASE_URL: testDb,
      DIRECT_URL: testDb,
      AUTH_SECRET: 'test-secret-test-secret-test-secret-test-secret',
    },
  },
});
