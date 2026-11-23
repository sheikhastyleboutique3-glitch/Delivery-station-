'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EMPLOYEE_JOBS, EMPLOYEE_JOB_LABELS, EMPLOYEE_STATUSES, EMPLOYEE_STATUS_LABELS, PAY_TYPE_LABELS } from '@/lib/domain';
import { Avatar, STATUS_STYLE } from '@/components/hr/avatar';
import { qs } from '@/lib/client/api';
import { useApi, useDebounce } from '@/lib/client/hooks';
import type { Employee, Paged } from '@/lib/client/types';
import { EmployeeFormModal } from '@/components/hr/employee-form';
import { Icon } from '@/components/icons';
import { PointSelect } from '@/components/pickers';
import { useApp } from '@/components/providers';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Field, Input, Loading, PageHeader, Pagination, Select } from '@/components/ui';

export default function EmployeesPage() {
  const { f, settings } = useApp();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('ACTIVE');
  const [jobType, setJobType] = useState('');
  const [pointId, setPointId] = useState('');
  const [expiring, setExpiring] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const dq = useDebounce(q, 300);
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const { data, error, loading, reload } = useApi<Paged<Employee>>(
    `/api/employees${qs({ q: dq, status, jobType, pointId, expiring: expiring ? '1' : undefined, page, pageSize: 30 })}`,
  );
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="الموظفون والسائقون"
        subtitle="الملفات الشخصية والوثائق والحضور ونظام الدفع"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Icon name="plus" /> إضافة موظف أو سائق
          </Button>
        }
      />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="بحث">
            <Input type="search" value={q} onChange={(e) => reset(() => setQ(e.target.value))} placeholder="الاسم، الهاتف، رقم البطاقة، رقم الموظف" />
          </Field>
          <Field label="حالة العمل">
            <Select value={status} onChange={(e) => reset(() => setStatus(e.target.value))}>
              <option value="">الكل</option>
              {EMPLOYEE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {EMPLOYEE_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="الدور">
            <Select value={jobType} onChange={(e) => reset(() => setJobType(e.target.value))}>
              <option value="">كل الأدوار</option>
              {EMPLOYEE_JOBS.map((j) => (
                <option key={j} value={j}>
                  {EMPLOYEE_JOB_LABELS[j]}
                </option>
              ))}
            </Select>
          </Field>
          <PointSelect value={pointId} onChange={(v) => reset(() => setPointId(v))} allowAll locked={false} activeOnly={false} />
        </div>
        <Checkbox label={`وثائق منتهية أو تنتهي خلال ${settings.documentExpiryAlertDays} يوماً`} checked={expiring} onChange={(v) => reset(() => setExpiring(v))} />
      </Card>

      {loading && !data && <Loading />}
      <ErrorBox error={error} onRetry={reload} />
      {data && data.items.length === 0 && <EmptyState title="لا يوجد موظفون مطابقون" action={<Button onClick={() => setCreating(true)}>إضافة موظف</Button>} />}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data?.items.map((e) => {
          const left = e.nearestExpiry ? Math.round((Date.parse(e.nearestExpiry.slice(0, 10)) - Date.parse(today)) / 86_400_000) : null;
          return (
            <li key={e.id}>
              <Link href={`/employees/${e.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-400">
                <div className="flex items-start gap-3">
                  <Avatar photoId={e.photoId} name={e.fullName} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-bold">{e.fullName}</p>
                      <Badge className={STATUS_STYLE[e.status]}>{EMPLOYEE_STATUS_LABELS[e.status]}</Badge>
                    </div>
                    <p className="text-xs text-slate-500">
                      <span className="ltr font-mono">{e.employeeNo}</span> · {e.jobTitle || EMPLOYEE_JOB_LABELS[e.jobType]}
                      {e.deliveryPoint ? ` · ${e.deliveryPoint.name}` : ''}
                    </p>
                    <p className="ltr text-start text-sm text-slate-600">{e.phone}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <Badge>{PAY_TYPE_LABELS[e.payType]}</Badge>
                  <Badge>{f.n(e.documentsCount ?? 0)} وثيقة</Badge>
                  {left !== null && left < 0 && <Badge className="border-red-300 bg-red-100 text-red-900">وثيقة منتهية</Badge>}
                  {left !== null && left >= 0 && left <= settings.documentExpiryAlertDays && (
                    <Badge className="border-amber-300 bg-amber-100 text-amber-900">وثيقة تنتهي بعد {f.n(left)} يوم</Badge>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}

      {creating && (
        <EmployeeFormModal
          employee={null}
          onClose={() => setCreating(false)}
          onSaved={(e) => {
            setCreating(false);
            router.push(`/employees/${e.id}`);
          }}
        />
      )}
    </>
  );
}
