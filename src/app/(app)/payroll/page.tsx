'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  COMMISSION_MODES,
  COMMISSION_MODE_LABELS,
  EMPLOYEE_JOB_LABELS,
  PAYOUT_STATUSES,
  PAYOUT_STATUS_LABELS,
  PAY_TYPE_LABELS,
  type CommissionMode,
} from '@/lib/domain';
import { apiSend, qs, type ApiError } from '@/lib/client/api';
import { useApi } from '@/lib/client/hooks';
import type { DeliveryRateRow, Employee, Paged, PayoutCalcView, PayoutRow } from '@/lib/client/types';
import { CalcBreakdown, PayoutDetailModal, PayoutStatusBadge, QuickCalculator } from '@/components/hr/payroll';
import { Icon } from '@/components/icons';
import { PointSelect } from '@/components/pickers';
import { useApp } from '@/components/providers';
import { Button, Card, EmptyState, ErrorBox, Field, Input, LinkButton, Loading, Modal, PageHeader, Pagination, Select, Table, Tabs, Td, Th } from '@/components/ui';

type Tab = 'sheets' | 'calculator' | 'rates';

function monthOf(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

export default function PayrollPage() {
  const [tab, setTab] = useState<Tab>('sheets');
  return (
    <>
      <PageHeader
        title="الرواتب ومستحقات التوصيل"
        subtitle="عمولة بالقطعة أو بالطرد، راتب شهري أو أيام عمل، أو هجين — بالدينار الجزائري"
        actions={<LinkButton href="/reports">تصدير Excel / CSV</LinkButton>}
      />
      <Tabs
        tabs={[
          { key: 'sheets', label: 'كشوف الفترة' },
          { key: 'calculator', label: 'حاسبة المستحقات' },
          { key: 'rates', label: 'أسعار التوصيل' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'sheets' && <Sheets />}
      {tab === 'calculator' && <Calculator />}
      {tab === 'rates' && <Rates />}
    </>
  );
}

// ─── كشوف الفترة ────────────────────────────────────────────────

function Sheets() {
  const { f, toast } = useApp();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ created: string[]; skipped: { employee: string; reason: string }[] } | null>(null);
  const range = monthOf(month);
  const { data, error, loading, reload } = useApi<Paged<PayoutRow> & { totals: { net: string; paid: string; remaining: string; commission: string; base: string; deliveredUnits: number } }>(
    `/api/payroll${qs({ ...range, status, page, pageSize: 50 })}`,
  );

  async function bulk() {
    if (!window.confirm(`إنشاء كشوف ${month} لكل الموظفين النشطين؟ من له كشف في نفس الفترة يُتخطى.`)) return;
    setBusy(true);
    try {
      const r = await apiSend<{ created: string[]; skipped: { employee: string; reason: string }[] }>('POST', '/api/payroll/bulk', range);
      setBulkResult(r);
      toast(`تم إنشاء ${r.created.length} كشف`);
      reload();
    } catch (err) {
      toast((err as ApiError).messageAr, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="الشهر">
            <Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPage(1); }} />
          </Field>
          <Field label="حالة الدفع">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">الكل</option>
              {PAYOUT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PAYOUT_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={bulk} loading={busy}>
            إنشاء كشوف الشهر لكل الموظفين
          </Button>
        </div>
      </Card>

      {data && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            ['أجر الأيام', f.money(data.totals.base), 'bg-slate-50'],
            ['عمولات التوصيل', f.money(data.totals.commission), 'bg-green-50 text-green-900'],
            ['إجمالي الصافي', f.money(data.totals.net), 'bg-slate-900 text-white'],
            ['المدفوع', f.money(data.totals.paid), 'bg-green-100 text-green-900'],
            ['المتبقي', f.money(data.totals.remaining), 'bg-amber-100 text-amber-900'],
          ].map(([l, v, cls]) => (
            <div key={l} className={`rounded-2xl p-3 ${cls}`}>
              <p className="text-xs opacity-80">{l}</p>
              <p className="text-lg font-black tabular-nums">{v}</p>
            </div>
          ))}
        </div>
      )}

      {loading && !data && <Loading />}
      <ErrorBox error={error} onRetry={reload} />
      {data && data.items.length === 0 && <EmptyState title="لا توجد كشوف لهذه الفترة" hint="أنشئ الكشوف لكل الموظفين بزر واحد، أو من ملف كل موظف" />}
      {data && data.items.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>الكشف</Th>
              <Th>الموظف</Th>
              <Th>نظام الدفع</Th>
              <Th>أيام العمل</Th>
              <Th>قطع / طرود</Th>
              <Th>أجر الأيام</Th>
              <Th>العمولة</Th>
              <Th>الصافي</Th>
              <Th>المدفوع</Th>
              <Th>المتبقي</Th>
              <Th>الحالة</Th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(p.id)}>
                <Td className="ltr font-mono text-xs font-bold">{p.payoutNo}</Td>
                <Td>
                  <Link href={`/employees/${p.employee.id}?tab=pay`} onClick={(e) => e.stopPropagation()} className="font-semibold hover:underline">
                    {p.employee.fullName}
                  </Link>
                  <span className="block text-xs text-slate-500">{EMPLOYEE_JOB_LABELS[p.employee.jobType]}</span>
                </Td>
                <Td className="text-xs">{PAY_TYPE_LABELS[p.payType]}</Td>
                <Td className="tabular-nums">{f.n(p.workedDays)}</Td>
                <Td className="tabular-nums">
                  {f.n(p.deliveredUnits)} / {f.n(p.deliveredColis)}
                </Td>
                <Td className="tabular-nums">{f.money(p.baseAmount)}</Td>
                <Td className="tabular-nums">{f.money(p.commissionAmount)}</Td>
                <Td className="font-bold tabular-nums">{f.money(p.netAmount)}</Td>
                <Td className="tabular-nums">{f.money(p.paidAmount)}</Td>
                <Td className="tabular-nums">{f.money(p.remainingAmount)}</Td>
                <Td>
                  <PayoutStatusBadge status={p.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}

      {open && <PayoutDetailModal id={open} onClose={() => setOpen(null)} onChanged={reload} />}
      <Modal open={!!bulkResult} onClose={() => setBulkResult(null)} title="نتيجة إنشاء الكشوف">
        {bulkResult && (
          <div className="space-y-3 text-sm">
            <p className="rounded-xl bg-green-50 p-3 font-bold text-green-900">أُنشئ {f.n(bulkResult.created.length)} كشف</p>
            {bulkResult.skipped.length > 0 && (
              <div>
                <p className="mb-1 font-bold">تم تخطي {f.n(bulkResult.skipped.length)}:</p>
                <ul className="space-y-1">
                  {bulkResult.skipped.map((s, i) => (
                    <li key={i} className="rounded-lg bg-slate-50 p-2">
                      {s.employee}: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

// ─── حاسبة المستحقات ────────────────────────────────────────────

function Calculator() {
  const { toast } = useApp();
  const [employeeId, setEmployeeId] = useState('');
  const [range, setRange] = useState(monthOf(new Date().toISOString().slice(0, 7)));
  const [bonus, setBonus] = useState('0');
  const [deduction, setDeduction] = useState('0');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { data: emps } = useApi<Paged<Employee>>(`/api/employees${qs({ pageSize: 200 })}`);
  const { data: calc, error, reload } = useApi<PayoutCalcView>(employeeId ? `/api/payroll/preview${qs({ employeeId, ...range })}` : null);

  async function save() {
    setBusy(true);
    try {
      const p = await apiSend<PayoutRow>('POST', '/api/payroll', {
        employeeId,
        ...range,
        bonusAmount: Number(bonus) || 0,
        deductionAmount: Number(deduction) || 0,
      });
      toast(`تم إنشاء الكشف ${p.payoutNo}`);
      reload();
      setOpen(p.id);
    } catch (err) {
      toast((err as ApiError).messageAr, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="حساب مستحقات موظف من بياناته الفعلية">
          <div className="space-y-3">
            <Field label="الموظف">
              <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">اختر…</option>
                {emps?.items.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName} — {PAY_TYPE_LABELS[e.payType]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="من">
                <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
              </Field>
              <Field label="إلى">
                <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
              </Field>
              <Field label="مكافأة">
                <Input dir="ltr" type="number" min="0" value={bonus} onChange={(e) => setBonus(e.target.value)} />
              </Field>
              <Field label="خصم / سلفة">
                <Input dir="ltr" type="number" min="0" value={deduction} onChange={(e) => setDeduction(e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>
        <Card title="النتيجة">
          {!employeeId && <p className="text-sm text-slate-500">اختر موظفاً لعرض أيام عمله وعدد ما سلّمه وحساب مستحقاته.</p>}
          <ErrorBox error={error} />
          {calc && (
            <>
              <CalcBreakdown c={calc} bonus={Number(bonus) || 0} deduction={Number(deduction) || 0} />
              {calc.overlapping ? (
                <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                  يوجد كشف {calc.overlapping.payoutNo} يغطي جزءاً من هذه الفترة.{' '}
                  <button className="font-bold underline" onClick={() => setOpen(calc.overlapping!.id)}>
                    افتحه
                  </button>
                </p>
              ) : (
                <Button className="mt-3 w-full" onClick={save} loading={busy}>
                  حفظ ككشف مستحقات
                </Button>
              )}
            </>
          )}
        </Card>
      </div>
      <QuickCalculator />
      {open && <PayoutDetailModal id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

// ─── أسعار التوصيل ──────────────────────────────────────────────

function Rates() {
  const { f, settings, toast } = useApp();
  const { data, reload } = useApi<DeliveryRateRow[]>('/api/delivery-rates');
  const { data: emps } = useApi<Paged<Employee>>(`/api/employees${qs({ pageSize: 200, status: 'ACTIVE' })}`);
  const [form, setForm] = useState<{ mode: CommissionMode; amount: string; employeeId: string; category: string; deliveryPointId: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      await apiSend('POST', '/api/delivery-rates', {
        ...form,
        amount: Number(form.amount),
        employeeId: form.employeeId || null,
        category: form.category || null,
        deliveryPointId: form.deliveryPointId || null,
        label: form.label || null,
      });
      toast('تم حفظ السعر');
      setForm(null);
      reload();
    } catch (err) {
      toast((err as ApiError).messageAr, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: DeliveryRateRow) {
    if (!window.confirm('إيقاف هذا السعر؟ التسليمات السابقة تبقى بسعرها المسجل.')) return;
    try {
      await apiSend('DELETE', `/api/delivery-rates/${r.id}`);
      toast('تم إيقاف السعر');
      reload();
    } catch (err) {
      toast((err as ApiError).messageAr, 'error');
    }
  }

  return (
    <div className="space-y-4">
      <Card title="الأسعار الافتراضية" actions={<LinkButton href="/settings">تعديل من الإعدادات</LinkButton>}>
        <div className="grid gap-2 sm:grid-cols-2">
          <p className="rounded-xl bg-green-50 p-3 text-sm text-green-900">
            لكل قطعة مسلّمة: <b className="text-lg">{f.money(settings.defaultRatePerUnit)}</b>
          </p>
          <p className="rounded-xl bg-green-50 p-3 text-sm text-green-900">
            لكل طرد / طلب مكتمل: <b className="text-lg">{f.money(settings.defaultRatePerColis)}</b>
          </p>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          ترتيب الأولوية عند التسليم: سعر خاص بالسائق ← سعر فئة المنتج ← سعر نقطة الدليفري ← السعر الافتراضي. السعر يُحفظ مع كل تسليم، فتغييره لاحقاً لا يغيّر
          المستحقات السابقة.
        </p>
      </Card>

      <Card
        title="أسعار خاصة"
        actions={
          <Button onClick={() => setForm({ mode: 'PER_UNIT', amount: String(settings.defaultRatePerUnit), employeeId: '', category: '', deliveryPointId: '', label: '' })}>
            <Icon name="plus" /> سعر خاص
          </Button>
        }
      >
        {!data || data.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد أسعار خاصة. كل التسليمات تُحسب بالسعر الافتراضي.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>الاحتساب</Th>
                <Th>السعر</Th>
                <Th>السائق</Th>
                <Th>فئة المنتج</Th>
                <Th>نقطة الدليفري</Th>
                <Th>وصف</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <Td className="text-xs">{COMMISSION_MODE_LABELS[r.mode]}</Td>
                  <Td className="font-bold tabular-nums">{f.money(r.amount)}</Td>
                  <Td>{r.employee?.fullName ?? '—'}</Td>
                  <Td>{r.category ?? '—'}</Td>
                  <Td>{r.deliveryPoint?.name ?? '—'}</Td>
                  <Td className="text-xs">{r.label}</Td>
                  <Td>
                    <Button size="sm" variant="ghost" onClick={() => remove(r)}>
                      إيقاف
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="سعر توصيل خاص"
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              إلغاء
            </Button>
            <Button onClick={save} loading={busy} disabled={!form || !(Number(form.amount) > 0) || (!form.employeeId && !form.category && !form.deliveryPointId)}>
              حفظ
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-3">
            <Field label="الاحتساب">
              <Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as CommissionMode })}>
                {COMMISSION_MODES.map((m) => (
                  <option key={m} value={m}>
                    {COMMISSION_MODE_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`السعر (${f.currencySymbol})`}>
              <Input dir="ltr" type="number" min="1" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <p className="text-xs font-bold text-slate-600">ينطبق على (اختر واحداً أو أكثر):</p>
            <Field label="سائق معيّن">
              <Select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                <option value="">كل السائقين</option>
                {emps?.items
                  .filter((e) => e.jobType === 'DRIVER')
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.fullName}
                    </option>
                  ))}
              </Select>
            </Field>
            {form.mode === 'PER_UNIT' && (
              <Field label="فئة المنتج" hint="مطابقة لاسم الفئة في شاشة المنتجات">
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="مثال: أجهزة منزلية" />
              </Field>
            )}
            <PointSelect value={form.deliveryPointId} onChange={(v) => setForm({ ...form, deliveryPointId: v })} label="نقطة الدليفري / المنطقة" allowAll emptyLabel="كل النقاط" locked={false} />
            <Field label="وصف (اختياري)">
              <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="مثال: سعر المنطقة البعيدة" />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
