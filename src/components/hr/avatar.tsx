'use client';

import type { EmployeeStatus } from '@/lib/domain';

export const STATUS_STYLE: Record<EmployeeStatus, string> = {
  ACTIVE: 'border-green-300 bg-green-100 text-green-900',
  SUSPENDED: 'border-amber-300 bg-amber-100 text-amber-900',
  TERMINATED: 'border-slate-300 bg-slate-200 text-slate-700',
};

export function Avatar({ photoId, name, size = 'h-12 w-12' }: { photoId?: string | null; name: string; size?: string }) {
  return photoId ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/documents/${photoId}`} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-slate-200 text-lg font-black text-slate-600`} aria-hidden>
      {name.trim().charAt(0)}
    </span>
  );
}

