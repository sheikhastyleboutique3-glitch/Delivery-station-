'use client';

import { useEffect } from 'react';
import { DRIVER_STATUS_LABELS } from '@/lib/domain';
import { qs } from '@/lib/client/api';
import { useApi } from '@/lib/client/hooks';
import type { Driver, Paged, Point } from '@/lib/client/types';
import { useApp } from './providers';
import { Field, Select } from './ui';

export function usePoints() {
  return useApi<Point[]>('/api/points');
}

/** المستخدم المقيّد بنقطة لا يستطيع تغييرها؛ المدير يختار أي نقطة */
export function PointSelect({
  value,
  onChange,
  label = 'نقطة الدليفري',
  allowAll,
  locked,
  activeOnly = true,
  emptyLabel = 'كل النقاط',
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  allowAll?: boolean;
  locked?: boolean;
  activeOnly?: boolean;
  emptyLabel?: string;
}) {
  const { user } = useApp();
  const { data } = usePoints();
  const scoped = !!user.deliveryPointId && user.role !== 'ADMIN';
  const isLocked = locked ?? scoped;
  const points = (data ?? []).filter((p) => !activeOnly || p.isActive);

  useEffect(() => {
    if (!value && !allowAll) {
      if (scoped && user.deliveryPointId) onChange(user.deliveryPointId);
      else if (points.length) onChange((points.find((p) => p.type === 'WAREHOUSE') ?? points[0]).id);
    }
  }, [value, allowAll, scoped, user.deliveryPointId, points, onChange]);

  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={isLocked && !!value}>
        {allowAll && <option value="">{emptyLabel}</option>}
        {!allowAll && !value && <option value="">اختر…</option>}
        {points.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} {p.type === 'WAREHOUSE' ? '(مستودع)' : ''}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function DriverSelect({
  value,
  onChange,
  pointId,
  label = 'السائق',
  includeInactive,
}: {
  value: string;
  onChange: (id: string, driver: Driver | null) => void;
  pointId?: string;
  label?: string;
  includeInactive?: boolean;
}) {
  const { f } = useApp();
  const { data } = useApi<Paged<Driver>>(`/api/drivers${qs({ pointId, pageSize: 200 })}`);
  const drivers = (data?.items ?? []).filter((d) => includeInactive || d.status !== 'INACTIVE');
  return (
    <Field label={label}>
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value, drivers.find((d) => d.id === e.target.value) ?? null)}
      >
        <option value="">اختر السائق…</option>
        {drivers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.fullName} — {DRIVER_STATUS_LABELS[d.status]}
            {d.custodyTotal ? ` (عهدة ${f.n(d.custodyTotal)})` : ''}
          </option>
        ))}
      </Select>
    </Field>
  );
}
