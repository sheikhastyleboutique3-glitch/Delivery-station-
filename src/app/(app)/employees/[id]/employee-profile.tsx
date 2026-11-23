'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  COMMISSION_MODE_LABELS,
  DRIVER_STATUS_LABELS,
  EMPLOYEE_JOB_LABELS,
  EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_LABELS,
  MOVEMENT_LABELS,
  PAY_TYPE_LABELS,
  payTypeHasBase,
  payTypeHasCommission,
  type EmployeeStatus,
  type MovementType,
} from '@/lib/domain';
import { apiSend, qs, type ApiError } from '@/lib/client/api';
import { useApi } from '@/lib/client/hooks';
import type { Employee, Paged, PayoutCalcView, PayoutRow } from '@/lib/client/types';
import { ColorChip } from '@/components/colors';
import { AttendancePanel } from '@/components/hr/attendance';
import { DocumentsPanel } from '@/components/hr/documents';
import { EmployeeFormModal } from '@/components/hr/employee-form';
import { CalcBreakdown, PayoutDetailModal, PayoutStatusBadge } from '@/components/hr/payroll';
import { MovementsList } from '@/components/movements';
import { useApp } from '@/components/providers';
import { Badge, Button, Card, ErrorBox, Field, Input, LinkButton, Loading, Modal, PageHeader, Select, Table, Tabs, Td, Th } from '@/components/ui';
import { Avatar, STATUS_STYLE } from '@/components/hr/avatar';

type Tab = 'info' | 'documents' | 'attendance' | 'pay' | 'deliveries';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? '—'}</dd>
    </>
  );
}

export function EmployeeProfile({ id, initialTab }: { id: string; initialTab?: string }) {
  const { f } = useApp();
  const { data: e, error, loading, reload } = useApi<Employee>(`/api/employees/${id}`);
  const [tab, setTab] = useState<Tab>((['info', 'documents', 'attendance', 'pay', 'deliveries'].includes(initialTab ?? '') ? initialTab : 'info') as Tab);
  const [editing, setEditing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  if (loading && !e) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!e) return null;
  const photo = e.documents?.find((d) => d.type === 'PHOTO');
  const isDriver = !!e.driver;

  return (
    <>
      <PageHeader
        title={e.fullName}
        subtitle={`${e.employeeNo} · ${e.jobTitle || EMPLOYEE_JOB_LABELS[e.jobType]}${e.deliveryPoint ? ` · ${e.deliveryPoint.name}` : ''}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              تعديل البيانات
            </Button>
            <Button variant="secondary" onClick={() => setStatusOpen(true)}>
              تغيير حالة العمل
            </Button>
            {e.driver && <LinkButton href={`/drivers/${e.driver.id}`}>صفحة السائق والعهدة</LinkButton>}
          </>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar photoId={photo?.id} name={e.fullName} size="h-16 w-16" />
          <div className="flex flex-wrap gap-2">
            <Badge className={STATUS_STYLE[e.status]}>{EMPLOYEE_STATUS_LABELS[e.status]}</Badge>
            <Badge>{PAY_TYPE_LABELS[e.payType]}</Badge>
            {e.driver && <Badge>السائق: {DRIVER_STATUS_LABELS[e.driver.status]}</Badge>}
            {isDriver && <ColorChip color="BLUE" count={e.custody ?? 0} />}
          </div>
          {e.status === 'TERMINATED' && (
            <p className="w-full rounded-xl bg-slate-100 p-3 text-sm">
              توقف عن العمل في {f.ymd(e.terminationDate)}. السبب: {e.terminationReason}
            </p>
          )}
          {e.status === 'SUSPENDED' && e.terminationReason && <p className="w-full rounded-xl bg-amber-50 p-3 text-sm">سبب الإيقاف: {e.terminationReason}</p>}
        </div>
      </Card>

      <Tabs
        tabs={[
          { key: 'info', label: 'البيانات' },
          { key: 'documents', label: `الوثائق (${f.n(e.documents?.length ?? 0)})` },
          { key: 'attendance', label: 'الحضور' },
          { key: 'pay', label: 'المستحقات' },
          ...(isDriver ? [{ key: 'deliveries' as const, label: 'سجل التوصيل' }] : []),
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'info' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="البيانات الشخصية">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <Row label="الهاتف"><span className="ltr">{e.phone}</span></Row>
              <Row label="هاتف بديل">{e.altPhone ? <span className="ltr">{e.altPhone}</span> : null}</Row>
              <Row label="العنوان">{e.address}</Row>
              <Row label="تاريخ الميلاد">{e.dateOfBirth ? f.ymd(e.dateOfBirth) : null}</Row>
              <Row label="الجنسية">{e.nationality}</Row>
              <Row label="ملاحظات">{e.notes}</Row>
            </dl>
          </Card>
          <Card title="الهوية والعمل">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <Row label="رقم البطاقة"><span className="ltr">{e.nationalId}</span></Row>
              <Row label="انتهاء البطاقة">{e.idExpiryDate ? f.ymd(e.idExpiryDate) : null}</Row>
              <Row label="الدور">{EMPLOYEE_JOB_LABELS[e.jobType]}</Row>
              <Row label="المسمى">{e.jobTitle}</Row>
              <Row label="النقطة">{e.deliveryPoint?.name}</Row>
              <Row label="تاريخ الالتحاق">{f.ymd(e.hireDate)}</Row>
              {e.terminationDate && <Row label="تاريخ التوقف">{f.ymd(e.terminationDate)}</Row>}
            </dl>
          </Card>
          {isDriver && (
            <Card title="بيانات السائق">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <Row label="المركبة">{e.driver?.vehicleType}</Row>
                <Row label="اللوحة">{e.driver?.vehiclePlate ? <span className="ltr">{e.driver.vehiclePlate}</span> : null}</Row>
                <Row label="رخصة القيادة">{e.drivingLicenseNumber ? <span className="ltr">{e.drivingLicenseNumber}</span> : null}</Row>
                <Row label="انتهاء الرخصة">{e.drivingLicenseExpiry ? f.ymd(e.drivingLicenseExpiry) : null}</Row>
                <Row label="حساب الدخول">{e.driver?.user ? <span className="ltr">{e.driver.user.email}</span> : 'لا يوجد'}</Row>
              </dl>
            </Card>
          )}
          <Card title="نظام الدفع">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <Row label="النظام">{PAY_TYPE_LABELS[e.payType]}</Row>
              {payTypeHasBase(e.payType) && (
                <>
                  <Row label="الراتب الشهري">{f.money(e.monthlySalary)}</Row>
                  <Row label="أجر اليوم">{e.dailyRate ? f.money(e.dailyRate) : `الراتب ÷ ${e.workDaysPerMonth ?? 'أيام الإعدادات'}`}</Row>
                </>
              )}
              {payTypeHasCommission(e.payType) && (
                <>
                  <Row label="احتساب العمولة">{COMMISSION_MODE_LABELS[e.commissionMode]}</Row>
                  <Row label="أسعار خاصة">
                    {e.rates && e.rates.length > 0
                      ? e.rates.map((r) => (
                          <span key={r.id} className="block">
                            {f.money(r.amount)} {r.mode === 'PER_COLIS' ? 'لكل طرد' : 'لكل قطعة'}
                            {r.category ? ` (فئة ${r.category})` : ''}
                          </span>
                        ))
                      : 'السعر الافتراضي'}
                  </Row>
                </>
              )}
            </dl>
          </Card>
        </div>
      )}

      {tab === 'documents' && (
        <Card>
          <DocumentsPanel employeeId={e.id} documents={e.documents ?? []} onChanged={reload} />
        </Card>
      )}

      {tab === 'attendance' && (
        <Card>
          <AttendancePanel employeeId={e.id} />
        </Card>
      )}

      {tab === 'pay' && <EmployeePay employee={e} />}

      {tab === 'deliveries' && e.driver && (
        <div className="space-y-4">
          <Card title="ملخص السائق حسب الألوان (كل الفترات)">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['DISPATCH', 'BLUE'],
                  ['DELIVERED', 'GREEN'],
                  ['RETURN_GOOD', 'PURPLE'],
                  ['RETURN_DAMAGED', 'RED'],
                  ['SHORTAGE', 'RED'],
                ] as [MovementType, 'BLUE' | 'GREEN' | 'PURPLE' | 'RED'][]
              ).map(([t, c]) => (
                <span key={t} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  <ColorChip color={c} compact /> {MOVEMENT_LABELS[t]}: <b className="tabular-nums">{f.n(e.driverStats?.[t] ?? 0)}</b>
                </span>
              ))}
              <span className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                العهدة الحالية: <b>{f.n(e.custody ?? 0)}</b>
              </span>
            </div>
          </Card>
          <Card title="سجل ما أخذه وسلّمه وأرجعه">
            <MovementsList filter={{ driverId: e.driver.id }} />
          </Card>
        </div>
      )}

      {editing && (
        <EmployeeFormModal
          employee={e}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
      {statusOpen && (
        <StatusModal
          employee={e}
          onClose={() => setStatusOpen(false)}
          onDone={() => {
            setStatusOpen(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function StatusModal({ employee, onClose, onDone }: { employee: Employee; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [status, setStatus] = useState<EmployeeStatus>(employee.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiSend('POST', `/api/employees/${employee.id}/status`, {
        status,
        terminationDate: status === 'TERMINATED' ? date : null,
        terminationReason: status === 'ACTIVE' ? null : reason || null,
      });
      toast('تم تغيير حالة العمل');
      onDone();
    } catch (err) {
      toast((err as ApiError).messageAr, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="تغيير حالة العمل"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant={status === 'ACTIVE' ? 'success' : 'danger'} onClick={save} loading={busy} disabled={status === 'TERMINATED' && (!reason.trim() || !date)}>
            تأكيد
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="الحالة الجديدة">
          <Select value={status} onChange={(e) => setStatus(e.target.value as EmployeeStatus)}>
            {EMPLOYEE_STATUSES.filter((s) => s !== employee.status).map((s) => (
              <option key={s} value={s}>
                {EMPLOYEE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        {status === 'TERMINATED' && (
          <Field label="تاريخ التوقف أو ترك العمل">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        {status !== 'ACTIVE' && (
          <Field label={status === 'TERMINATED' ? 'سبب التوقف / إنهاء الخدمة (إلزامي)' : 'سبب الإيقاف (اختياري)'}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
          {status === 'ACTIVE'
            ? 'إعادة التفعيل تعيد السائق «متاحاً» للصرف وتعيد تفعيل حساب دخوله.'
            : 'الإيقاف أو إنهاء الخدمة يمنع الصرف للسائق ويعطّل حساب دخوله ويُخرجه من كل أجهزته. يجب تسوية أي عهدة مفتوحة أولاً. السجلات والمستحقات السابقة تبقى محفوظة.'}
        </p>
      </div>
    </Modal>
  );
}

function monthBounds(offset = 0) {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const today = now.toISOString().slice(0, 10);
  const to = last.toISOString().slice(0, 10);
  return { from: first.toISOString().slice(0, 10), to: offset === 0 && to > today ? today : to };
}

function EmployeePay({ employee }: { employee: Employee }) {
  const { f, toast } = useApp();
  const [range, setRange] = useState(monthBounds(0));
  const { data: calc, reload } = useApi<PayoutCalcView>(`/api/payroll/preview${qs({ employeeId: employee.id, ...range })}`);
  const { data: payouts, reload: reloadList } = useApi<Paged<PayoutRow>>(`/api/payroll${qs({ employeeId: employee.id, pageSize: 50 })}`);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const p = await apiSend<PayoutRow>('POST', '/api/payroll', { employeeId: employee.id, ...range });
      toast(`تم إنشاء الكشف ${p.payoutNo}`);
      reload();
      reloadList();
      setOpen(p.id);
    } catch (err) {
      toast((err as ApiError).messageAr, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="حساب المستحقات لفترة">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Field label="من">
            <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </Field>
          <Field label="إلى">
            <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </Field>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setRange(monthBounds(0))}>
            هذا الشهر
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setRange(monthBounds(-1))}>
            الشهر الماضي
          </Button>
        </div>
        {calc ? (
          <>
            <CalcBreakdown c={calc} />
            {calc.overlapping ? (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                يوجد كشف{' '}
                <button className="font-bold underline" onClick={() => setOpen(calc.overlapping!.id)}>
                  {calc.overlapping.payoutNo}
                </button>{' '}
                يغطي جزءاً من هذه الفترة. افتحه واضغط «إعادة الحساب» لإضافة التسليمات الجديدة.
              </p>
            ) : (
              <Button className="mt-3 w-full" onClick={create} loading={busy}>
                إنشاء كشف المستحقات لهذه الفترة
              </Button>
            )}
          </>
        ) : (
          <Loading />
        )}
      </Card>

      <Card title="سجل الكشوف والدفعات">
        {!payouts || payouts.items.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد كشوف بعد.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>الكشف</Th>
                <Th>الفترة</Th>
                <Th>الصافي</Th>
                <Th>المدفوع</Th>
                <Th>المتبقي</Th>
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody>
              {payouts.items.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(p.id)}>
                  <Td className="ltr font-mono text-xs font-bold">{p.payoutNo}</Td>
                  <Td className="whitespace-nowrap text-xs">
                    {p.periodStart} ← {p.periodEnd}
                  </Td>
                  <Td className="tabular-nums">{f.money(p.netAmount)}</Td>
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
        <p className="mt-3 text-xs text-slate-500">
          <Link href="/payroll" className="font-bold underline">
            شاشة الرواتب
          </Link>{' '}
          لإنشاء كشوف كل الموظفين دفعة واحدة.
        </p>
      </Card>

      {open && (
        <PayoutDetailModal
          id={open}
          onClose={() => setOpen(null)}
          onChanged={() => {
            reload();
            reloadList();
          }}
        />
      )}
    </div>
  );
}
