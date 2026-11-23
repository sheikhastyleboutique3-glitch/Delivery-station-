'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DRIVER_STATUS_LABELS, OPERATION_LABELS, type OperationKind, type StockColor } from '@/lib/domain';
import { useApi } from '@/lib/client/hooks';
import type { Alert, Operation } from '@/lib/client/types';
import { ColorSummary, type ColorTotals } from '@/components/colors';
import { useApp } from '@/components/providers';
import { Card, EmptyState, ErrorBox, LinkButton, Loading, PageHeader } from '@/components/ui';

interface Dashboard {
  totals: ColorTotals;
  drivers: Record<string, number>;
  todayOps: Record<string, number>;
  driversWithCustody: number;
  recent: Operation[];
  alerts: Alert[];
}

const SEVERITY: Record<Alert['severity'], string> = {
  danger: 'border-red-200 bg-red-50 text-red-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-slate-200 bg-slate-50 text-slate-800',
};

export default function DashboardPage() {
  const { f, user } = useApp();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Dashboard>('/api/dashboard', { refreshMs: 20_000 });

  return (
    <>
      <PageHeader
        title={`أهلاً ${user.name}`}
        subtitle={user.pointName ? `نقطة: ${user.pointName}` : 'نظرة عامة على كل النقاط'}
        actions={
          <>
            <LinkButton href="/dispatch" variant="primary">
              صرف لسائق
            </LinkButton>
            <LinkButton href="/returns">استلام مرتجع</LinkButton>
          </>
        }
      />
      {loading && !data && <Loading />}
      <ErrorBox error={error} onRetry={reload} />
      {data && (
        <div className="space-y-4">
          <ColorSummary totals={data.totals} onSelect={(c: StockColor | null) => router.push(c ? `/warehouse?color=${c}` : '/warehouse')} />

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title={`التنبيهات (${f.n(data.alerts.length)})`} className="lg:col-span-2">
              {data.alerts.length === 0 ? (
                <EmptyState title="لا توجد تنبيهات" hint="كل شيء على ما يرام" />
              ) : (
                <ul className="max-h-96 space-y-2 overflow-y-auto">
                  {data.alerts.map((a, i) => (
                    <li key={i}>
                      <Link href={a.href} className={`block rounded-xl border px-3 py-2 text-sm ${SEVERITY[a.severity]}`}>
                        <span className="font-bold">{a.title}: </span>
                        {a.message}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="السائقون">
              <dl className="grid grid-cols-2 gap-2 text-center">
                {(['AVAILABLE', 'ON_TRIP', 'INACTIVE'] as const).map((s) => (
                  <div key={s} className="rounded-xl bg-slate-50 p-3">
                    <dt className="text-xs text-slate-500">{DRIVER_STATUS_LABELS[s]}</dt>
                    <dd className="text-2xl font-black">{f.n(data.drivers[s] ?? 0)}</dd>
                  </div>
                ))}
                <div className="rounded-xl bg-blue-50 p-3">
                  <dt className="text-xs text-blue-800">لديهم عهدة</dt>
                  <dd className="text-2xl font-black text-blue-900">{f.n(data.driversWithCustody)}</dd>
                </div>
              </dl>
              <LinkButton href="/drivers" className="mt-3 w-full">
                إدارة السائقين
              </LinkButton>
            </Card>
          </div>

          <Card title="عمليات اليوم">
            {Object.keys(data.todayOps).length === 0 ? (
              <p className="text-sm text-slate-500">لا توجد عمليات اليوم بعد.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.todayOps).map(([k, v]) => (
                  <span key={k} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold">
                    {OPERATION_LABELS[k as OperationKind]}: <b>{f.n(v)}</b>
                  </span>
                ))}
              </div>
            )}
          </Card>

          <Card title="آخر العمليات" actions={<LinkButton href="/movements">السجل الكامل</LinkButton>}>
            {data.recent.length === 0 ? (
              <EmptyState title="لا توجد عمليات بعد" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.recent.map((op) => (
                  <li key={op.id}>
                    <Link href={`/ops/${op.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-slate-50">
                      <span className="min-w-0">
                        <span className="ltr me-2 font-mono text-xs font-bold text-slate-500">{op.opNo}</span>
                        <span className="font-semibold">{OPERATION_LABELS[op.kind]}</span>
                        {op.driver && <span className="text-sm text-slate-600"> · {op.driver.fullName}</span>}
                        {op.customer && <span className="text-sm text-slate-600"> · {op.customer.name}</span>}
                      </span>
                      <span className="text-xs text-slate-500">
                        {f.n(op.totalQuantity ?? 0)} قطعة · {f.since(op.createdAt)} · {op.performedBy?.name}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
