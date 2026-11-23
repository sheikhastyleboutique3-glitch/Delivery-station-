'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AppSettings, Role } from '@/lib/domain';
import { makeFormatters, type Formatters } from '@/lib/client/format';

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
  deliveryPointId: string | null;
  driverId: string | null;
  pointName: string | null;
}

interface AppCtx {
  user: SessionUser;
  settings: AppSettings;
  f: Formatters;
  toast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}

interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error' | 'info';
}

export function AppProvider({ user, settings, children }: { user: SessionUser; settings: AppSettings; children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
    if (kind !== 'info' && 'vibrate' in navigator) navigator.vibrate?.(kind === 'error' ? [80, 60, 80] : 40);
  }, []);
  const f = useMemo(() => makeFormatters(settings), [settings]);
  const value = useMemo(() => ({ user, settings, f, toast }), [user, settings, f, toast]);

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ${
              t.kind === 'error' ? 'bg-red-600 text-white' : t.kind === 'info' ? 'bg-slate-800 text-white' : 'bg-green-600 text-white'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
