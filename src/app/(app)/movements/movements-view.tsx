'use client';

import { useState } from 'react';
import { COLORS, COLOR_META, MOVEMENT_LABELS, MOVEMENT_TYPES, type StockColor } from '@/lib/domain';
import { useDebounce } from '@/lib/client/hooks';
import { MovementsList, type MovementFilter } from '@/components/movements';
import { DriverSelect, PointSelect } from '@/components/pickers';
import { useApp } from '@/components/providers';
import { Button, Card, Field, Input, PageHeader, Select } from '@/components/ui';

export function MovementsView({ initial }: { initial: MovementFilter }) {
  const { user } = useApp();
  const [flt, setFlt] = useState<MovementFilter>(initial);
  const [q, setQ] = useState(initial.q ?? '');
  const dq = useDebounce(q, 300);
  const set = (k: keyof MovementFilter, v: string) => setFlt((f) => ({ ...f, [k]: v || undefined }));
  const scoped = user.role !== 'ADMIN' && !!user.deliveryPointId;

  return (
    <>
      <PageHeader
        title="سجل الحركات"
        subtitle="كل حركة مسجلة بالتاريخ والوقت والمنفّذ. السجل للقراءة فقط ولا يمكن تعديله أو حذفه."
        actions={
          <Button variant="secondary" onClick={() => window.print()}>
            طباعة
          </Button>
        }
      />
      <Card className="no-print mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="الباركود / الرقم التسلسلي">
            <Input dir="ltr" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <Field label="نوع الحركة">
            <Select value={flt.type ?? ''} onChange={(e) => set('type', e.target.value)}>
              <option value="">الكل</option>
              {MOVEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MOVEMENT_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="اللون">
            <Select value={flt.color ?? ''} onChange={(e) => setFlt((f) => ({ ...f, color: (e.target.value || undefined) as StockColor | undefined }))}>
              <option value="">الكل</option>
              {COLORS.map((c) => (
                <option key={c} value={c}>
                  {COLOR_META[c].label}
                </option>
              ))}
            </Select>
          </Field>
          <DriverSelect value={flt.driverId ?? ''} onChange={(id) => set('driverId', id)} includeInactive />
          {!scoped && <PointSelect value={flt.pointId ?? ''} onChange={(v) => set('pointId', v)} allowAll locked={false} activeOnly={false} />}
          <Field label="من تاريخ">
            <Input type="date" value={flt.from ?? ''} onChange={(e) => set('from', e.target.value)} />
          </Field>
          <Field label="إلى تاريخ">
            <Input type="date" value={flt.to ?? ''} onChange={(e) => set('to', e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button
              variant="ghost"
              onClick={() => {
                setFlt({});
                setQ('');
              }}
            >
              مسح الفلاتر
            </Button>
          </div>
        </div>
        {flt.productId && (
          <p className="mt-2 text-sm">
            مفلتر على منتج محدد.{' '}
            <button className="font-bold text-blue-700 underline" onClick={() => set('productId', '')}>
              إزالة
            </button>
          </p>
        )}
      </Card>
      <MovementsList filter={{ ...flt, q: dq || undefined }} pageSize={50} refreshMs={30_000} />
    </>
  );
}
