import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'تسجيل الدخول' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // نقبل فقط مسارات داخلية لمنع إعادة التوجيه لمواقع خارجية
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  return <LoginForm next={safeNext} />;
}
