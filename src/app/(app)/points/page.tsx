'use client';

import { useState } from 'react';
import { apiSend, type ApiError } from '@/lib/client/api';
import type { Point } from '@/lib/client/types';
import { usePoints } from '@/components/pickers';
import { useApp } from '@/components/providers';
import { Badge, Button, Checkbox, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Td, Th } from '@/components/ui';

type Form = { code: string; name: string; type: 'WAREHOUSE' | 'HUB'; address: string; phone: string; isActive: boolean };

export default function PointsPage() {
  const { toast, f } = useApp();
  const { data, error, loading, reload } = usePoints();
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save() {
    if (!editing) return;
    setBusy(true);
    setErrors({});
    try {
      if (editing.id) await apiSend('PATCH', `/api/points/${editing.id}`, editing.form);
      else await apiSend('POST', '/api/points', editing.form);
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
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setEditing((s) => (s ? { ...s, form: { ...s.form, [k]: e.target.value } } : s));
  const open = (p: Point | null) =>
    setEditing({
      id: p?.id ?? null,
      form: { code: p?.code ?? '', name: p?.name ?? '', type: p?.type ?? 'HUB', address: p?.address ?? '', phone: p?.phone ?? '', isActive: p?.isActive ?? true },
    });

  return (
    <>
      <PageHeader title="نقاط الدليفري والفروع" subtitle="لكل نقطة مخزون مستقل. المستودع الرئيسي نقطة من نوع «مستودع»." actions={<Button onClick={() => open(null)}>+ نقطة جديدة</Button>} />
      {loading && !data && <Loading />}
      <ErrorBox error={error} onRetry={reload} />
      {data && (
        <Table>
          <thead>
            <tr>
              <Th>الرمز</Th>
              <Th>الاسم</Th>
              <Th>النوع</Th>
              <Th>العنوان</Th>
              <Th>الهاتف</Th>
              <Th>السائقون</Th>
              <Th>الحالة</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id}>
                <Td className="ltr font-mono font-bold">{p.code}</Td>
                <Td className="font-semibold">{p.name}</Td>
                <Td>{p.type === 'WAREHOUSE' ? 'مستودع' : 'نقطة دليفري'}</Td>
                <Td className="text-xs">{p.address}</Td>
                <Td className="ltr">{p.phone}</Td>
                <Td>{f.n(p._count?.drivers ?? 0)}</Td>
                <Td>{p.isActive ? <Badge className="border-green-300 bg-green-100 text-green-900">نشطة</Badge> : <Badge>معطلة</Badge>}</Td>
                <Td>
                  <Button size="sm" variant="ghost" onClick={() => open(p)}>
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
        title={editing?.id ? 'تعديل نقطة' : 'نقطة جديدة'}
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
        {editing && (
          <div className="space-y-3">
            <Field label="الرمز (إنجليزي)" error={errors.code}>
              <Input dir="ltr" value={editing.form.code} onChange={set('code')} placeholder="HUB-NORTH" />
            </Field>
            <Field label="الاسم" error={errors.name}>
              <Input value={editing.form.name} onChange={set('name')} />
            </Field>
            <Field label="النوع">
              <Select value={editing.form.type} onChange={set('type')}>
                <option value="WAREHOUSE">مستودع</option>
                <option value="HUB">نقطة دليفري</option>
              </Select>
            </Field>
            <Field label="العنوان">
              <Input value={editing.form.address} onChange={set('address')} />
            </Field>
            <Field label="الهاتف" error={errors.phone}>
              <Input dir="ltr" value={editing.form.phone} onChange={set('phone')} />
            </Field>
            <Checkbox label="نشطة" checked={editing.form.isActive} onChange={(v) => setEditing((s) => (s ? { ...s, form: { ...s.form, isActive: v } } : s))} />
          </div>
        )}
      </Modal>
    </>
  );
}
