'use client';

import { useState } from 'react';
import { ROLES, ROLE_LABELS, type Role } from '@/lib/domain';
import { apiSend, qs, type ApiError } from '@/lib/client/api';
import { useApi } from '@/lib/client/hooks';
import type { Driver, Paged, UserRow } from '@/lib/client/types';
import { PointSelect } from '@/components/pickers';
import { useApp } from '@/components/providers';
import { Badge, Button, Checkbox, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Td, Th } from '@/components/ui';

type Form = { name: string; email: string; password: string; role: Role; deliveryPointId: string; driverId: string; isActive: boolean };

export default function UsersPage() {
  const { f, toast, user: me } = useApp();
  const { data, error, loading, reload } = useApi<UserRow[]>('/api/users');
  const { data: drivers } = useApi<Paged<Driver>>(`/api/drivers${qs({ pageSize: 200 })}`);
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing) return;
    setBusy(true);
    setErrors({});
    const fm = editing.form;
    try {
      if (editing.id) {
        await apiSend('PATCH', `/api/users/${editing.id}`, {
          name: fm.name,
          role: fm.role,
          deliveryPointId: fm.deliveryPointId || null,
          isActive: fm.isActive,
          ...(fm.password ? { password: fm.password } : {}),
        });
      } else {
        await apiSend('POST', '/api/users', {
          name: fm.name,
          email: fm.email,
          password: fm.password,
          role: fm.role,
          deliveryPointId: fm.deliveryPointId || null,
          driverId: fm.role === 'DRIVER' ? fm.driverId || null : null,
        });
      }
      toast('تم الحفظ');
      setEditing(null);
      reload();
    } catch (err) {
      const e = err as ApiError;
      setErrors((e.details as { fields?: Record<string, string> })?.fields ?? {});
      toast(e.messageAr, 'error');
    } finally {
      setBusy(false);
    }
  }

  const fm = editing?.form;
  const patch = (p: Partial<Form>) => setEditing((s) => (s ? { ...s, form: { ...s.form, ...p } } : s));
  const freeDrivers = (drivers?.items ?? []).filter((d) => !d.user);

  return (
    <>
      <PageHeader
        title="المستخدمون والصلاحيات"
        actions={
          <Button onClick={() => setEditing({ id: null, form: { name: '', email: '', password: '', role: 'WAREHOUSE', deliveryPointId: '', driverId: '', isActive: true } })}>
            + مستخدم جديد
          </Button>
        }
      />
      {loading && !data && <Loading />}
      <ErrorBox error={error} onRetry={reload} />
      {data && (
        <Table>
          <thead>
            <tr>
              <Th>الاسم</Th>
              <Th>البريد</Th>
              <Th>الدور</Th>
              <Th>النقطة</Th>
              <Th>آخر دخول</Th>
              <Th>الحالة</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className={u.isActive ? '' : 'opacity-60'}>
                <Td className="font-semibold">{u.name}</Td>
                <Td className="ltr text-xs">{u.email}</Td>
                <Td>
                  {ROLE_LABELS[u.role]}
                  {u.driver && <span className="block text-xs text-slate-500">{u.driver.fullName}</span>}
                </Td>
                <Td className="text-xs">{u.deliveryPoint?.name ?? 'كل النقاط'}</Td>
                <Td className="text-xs">{f.dateTime(u.lastLoginAt)}</Td>
                <Td>{u.isActive ? <Badge className="border-green-300 bg-green-100 text-green-900">نشط</Badge> : <Badge>معطّل</Badge>}</Td>
                <Td>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setEditing({
                        id: u.id,
                        form: { name: u.name, email: u.email, password: '', role: u.role, deliveryPointId: u.deliveryPointId ?? '', driverId: u.driver?.id ?? '', isActive: u.isActive },
                      })
                    }
                  >
                    تعديل
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'تعديل مستخدم' : 'مستخدم جديد'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              إلغاء
            </Button>
            <Button onClick={save} loading={busy}>
              حفظ
            </Button>
          </>
        }
      >
        {fm && (
          <div className="space-y-3">
            <Field label="الاسم" error={errors.name}>
              <Input value={fm.name} onChange={(e) => patch({ name: e.target.value })} />
            </Field>
            <Field label="البريد الإلكتروني" error={errors.email}>
              <Input dir="ltr" type="email" value={fm.email} disabled={!!editing?.id} onChange={(e) => patch({ email: e.target.value })} />
            </Field>
            <Field label={editing?.id ? 'كلمة مرور جديدة (اتركها فارغة لعدم التغيير)' : 'كلمة المرور'} error={errors.password} hint="8 أحرف على الأقل، حروف وأرقام">
              <Input dir="ltr" type="password" autoComplete="new-password" value={fm.password} onChange={(e) => patch({ password: e.target.value })} />
            </Field>
            <Field label="الدور" error={errors.role}>
              <Select value={fm.role} onChange={(e) => patch({ role: e.target.value as Role })} disabled={editing?.id === me.id || (!!editing?.id && fm.role === 'DRIVER')}>
                {ROLES.filter((r) => r !== 'DRIVER' || !editing?.id || fm.role === 'DRIVER').map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            {fm.role === 'DRIVER' && !editing?.id && (
              <Field label="سجل السائق المرتبط" error={errors.driverId} hint="أنشئ السائق أولاً من شاشة السائقين">
                <Select value={fm.driverId} onChange={(e) => patch({ driverId: e.target.value })}>
                  <option value="">اختر…</option>
                  {freeDrivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fullName}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {fm.role !== 'DRIVER' && fm.role !== 'ADMIN' && (
              <div>
                <PointSelect
                  value={fm.deliveryPointId}
                  onChange={(v) => patch({ deliveryPointId: v })}
                  label={fm.role === 'HUB_MANAGER' ? 'النقطة (إلزامي)' : 'النقطة (اختياري — فارغ = كل النقاط)'}
                  allowAll={fm.role === 'WAREHOUSE'}
                  emptyLabel="كل النقاط"
                  locked={false}
                />
                {errors.deliveryPointId && <p className="mt-1 text-xs font-bold text-red-600">{errors.deliveryPointId}</p>}
              </div>
            )}
            {editing?.id && editing.id !== me.id && <Checkbox label="الحساب نشط" checked={fm.isActive} onChange={(v) => patch({ isActive: v })} />}
            <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">تغيير كلمة المرور أو الدور أو تعطيل الحساب يُخرج المستخدم من كل أجهزته فوراً.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
