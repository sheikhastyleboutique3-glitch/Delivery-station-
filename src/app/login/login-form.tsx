'use client';

import { useState } from 'react';
import { apiSend, ApiError } from '@/lib/client/api';
import { Logo } from '@/components/logo';
import { Button, Field, Input } from '@/components/ui';

export function LoginForm({ next }: { next: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ home: string; role: string }>('POST', '/api/auth/login', { email, password });
      const target = next && (res.role !== 'DRIVER' || next.startsWith('/driver') || next.startsWith('/ops')) ? next : res.home;
      window.location.replace(target);
    } catch (err) {
      setError((err as ApiError).messageAr ?? 'تعذر تسجيل الدخول');
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-100 to-slate-200 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-center text-xl font-extrabold">تسجيل الدخول</h1>
          <Field label="البريد الإلكتروني">
            <Input type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="text-start" />
          </Field>
          <Field label="كلمة المرور">
            <Input type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && (
            <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {error}
            </p>
          )}
          <Button type="submit" loading={busy} className="w-full" size="lg">
            دخول
          </Button>
        </form>
        <div className="mt-6 flex justify-center gap-1.5" aria-hidden>
          {['#f97316', '#3b82f6', '#22c55e', '#ef4444', '#a855f7'].map((c) => (
            <span key={c} className="h-1.5 w-8 rounded-full" style={{ background: c }} />
          ))}
        </div>
      </div>
    </main>
  );
}
