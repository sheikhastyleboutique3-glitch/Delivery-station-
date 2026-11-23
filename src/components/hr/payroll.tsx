'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  COMMISSION_MODE_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYOUT_STATUS_LABELS,
  PAY_TYPE_LABELS,
  type PaymentMethod,
  type PayoutStatus,
} from '@/lib/domain';
import { apiSend, newIdempotencyKey, type ApiError } from '@/lib/client/api';
import { useApi } from '@/lib/client/hooks';
import type { PayoutCalcView, PayoutRow } from '@/lib/client/types';
import { Icon } from '../icons';
import { useApp } from '../providers';
import { Badge, Button, Card, Field, Input, Loading, Modal, Select, Table, Td, Th } from '../ui';

export const PAYOUT_STATUS_STYLE: Record<PayoutStatus, string> = {
  PENDING: 'border-amber-300 bg-amber-100 text-amber-900',
  PARTIAL: 'border-blue-300 bg-blue-100 text-blue-900',
  PAID: 'border-green-300 bg-green-100 text-green-900',
};

export function PayoutStatusBadge({ status }: { status: PayoutStatus }) {
  return <Badge className={PAYOUT_STATUS_STYLE[status]}>{PAYOUT_STATUS_LABELS[status]}</Badge>;
}

/** تفصيل الحساب بنفس الصيغة التي يستخدمها الخادم، ليفهم المستخدم من أين جاء كل رقم */
export function CalcBreakdown({ c, bonus = 0, deduction = 0 }: { c: PayoutCalcView | PayoutRow; bonus?: number; deduction?: number }) {
  const { f } = useApp();
  const isRow = 'netAmount' in c;
  const base = Number(c.baseAmount);
  const commission = Number(c.commissionAmount);
  const b = isRow ? Number((c as PayoutRow).bonusAmount) : bonus;
  const d = isRow ? Number((c as PayoutRow).deductionAmount) : deduction;
  const net = isRow ? Number((c as PayoutRow).netAmount) : base + commission + b - d;
  const breakdown = 'earningsBreakdown' in c ? c.earningsBreakdown : null;
  const hasBase = c.payType !== 'PER_DELIVERY';
  const hasCommission = c.payType !== 'MONTHLY_OR_DAILY' || commission > 0;

  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-slate-500">نظام الدفع: {PAY_TYPE_LABELS[c.payType]}</p>
      {hasBase && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
          <span>
            أجر الأيام: <b className="tabular-nums">{f.n(c.workedDays)}</b> يوم عمل ×{' '}
            {'dailyRateIsCustom' in c && !c.dailyRateIsCustom ? (
              <>
                ({f.money(c.monthlySalary)} ÷ {f.n(c.standardDays)})
              </>
            ) : (
              <>{f.money(c.dailyRate)}</>
            )}
          </span>
          <b className="tabular-nums">{f.money(base)}</b>
        </div>
      )}
      {hasCommission && (
        <div className="rounded-xl bg-green-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              عمولة التوصيل: {f.n(c.deliveredUnits)} قطعة في {f.n(c.deliveredColis)} طرد
            </span>
            <b className="tabular-nums">{f.money(commission)}</b>
          </div>
          {breakdown && breakdown.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-green-900">
              {breakdown.map((g, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {f.n(g.quantity)} {g.mode === 'PER_COLIS' ? 'طرد' : 'قطعة'} × {f.money(g.rate)} <span className="text-green-700">({g.rateSource})</span>
                  </span>
                  <span className="tabular-nums">{f.money(g.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {(b > 0 || d > 0) && (
        <div className="flex flex-wrap justify-between gap-2 rounded-xl bg-slate-50 p-3">
          <span>
            مكافأة {f.money(b)} − خصم {f.money(d)}
          </span>
          <b className="tabular-nums">{f.money(b - d)}</b>
        </div>
      )}
      <div className="flex items-center justify-between rounded-xl bg-slate-900 p-3 text-white">
        <span className="font-bold">صافي المستحق</span>
        <b className="text-lg tabular-nums">{f.money(net)}</b>
      </div>
    </div>
  );
}

export function PayoutDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { f, toast } = useApp();
  const { data: p, loading, reload } = useApi<PayoutRow>(`/api/payroll/${id}`);
  const payKey = useRef(newIdempotencyKey());
  const [pay, setPay] = useState<{ amount: string; method: PaymentMethod; reference: string; note: string; paidAt: string } | null>(null);
  const [adj, setAdj] = useState<{ bonusAmount: string; deductionAmount: string; notes: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const done = () => {
    reload();
    onChanged();
  };

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      done();
      return true;
    } catch (err) {
      toast((err as ApiError).messageAr, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitPayment() {
    if (!pay) return;
    const ok = await run(
      () =>
        apiSend('POST', `/api/payroll/${id}/payments`, {
          idempotencyKey: payKey.current,
          amount: Number(pay.amount),
          method: pay.method,
          reference: pay.reference || null,
          note: pay.note || null,
          paidAt: pay.paidAt ? new Date(pay.paidAt).toISOString() : null,
        }),
      'تم تسجيل الدفعة',
    );
    if (ok) {
      payKey.current = newIdempotencyKey();
      setPay(null);
    }
  }

  return (
    <Modal open onClose={onClose} wide title={p ? `كشف ${p.payoutNo} — ${p.employee.fullName}` : 'كشف المستحقات'}>
      {loading && !p && <Loading />}
      {p && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              الفترة: <b>{f.ymd(p.periodStart)}</b> ← <b>{f.ymd(p.periodEnd)}</b>
            </span>
            <PayoutStatusBadge status={p.status} />
          </div>
          <CalcBreakdown c={p} />
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 p-2">
              <p className="text-xs text-slate-500">الصافي</p>
              <p className="font-black tabular-nums">{f.money(p.netAmount)}</p>
            </div>
            <div className="rounded-xl bg-green-50 p-2">
              <p className="text-xs text-green-800">المدفوع</p>
              <p className="font-black tabular-nums text-green-900">{f.money(p.paidAmount)}</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-2">
              <p className="text-xs text-amber-800">المتبقي</p>
              <p className="font-black tabular-nums text-amber-900">{f.money(p.remainingAmount)}</p>
            </div>
          </div>
          {p.notes && <p className="rounded-xl bg-slate-50 p-3 text-sm">ملاحظات: {p.notes}</p>}

          <div className="no-print flex flex-wrap gap-2">
            {Number(p.remainingAmount) > 0 && (
              <Button
                variant="success"
                onClick={() => setPay({ amount: p.remainingAmount, method: 'CASH', reference: '', note: '', paidAt: new Date().toISOString().slice(0, 16) })}
              >
                <Icon name="wallet" /> تسجيل دفعة
              </Button>
            )}
            <Button variant="secondary" onClick={() => setAdj({ bonusAmount: p.bonusAmount, deductionAmount: p.deductionAmount, notes: p.notes ?? '' })}>
              مكافأة / خصم
            </Button>
            <Button variant="secondary" loading={busy} onClick={() => run(() => apiSend('PATCH', `/api/payroll/${id}`, {}), 'تمت إعادة الحساب')}>
              إعادة الحساب
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              <Icon name="print" /> طباعة
            </Button>
            {Number(p.paidAmount) === 0 && (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (!window.confirm('حذف هذا الكشف؟ ستعود عمولاته متاحة لكشف جديد.')) return;
                  if (await run(() => apiSend('DELETE', `/api/payroll/${id}`), 'تم حذف الكشف')) onClose();
                }}
              >
                <Icon name="trash" className="h-4 w-4 text-red-600" /> حذف
              </Button>
            )}
          </div>

          <Card title={`الدفعات (${f.n(p.payments.length)})`}>
            {p.payments.length === 0 ? (
              <p className="text-sm text-slate-500">لا توجد دفعات بعد.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {p.payments.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <b className="tabular-nums">{f.money(x.amount)}</b> · {PAYMENT_METHOD_LABELS[x.method]}
                      {x.reference && <span className="ltr"> · {x.reference}</span>}
                      <span className="block text-xs text-slate-500">
                        {f.dateTime(x.paidAt)} · {x.createdBy?.name} {x.note ? `· ${x.note}` : ''}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (window.confirm('حذف هذه الدفعة؟ يُسجَّل الحذف في سجل التدقيق.')) await run(() => apiSend('DELETE', `/api/payroll/payments/${x.id}`), 'تم حذف الدفعة');
                      }}
                    >
                      حذف
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {p.earnings && p.earnings.length > 0 && (
            <Card title={`عمولات التوصيل المدرجة (${f.n(p.earnings.length)})`}>
              <Table>
                <thead>
                  <tr>
                    <Th>التاريخ</Th>
                    <Th>السند</Th>
                    <Th>الاحتساب</Th>
                    <Th>العدد</Th>
                    <Th>السعر وقت التسليم</Th>
                    <Th>المبلغ</Th>
                  </tr>
                </thead>
                <tbody>
                  {p.earnings.map((e) => (
                    <tr key={e.id}>
                      <Td className="whitespace-nowrap text-xs">{f.ymd(e.date)}</Td>
                      <Td>
                        <Link href={`/ops/${e.operation.id}`} className="ltr font-mono text-xs font-bold text-blue-700 underline">
                          {e.operation.opNo}
                        </Link>
                      </Td>
                      <Td className="text-xs">
                        {COMMISSION_MODE_LABELS[e.mode]}
                        {e.category ? ` · ${e.category}` : ''}
                      </Td>
                      <Td className="tabular-nums">{f.n(e.quantity)}</Td>
                      <Td className="tabular-nums">{f.money(e.rate)}</Td>
                      <Td className="font-bold tabular-nums">{f.money(e.amount)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      )}

      <Modal
        open={!!pay}
        onClose={() => setPay(null)}
        title="تسجيل دفعة"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPay(null)}>
              إلغاء
            </Button>
            <Button variant="success" onClick={submitPayment} loading={busy} disabled={!pay || !(Number(pay.amount) > 0)}>
              تأكيد الدفع
            </Button>
          </>
        }
      >
        {pay && p && (
          <div className="space-y-3">
            <Field label={`المبلغ (${f.currencySymbol}) — المتبقي ${f.money(p.remainingAmount)}`}>
              <Input dir="ltr" type="number" step="0.01" min="0.01" max={p.remainingAmount} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
            </Field>
            <Field label="طريقة الدفع">
              <Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as PaymentMethod })}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="مرجع (رقم التحويل أو الوصل)">
              <Input dir="ltr" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
            </Field>
            <Field label="تاريخ ووقت الدفع">
              <Input type="datetime-local" value={pay.paidAt} onChange={(e) => setPay({ ...pay, paidAt: e.target.value })} />
            </Field>
            <Field label="ملاحظة">
              <Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!adj}
        onClose={() => setAdj(null)}
        title="مكافأة / خصم"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdj(null)}>
              إلغاء
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                if (!adj) return;
                const ok = await run(
                  () => apiSend('PATCH', `/api/payroll/${id}`, { bonusAmount: Number(adj.bonusAmount) || 0, deductionAmount: Number(adj.deductionAmount) || 0, notes: adj.notes || null }),
                  'تم الحفظ وإعادة الحساب',
                );
                if (ok) setAdj(null);
              }}
            >
              حفظ
            </Button>
          </>
        }
      >
        {adj && (
          <div className="space-y-3">
            <Field label={`مكافأة (${f.currencySymbol})`}>
              <Input dir="ltr" type="number" min="0" step="0.01" value={adj.bonusAmount} onChange={(e) => setAdj({ ...adj, bonusAmount: e.target.value })} />
            </Field>
            <Field label={`خصم / سلفة (${f.currencySymbol})`}>
              <Input dir="ltr" type="number" min="0" step="0.01" value={adj.deductionAmount} onChange={(e) => setAdj({ ...adj, deductionAmount: e.target.value })} />
            </Field>
            <Field label="سبب / ملاحظات">
              <Input value={adj.notes} onChange={(e) => setAdj({ ...adj, notes: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </Modal>
  );
}

/** حاسبة سريعة بالدينار: عدد القطع/الطرود × السعر + أيام العمل × أجر اليوم */
export function QuickCalculator() {
  const { f, settings } = useApp();
  const [units, setUnits] = useState('100');
  const [rate, setRate] = useState(String(settings.defaultRatePerUnit));
  const [days, setDays] = useState('0');
  const [monthly, setMonthly] = useState('0');
  const [std, setStd] = useState(String(settings.standardWorkDays));
  const commission = (Number(units) || 0) * (Number(rate) || 0);
  const dayRate = (Number(monthly) || 0) / (Number(std) || 1);
  const base = Math.round(dayRate * (Number(days) || 0) * 100) / 100;
  return (
    <Card title={<span className="flex items-center gap-2"><Icon name="calculator" /> الحاسبة السريعة</span>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 rounded-xl bg-green-50 p-3">
          <p className="text-sm font-bold text-green-900">عمولة التوصيل</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="عدد القطع / الطرود">
              <Input dir="ltr" type="number" min="0" value={units} onChange={(e) => setUnits(e.target.value)} />
            </Field>
            <Field label={`السعر (${f.currencySymbol})`}>
              <Input dir="ltr" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
          </div>
          <p className="text-sm">
            {f.n(Number(units) || 0)} × {f.money(Number(rate) || 0)} = <b className="text-lg">{f.money(commission)}</b>
          </p>
        </div>
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          <p className="text-sm font-bold">الراتب حسب أيام العمل</p>
          <div className="grid grid-cols-3 gap-2">
            <Field label="الراتب الشهري">
              <Input dir="ltr" type="number" min="0" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
            </Field>
            <Field label="أيام معيارية">
              <Input dir="ltr" type="number" min="1" max="31" value={std} onChange={(e) => setStd(e.target.value)} />
            </Field>
            <Field label="أيام العمل">
              <Input dir="ltr" type="number" min="0" max="31" value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
          </div>
          <p className="text-sm">
            ({f.money(Number(monthly) || 0)} ÷ {f.n(Number(std) || 1)}) × {f.n(Number(days) || 0)} = <b className="text-lg">{f.money(base)}</b>
          </p>
        </div>
      </div>
      <p className="mt-3 rounded-xl bg-slate-900 p-3 text-center text-white">
        الإجمالي (هجين): <b className="text-lg">{f.money(base + commission)}</b>
      </p>
    </Card>
  );
}
