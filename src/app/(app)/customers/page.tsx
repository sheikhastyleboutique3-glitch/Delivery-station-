'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiSend, qs, type ApiError } from '@/lib/client/api';
import { useApi, useDebounce } from '@/lib/client/hooks';
import type { Customer, Paged } from '@/lib/client/types';
import { useApp } from '@/components/providers';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Pagination, Table, Td, Th, Textarea } from '@/components/ui';

type Form = { name: string; phone: string; altPhone: string; address: string; deliveryNotes: string };

export default function CustomersPage() {
  const { toast } = useApp();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q, 300);
  const { data, error, loading, reload } = useApi<Paged<Customer>>(`/api/customers${qs({ q: dq, page, pageSize: 50 })}`);
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing) return;
    setBusy(true);
    setErrors({});
    try {
      if (editing.id) await apiSend('PATCH', `/api/customers/${editing.id}`, editing.form);
      else await apiSend('POST', '/api/customers', editing.form);
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

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setEditing((s) => (s ? { ...s, form: { ...s.form, [k]: e.target.value } } : s));

  return (
    <>
      <PageHeader
        title="العملاء"
        actions={<Button onClick={() => setEditing({ id: null, form: { name: '', phone: '', altPhone: '', address: '', deliveryNotes: '' } })}>+ عميل جديد</Button>}
      />
      <Card className="mb-4">
        <Input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="ابحث بالاسم أو الهاتف أو العنوان" />
      </Card>
      {loading && !data && <Loading />}
      <ErrorBox error={error} onRetry={reload} />
      {data && data.items.length === 0 && <EmptyState title="لا يوجد عملاء" />}
      {data && data.items.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>الاسم</Th>
              <Th>الهاتف</Th>
              <Th>العنوان</Th>
              <Th>ملاحظات التوصيل</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.items.map((c) => (
              <tr key={c.id}>
                <Td className="font-semibold">{c.name}</Td>
                <Td className="ltr">{c.phone}</Td>
                <Td className="text-xs">{c.address}</Td>
                <Td className="text-xs">{c.deliveryNotes}</Td>
                <Td className="whitespace-nowrap">
                  <Link href={`/movements?customerId=${c.id}`} className="me-2 text-sm font-bold text-blue-700 underline">
                    التسليمات
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setEditing({ id: c.id, form: { name: c.name, phone: c.phone, altPhone: c.altPhone ?? '', address: c.address ?? '', deliveryNotes: c.deliveryNotes ?? '' } })
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
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'تعديل عميل' : 'عميل جديد'}
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
            <Field label="الاسم" error={errors.name}>
              <Input value={editing.form.name} onChange={set('name')} />
            </Field>
            <Field label="الهاتف" error={errors.phone}>
              <Input dir="ltr" inputMode="tel" value={editing.form.phone} onChange={set('phone')} />
            </Field>
            <Field label="هاتف بديل" error={errors.altPhone}>
              <Input dir="ltr" inputMode="tel" value={editing.form.altPhone} onChange={set('altPhone')} />
            </Field>
            <Field label="العنوان">
              <Input value={editing.form.address} onChange={set('address')} />
            </Field>
            <Field label="ملاحظات التوصيل">
              <Textarea value={editing.form.deliveryNotes} onChange={set('deliveryNotes')} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
