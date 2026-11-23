'use client';

import { useState } from 'react';
import { qs } from '@/lib/client/api';
import { useApi } from '@/lib/client/hooks';
import { DriverSelect, PointSelect } from '@/components/pickers';
import { useApp } from '@/components/providers';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, PageHeader, Select, Table, Td, Th } from '@/components/ui';

const KINDS = [
  { key: 'movements', label: 'حركة المستودع حسب الفترة', range: true },
  { key: 'custody', label: 'عهدة كل السائقين الآن', range: false },
  { key: 'drivers', label: 'أداء السائقين (مسلّم ومرتجع)', range: true },
  { key: 'returns', label: 'المرتجعات والتالف', range: true },
  { key: 'inventory', label: 'الجرد حسب اللون', range: false },
  { key: 'payroll', label: 'الرواتب ومستحقات التوصيل (مدير)', range: true },
  { key: 'attendance', label: 'الحضور اليومي (مدير)', range: true },
] as const;

interface Report {
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
}

function today(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const { user, f } = useApp();
  const [kind, setKind] = useState<(typeof KINDS)[number]['key']>('movements');
  const [from, setFrom] = useState(today(-7));
  const [to, setTo] = useState(today());
  const [pointId, setPointId] = useState('');
  const [driverId, setDriverId] = useState('');
  const meta = KINDS.find((k) => k.key === kind)!;
  const params = { from: meta.range ? from : undefined, to: meta.range ? to : undefined, pointId: pointId || undefined, driverId: driverId || undefined };
  const { data, error, loading, reload } = useApi<Report>(`/api/reports/${kind}${qs(params)}`);
  const scoped = user.role !== 'ADMIN' && !!user.deliveryPointId;
  const download = (format: 'csv' | 'xlsx') => {
    window.location.href = `/api/reports/${kind}${qs({ ...params, format })}`;
  };

  return (
    <>
      <PageHeader
        title="التقارير"
        actions={
          <>
            <Button variant="secondary" onClick={() => download('csv')}>
              تصدير CSV
            </Button>
            <Button variant="secondary" onClick={() => download('xlsx')}>
              تصدير Excel
            </Button>
            <Button onClick={() => window.print()}>طباعة</Button>
          </>
        }
      />
      <Card className="no-print mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="التقرير" className="lg:col-span-2">
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {KINDS.filter((k) => user.role === 'ADMIN' || (k.key !== 'payroll' && k.key !== 'attendance')).map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
          {meta.range && (
            <>
              <Field label="من">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="إلى">
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </>
          )}
          {!scoped && <PointSelect value={pointId} onChange={setPointId} allowAll locked={false} activeOnly={false} />}
          {(kind === 'movements' || kind === 'custody' || kind === 'returns') && <DriverSelect value={driverId} onChange={(id) => setDriverId(id)} includeInactive label="السائق (اختياري)" />}
        </div>
      </Card>
      <h2 className="mb-2 hidden text-lg font-bold print:block">
        {data?.title} {meta.range ? `(${from} — ${to})` : ''}
      </h2>
      {loading && !data && <Loading />}
      <ErrorBox error={error} onRetry={reload} />
      {data && data.rows.length === 0 && <EmptyState title="لا توجد بيانات لهذه الفترة" />}
      {data && data.rows.length > 0 && (
        <>
          <p className="no-print mb-2 text-sm text-slate-500">{f.n(data.rows.length)} صف</p>
          <Table className="print:overflow-visible">
            <thead>
              <tr>
                {data.columns.map((c) => (
                  <Th key={c.key}>{c.label}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.slice(0, 1000).map((r, i) => (
                <tr key={i}>
                  {data.columns.map((c) => (
                    <Td key={c.key} className="text-xs">
                      {typeof r[c.key] === 'number' ? f.n(r[c.key] as number) : r[c.key]}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
          {data.rows.length > 1000 && <p className="mt-2 text-sm text-slate-500">يُعرض أول 1000 صف. صدّر الملف للحصول على كل الصفوف.</p>}
        </>
      )}
    </>
  );
}
