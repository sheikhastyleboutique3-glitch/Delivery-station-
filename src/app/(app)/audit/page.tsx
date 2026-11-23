'use client';

import { useState } from 'react';
import { COLOR_META, ROLE_LABELS, type Role, type StockColor } from '@/lib/domain';
import { apiGet, qs, type ApiError } from '@/lib/client/api';
import { useApi } from '@/lib/client/hooks';
import type { Paged } from '@/lib/client/types';
import { useApp } from '@/components/providers';
import { Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Pagination, Table, Td, Th } from '@/components/ui';

interface AuditRow {
  id: number;
  action: string;
  entityType: string;
  entityId: string;
  ip: string | null;
  hash: string;
  createdAt: string;
  user: { name: string; role: Role } | null;
  after: unknown;
}

interface Verify {
  ok: boolean;
  checked: number;
  brokenAtId: number | null;
  reason: string | null;
}

interface Reconcile {
  ok: boolean;
  checkedAt: string;
  balanceRows: number;
  custodyRows: number;
  mismatches: { kind: string; productName: string; pointName: string; color: StockColor | null; driverId: string | null; expected: number; actual: number }[];
}

const KIND: Record<string, string> = { balance: 'رصيد لوني', custody: 'عهدة سائق', units: 'عدد القطع' };

export default function AuditPage() {
  const { f, toast } = useApp();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const { data, error, loading, reload } = useApi<Paged<AuditRow>>(`/api/audit${qs({ page, action })}`);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [rec, setRec] = useState<Reconcile | null>(null);
  const [busy, setBusy] = useState<'verify' | 'rec' | null>(null);

  async function run<T>(kind: 'verify' | 'rec', url: string, set: (v: T) => void) {
    setBusy(kind);
    try {
      set(await apiGet<T>(url));
    } catch (err) {
      toast((err as ApiError).messageAr, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="التدقيق والتطابق" subtitle="سجل تدقيق غير قابل للتعديل + فحص تطابق الأرصدة مع سجل الحركات" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="سلامة سجل التدقيق" actions={<Button onClick={() => run<Verify>('verify', '/api/audit/verify', setVerify)} loading={busy === 'verify'}>فحص السلسلة</Button>}>
          <p className="text-sm text-slate-600">كل سجل مربوط ببصمة SHA-256 للسجل الذي قبله. أي تعديل أو حذف مباشر في قاعدة البيانات يكسر السلسلة ويظهر هنا.</p>
          {verify && (
            <p className={`mt-3 rounded-xl p-3 text-sm font-bold ${verify.ok ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'}`}>
              {verify.ok ? `السلسلة سليمة (${f.n(verify.checked)} سجل)` : `تحذير: ${verify.reason} — عند السجل رقم ${verify.brokenAtId}`}
            </p>
          )}
        </Card>
        <Card title="تطابق الأرصدة (Reconcile)" actions={<Button onClick={() => run<Reconcile>('rec', '/api/reconcile', setRec)} loading={busy === 'rec'}>فحص التطابق</Button>}>
          <p className="text-sm text-slate-600">يعيد حساب كل رصيد لوني وكل عهدة سائق من سجل الحركات ويقارنه بالأرصدة المخزنة.</p>
          {rec && (
            <div className="mt-3">
              <p className={`rounded-xl p-3 text-sm font-bold ${rec.ok ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'}`}>
                {rec.ok
                  ? `كل الأرصدة مطابقة (${f.n(rec.balanceRows)} رصيد، ${f.n(rec.custodyRows)} عهدة)`
                  : `يوجد ${f.n(rec.mismatches.length)} فرق`}
              </p>
              {rec.mismatches.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {rec.mismatches.map((m, i) => (
                    <li key={i} className="rounded-lg bg-red-50 p-2">
                      {KIND[m.kind]}: {m.productName} · {m.pointName} · {m.color ? COLOR_META[m.color].label : ''} — المتوقع {f.n(m.expected)} والمخزن {f.n(m.actual)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card title="سجل التدقيق" className="mt-4">
        <Field label="بحث في نوع الإجراء" className="no-print mb-3 max-w-sm">
          <Input dir="ltr" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="operation.dispatch, user.update…" />
        </Field>
        {loading && !data && <Loading />}
        <ErrorBox error={error} onRetry={reload} />
        {data && (
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>الوقت</Th>
                <Th>المستخدم</Th>
                <Th>الإجراء</Th>
                <Th>العنصر</Th>
                <Th>IP</Th>
                <Th>البصمة</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <Td className="ltr font-mono text-xs">{r.id}</Td>
                  <Td className="whitespace-nowrap text-xs">{f.dateTime(r.createdAt)}</Td>
                  <Td className="text-xs">
                    {r.user?.name ?? '—'}
                    {r.user && <span className="block text-slate-500">{ROLE_LABELS[r.user.role]}</span>}
                  </Td>
                  <Td className="ltr font-mono text-xs">{r.action}</Td>
                  <Td className="ltr font-mono text-[11px] text-slate-500">
                    {r.entityType}:{r.entityId.slice(0, 10)}
                  </Td>
                  <Td className="ltr font-mono text-[11px]">{r.ip}</Td>
                  <Td className="ltr font-mono text-[11px] text-slate-400">{r.hash.slice(0, 12)}…</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
