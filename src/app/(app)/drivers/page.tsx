'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DRIVER_STATUSES, DRIVER_STATUS_LABELS } from '@/lib/domain';
import { qs } from '@/lib/client/api';
import { useApi, useDebounce } from '@/lib/client/hooks';
import type { Driver, Paged } from '@/lib/client/types';
import { ColorChip } from '@/components/colors';
import { DriverFormModal } from '@/components/driver-form';
import { useApp } from '@/components/providers';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Loading, PageHeader, Pagination, Select } from '@/components/ui';

const STATUS_STYLE: Record<Driver['status'], string> = {
  AVAILABLE: 'border-green-300 bg-green-100 text-green-900',
  ON_TRIP: 'border-blue-300 bg-blue-100 text-blue-900',
  INACTIVE: 'border-slate-300 bg-slate-100 text-slate-600',
};

export default function DriversPage() {
  const { f } = useApp();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const dq = useDebounce(q, 300);
  const { data, error, loading, reload } = useApi<Paged<Driver>>(`/api/drivers${qs({ q: dq, status, page, pageSize: 30 })}`, { refreshMs: 30_000 });

  return (
    <>
      <PageHeader title="السائقون" subtitle="بيانات السائقين وعهدة كل سائق" actions={<Button onClick={() => setCreating(true)}>+ إضافة سائق</Button>} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="بحث">
            <Input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="الاسم، الهاتف، الهوية، اللوحة" />
          </Field>
          <Field label="الحالة">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">الكل</option>
              {DRIVER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {DRIVER_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <div className="mt-4">
        {loading && !data && <Loading />}
        <ErrorBox error={error} onRetry={reload} />
        {data && data.items.length === 0 && <EmptyState title="لا يوجد سائقون" action={<Button onClick={() => setCreating(true)}>إضافة سائق</Button>} />}
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data?.items.map((d) => (
            <li key={d.id}>
              <Link href={`/drivers/${d.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-400">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{d.fullName}</p>
                    <p className="ltr text-start text-sm text-slate-600">{d.phone}</p>
                  </div>
                  <Badge className={STATUS_STYLE[d.status]}>{DRIVER_STATUS_LABELS[d.status]}</Badge>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {d.deliveryPoint?.name}
                  {d.vehiclePlate ? ` · ${d.vehicleType ?? ''} ${d.vehiclePlate}` : ''}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <ColorChip color="BLUE" count={d.custodyTotal ?? 0} />
                  <span className="text-xs text-slate-500">{d.custodySince ? `عهدة ${f.since(d.custodySince)}` : 'لا عهدة'}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </div>

      {creating && (
        <DriverFormModal
          driver={null}
          open
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </>
  );
}
