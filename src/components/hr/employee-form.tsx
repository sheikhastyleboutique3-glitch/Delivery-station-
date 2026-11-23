'use client';

import { useState } from 'react';
import {
  COMMISSION_MODES,
  COMMISSION_MODE_LABELS,
  EMPLOYEE_JOBS,
  EMPLOYEE_JOB_LABELS,
  PAY_TYPES,
  PAY_TYPE_LABELS,
  payTypeHasBase,
  payTypeHasCommission,
  type CommissionMode,
  type EmployeeJob,
  type PayType,
} from '@/lib/domain';
import { apiSend, type ApiError } from '@/lib/client/api';
import type { Employee } from '@/lib/client/types';
import { PointSelect } from '../pickers';
import { useApp } from '../providers';
import { Button, Field, Input, Modal, Select } from '../ui';

type Form = {
  fullName: string;
  phone: string;
  altPhone: string;
  address: string;
  dateOfBirth: string;
  nationality: string;
  notes: string;
  nationalId: string;
  idExpiryDate: string;
  jobType: EmployeeJob;
  jobTitle: string;
  deliveryPointId: string;
  hireDate: string;
  drivingLicenseNumber: string;
  drivingLicenseExpiry: string;
  vehicleType: string;
  vehiclePlate: string;
  payType: PayType;
  monthlySalary: string;
  dailyRate: string;
  workDaysPerMonth: string;
  commissionMode: CommissionMode;
};

const d10 = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');

function initial(e: Employee | null, today: string): Form {
  return {
    fullName: e?.fullName ?? '',
    phone: e?.phone ?? '',
    altPhone: e?.altPhone ?? '',
    address: e?.address ?? '',
    dateOfBirth: d10(e?.dateOfBirth),
    nationality: e?.nationality ?? 'جزائرية',
    notes: e?.notes ?? '',
    nationalId: e?.nationalId ?? '',
    idExpiryDate: d10(e?.idExpiryDate),
    jobType: e?.jobType ?? 'DRIVER',
    jobTitle: e?.jobTitle ?? '',
    deliveryPointId: e?.deliveryPointId ?? '',
    hireDate: d10(e?.hireDate) || today,
    drivingLicenseNumber: e?.drivingLicenseNumber ?? '',
    drivingLicenseExpiry: d10(e?.drivingLicenseExpiry),
    vehicleType: e?.driver?.vehicleType ?? '',
    vehiclePlate: e?.driver?.vehiclePlate ?? '',
    payType: e?.payType ?? 'PER_DELIVERY',
    monthlySalary: e ? String(Number(e.monthlySalary)) : '0',
    dailyRate: e?.dailyRate ? String(Number(e.dailyRate)) : '',
    workDaysPerMonth: e?.workDaysPerMonth ? String(e.workDaysPerMonth) : '',
    commissionMode: e?.commissionMode ?? 'PER_UNIT',
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-xl border border-slate-200 p-3">
      <legend className="px-2 text-sm font-extrabold text-slate-700">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function EmployeeFormModal({ employee, onClose, onSaved }: { employee: Employee | null; onClose: () => void; onSaved: (e: Employee) => void }) {
  const { toast, settings, f } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<Form>(() => initial(employee, today));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const isDriver = form.jobType === 'DRIVER';
  const standard = Number(form.workDaysPerMonth) || settings.standardWorkDays;
  const dailyPreview = Number(form.dailyRate) > 0 ? Number(form.dailyRate) : Number(form.monthlySalary) / standard;

  async function save() {
    setBusy(true);
    setErrors({});
    const body = {
      ...form,
      monthlySalary: Number(form.monthlySalary) || 0,
      dailyRate: form.dailyRate === '' ? null : Number(form.dailyRate),
      workDaysPerMonth: form.workDaysPerMonth === '' ? null : Number(form.workDaysPerMonth),
      deliveryPointId: form.deliveryPointId || null,
    };
    try {
      const saved = employee ? await apiSend<Employee>('PATCH', `/api/employees/${employee.id}`, body) : await apiSend<Employee>('POST', '/api/employees', body);
      toast(employee ? 'تم حفظ الملف' : `تمت إضافة الموظف ${saved.employeeNo}`);
      onSaved(saved);
    } catch (err) {
      const e = err as ApiError;
      setErrors((e.details as { fields?: Record<string, string> })?.fields ?? {});
      toast(e.messageAr, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={employee ? `تعديل ملف: ${employee.fullName}` : 'إضافة موظف أو سائق'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save} loading={busy}>
            حفظ
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Section title="البيانات الشخصية">
          <Field label="الاسم الكامل" error={errors.fullName}>
            <Input value={form.fullName} onChange={set('fullName')} />
          </Field>
          <Field label="تاريخ الميلاد" error={errors.dateOfBirth}>
            <Input type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} />
          </Field>
          <Field label="رقم الهاتف" error={errors.phone}>
            <Input dir="ltr" inputMode="tel" value={form.phone} onChange={set('phone')} placeholder="+213 5X XX XX XX" />
          </Field>
          <Field label="رقم هاتف بديل" error={errors.altPhone}>
            <Input dir="ltr" inputMode="tel" value={form.altPhone} onChange={set('altPhone')} />
          </Field>
          <Field label="العنوان التفصيلي" className="sm:col-span-2">
            <Input value={form.address} onChange={set('address')} placeholder="الولاية، البلدية، الحي، الشارع" />
          </Field>
          <Field label="الجنسية">
            <Input value={form.nationality} onChange={set('nationality')} />
          </Field>
          <Field label="ملاحظات عامة">
            <Input value={form.notes} onChange={set('notes')} />
          </Field>
        </Section>

        <Section title="الهوية والوثائق">
          <Field label="رقم بطاقة التعريف الوطنية / الإقامة" error={errors.nationalId}>
            <Input dir="ltr" value={form.nationalId} onChange={set('nationalId')} />
          </Field>
          <Field label="تاريخ انتهاء البطاقة" error={errors.idExpiryDate}>
            <Input type="date" value={form.idExpiryDate} onChange={set('idExpiryDate')} />
          </Field>
        </Section>

        <Section title="البيانات الوظيفية">
          <Field label="الدور" error={errors.jobType}>
            <Select value={form.jobType} onChange={set('jobType')}>
              {EMPLOYEE_JOBS.map((j) => (
                <option key={j} value={j}>
                  {EMPLOYEE_JOB_LABELS[j]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="المسمى الوظيفي (اختياري)">
            <Input value={form.jobTitle} onChange={set('jobTitle')} placeholder="مثال: سائق دراجة نارية" />
          </Field>
          <div>
            <PointSelect
              value={form.deliveryPointId}
              onChange={(v) => setForm((s) => ({ ...s, deliveryPointId: v }))}
              label={isDriver ? 'نقطة الدليفري / المستودع (إلزامي للسائق)' : 'نقطة الدليفري / المستودع'}
              allowAll
              emptyLabel="بدون نقطة محددة"
              locked={false}
            />
            {errors.deliveryPointId && <p className="mt-1 text-xs font-bold text-red-600">{errors.deliveryPointId}</p>}
          </div>
          <Field label="تاريخ الالتحاق بالعمل" error={errors.hireDate}>
            <Input type="date" value={form.hireDate} onChange={set('hireDate')} />
          </Field>
        </Section>

        {isDriver && (
          <Section title="بيانات السائق">
            <Field label="نوع المركبة / الدراجة">
              <Input value={form.vehicleType} onChange={set('vehicleType')} placeholder="دراجة نارية، سيارة، فان…" />
            </Field>
            <Field label="رقم اللوحة">
              <Input dir="ltr" value={form.vehiclePlate} onChange={set('vehiclePlate')} placeholder="12345-116-16" />
            </Field>
            <Field label="رقم رخصة القيادة">
              <Input dir="ltr" value={form.drivingLicenseNumber} onChange={set('drivingLicenseNumber')} />
            </Field>
            <Field label="تاريخ انتهاء الرخصة" error={errors.drivingLicenseExpiry}>
              <Input type="date" value={form.drivingLicenseExpiry} onChange={set('drivingLicenseExpiry')} />
            </Field>
          </Section>
        )}

        <Section title={`نظام الدفع (${f.currencySymbol})`}>
          <Field label="نظام الدفع" className="sm:col-span-2">
            <Select value={form.payType} onChange={set('payType')}>
              {PAY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PAY_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          {payTypeHasBase(form.payType) && (
            <>
              <Field label={`الراتب الشهري (${f.currencySymbol})`} error={errors.monthlySalary}>
                <Input dir="ltr" type="number" min="0" step="0.01" value={form.monthlySalary} onChange={set('monthlySalary')} />
              </Field>
              <Field label={`أيام العمل المعيارية في الشهر (فارغ = ${settings.standardWorkDays})`} error={errors.workDaysPerMonth}>
                <Input dir="ltr" type="number" min="1" max="31" value={form.workDaysPerMonth} onChange={set('workDaysPerMonth')} />
              </Field>
              <Field label={`أجر يومي محدد (اختياري، ${f.currencySymbol})`} hint="إذا تُرك فارغاً: الراتب الشهري ÷ أيام العمل المعيارية" error={errors.dailyRate}>
                <Input dir="ltr" type="number" min="0" step="0.01" value={form.dailyRate} onChange={set('dailyRate')} />
              </Field>
              <div className="flex items-end">
                <p className="w-full rounded-xl bg-slate-50 p-3 text-sm">
                  أجر اليوم المعتمد: <b>{Number.isFinite(dailyPreview) ? f.money(dailyPreview) : '—'}</b>
                </p>
              </div>
            </>
          )}
          {payTypeHasCommission(form.payType) && (
            <>
              <Field label="احتساب عمولة التوصيل">
                <Select value={form.commissionMode} onChange={set('commissionMode')}>
                  {COMMISSION_MODES.map((m) => (
                    <option key={m} value={m}>
                      {COMMISSION_MODE_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end">
                <p className="w-full rounded-xl bg-green-50 p-3 text-sm text-green-900">
                  السعر الافتراضي:{' '}
                  <b>{f.money(form.commissionMode === 'PER_COLIS' ? settings.defaultRatePerColis : settings.defaultRatePerUnit)}</b>{' '}
                  {form.commissionMode === 'PER_COLIS' ? 'لكل طرد' : 'لكل قطعة'}. لسعر خاص بهذا الموظف استخدم شاشة الرواتب ← أسعار التوصيل.
                </p>
              </div>
            </>
          )}
        </Section>
      </div>
    </Modal>
  );
}
