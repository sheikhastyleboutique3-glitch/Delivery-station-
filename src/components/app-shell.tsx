'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ROLE_LABELS, type Role } from '@/lib/domain';
import { apiSend } from '@/lib/client/api';
import { Logo } from './logo';
import { Icon, type IconName } from './icons';
import { useApp } from './providers';
import { cx } from './ui';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  roles: Role[];
  primary?: boolean; // يظهر في الشريط السفلي على الجوال
}

const STAFF: Role[] = ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER'];

export const NAV: NavItem[] = [
  { href: '/', label: 'الرئيسية', icon: 'home', roles: STAFF, primary: true },
  { href: '/warehouse', label: 'المستودع', icon: 'warehouse', roles: STAFF, primary: true },
  { href: '/dispatch', label: 'صرف', icon: 'dispatch', roles: STAFF, primary: true },
  { href: '/returns', label: 'إرجاع', icon: 'returns', roles: STAFF, primary: true },
  { href: '/stock-in', label: 'إدخال مخزون', icon: 'plus', roles: STAFF },
  { href: '/sorting', label: 'الفرز والمعالجة', icon: 'sorting', roles: STAFF },
  { href: '/transfers', label: 'تحويل بين النقاط', icon: 'transfer', roles: STAFF },
  { href: '/drivers', label: 'السائقون', icon: 'driver', roles: STAFF },
  { href: '/movements', label: 'سجل الحركات', icon: 'list', roles: STAFF },
  { href: '/products', label: 'المنتجات', icon: 'box', roles: STAFF },
  { href: '/customers', label: 'العملاء', icon: 'users', roles: STAFF },
  { href: '/reports', label: 'التقارير', icon: 'chart', roles: STAFF },
  { href: '/points', label: 'نقاط الدليفري', icon: 'pin', roles: ['ADMIN'] },
  { href: '/users', label: 'المستخدمون', icon: 'key', roles: ['ADMIN'] },
  { href: '/audit', label: 'التدقيق والتطابق', icon: 'shield', roles: ['ADMIN'] },
  { href: '/settings', label: 'الإعدادات', icon: 'gear', roles: ['ADMIN'] },
  { href: '/driver', label: 'عهدتي', icon: 'clipboard', roles: ['DRIVER'], primary: true },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = NAV.filter((n) => n.roles.includes(user.role));
  const primary = items.filter((n) => n.primary);

  async function logout() {
    await apiSend('POST', '/api/auth/logout').catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen lg:flex">
      {/* الشريط الجانبي (حاسوب) */}
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-slate-200 bg-white lg:flex">
        <div className="border-b border-slate-200 px-4 py-4">
          <Link href={user.role === 'DRIVER' ? '/driver' : '/'}>
            <Logo />
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-2" aria-label="القائمة الرئيسية">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                'mb-0.5 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold',
                isActive(pathname, n.href) ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
              )}
            >
              <Icon name={n.icon} />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3 text-sm">
          <p className="font-bold">{user.name}</p>
          <p className="text-xs text-slate-500">
            {ROLE_LABELS[user.role]}
            {user.pointName ? ` · ${user.pointName}` : ''}
          </p>
          <button onClick={logout} className="mt-2 min-h-10 w-full rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50">
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* الترويسة (جوال) */}
        <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur lg:hidden">
          <Link href={user.role === 'DRIVER' ? '/driver' : '/'}>
            <Logo subtitle={false} />
          </Link>
          <div className="text-end text-xs leading-tight">
            <p className="font-bold">{user.name}</p>
            <p className="text-slate-500">{ROLE_LABELS[user.role]}</p>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-3 pb-28 pt-4 sm:px-5 lg:pb-10 lg:pt-6">{children}</main>

        {/* الشريط السفلي (جوال) */}
        <nav
          className="no-print fixed inset-x-0 bottom-0 z-40 grid border-t border-slate-200 bg-white lg:hidden"
          style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))`, paddingBottom: 'env(safe-area-inset-bottom)' }}
          aria-label="التنقل السريع"
        >
          {primary.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx('flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-bold', isActive(pathname, n.href) ? 'text-slate-900' : 'text-slate-500')}
            >
              <Icon name={n.icon} className={cx('h-6 w-6', isActive(pathname, n.href) && 'scale-110')} />
              {n.label}
            </Link>
          ))}
          <button onClick={() => setMoreOpen(true)} className="flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-bold text-slate-500">
            <Icon name="more" className="h-6 w-6" />
            المزيد
          </button>
        </nav>

        {moreOpen && (
          <div className="no-print fixed inset-0 z-50 flex items-end bg-slate-900/50 lg:hidden" onClick={() => setMoreOpen(false)}>
            <div className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-white p-3" onClick={(e) => e.stopPropagation()}>
              <div className="grid grid-cols-3 gap-2">
                {items.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setMoreOpen(false)}
                    className={cx(
                      'flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border text-center text-xs font-bold',
                      isActive(pathname, n.href) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200',
                    )}
                  >
                    <Icon name={n.icon} className="h-6 w-6" />
                    {n.label}
                  </Link>
                ))}
              </div>
              <button onClick={logout} className="mt-3 min-h-12 w-full rounded-xl border border-red-200 text-sm font-bold text-red-700">
                تسجيل الخروج
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
