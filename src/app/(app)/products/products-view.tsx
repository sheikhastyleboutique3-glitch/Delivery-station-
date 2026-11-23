'use client';

import { useState } from 'react';
import { apiSend, qs, type ApiError } from '@/lib/client/api';
import { useApi, useDebounce } from '@/lib/client/hooks';
import type { Paged, Product } from '@/lib/client/types';
import { useApp } from '@/components/providers';
import { useBarcodeScanner } from '@/components/scanner/use-barcode-scanner';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Field, Input, LinkButton, Loading, Modal, PageHeader, Pagination, Table, Td, Th } from '@/components/ui';

type Form = {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  unit: string;
  price: string;
  cost: string;
  minStockAlert: string;
  trackUnits: boolean;
  imageUrl: string;
};

const empty = (barcode = ''): Form => ({
  name: '',
  sku: '',
  barcode,
  category: '',
  unit: 'قطعة',
  price: '0',
  cost: '0',
  minStockAlert: '0',
  trackUnits: false,
  imageUrl: '',
});

export function ProductsView({ newBarcode }: { newBarcode: string | null }) {
  const { f, user, toast } = useApp();
  const canEdit = user.role === 'ADMIN' || user.role === 'WAREHOUSE';
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(newBarcode && canEdit ? { id: null, form: empty(newBarcode) } : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dq = useDebounce(q, 300);
  const { data, error, loading, reload } = useApi<Paged<Product>>(`/api/products${qs({ q: dq, archived: archived ? '1' : undefined, page, pageSize: 50 })}`);

  // السكانر الخارجي: يملأ حقل الباركود في نموذج الإضافة، أو يبحث في القائمة
  useBarcodeScanner((code) => {
    if (editing) setEditing((e) => (e ? { ...e, form: { ...e.form, barcode: code } } : e));
    else {
      setQ(code);
      setPage(1);
    }
  });

  function open(p: Product | null) {
    setErrors({});
    setEditing(
      p
        ? {
            id: p.id,
            form: {
              name: p.name,
              sku: p.sku,
              barcode: p.barcode,
              category: p.category,
              unit: p.unit,
              price: p.price,
              cost: p.cost ?? '0',
              minStockAlert: String(p.minStockAlert),
              trackUnits: p.trackUnits,
              imageUrl: p.imageUrl ?? '',
            },
          }
        : { id: null, form: empty() },
    );
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setErrors({});
    const body = { ...editing.form, price: Number(editing.form.price), cost: Number(editing.form.cost), minStockAlert: Number(editing.form.minStockAlert) };
    try {
      if (editing.id) await apiSend('PATCH', `/api/products/${editing.id}`, body);
      else await apiSend('POST', '/api/products', body);
      toast(editing.id ? 'تم حفظ المنتج' : 'تمت إضافة المنتج');
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

  async function toggleArchive(p: Product) {
    if (!p.isArchived && !window.confirm(`أرشفة "${p.name}"؟ لن يظهر في الصرف والإدخال، وتبقى حركاته محفوظة.`)) return;
    try {
      await apiSend('PATCH', `/api/products/${p.id}`, { isArchived: !p.isArchived });
      toast(p.isArchived ? 'تمت استعادة المنتج' : 'تمت الأرشفة');
      reload();
    } catch (err) {
      toast((err as ApiError).messageAr, 'error');
    }
  }

  const fm = editing?.form;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setEditing((s) => (s ? { ...s, form: { ...s.form, [k]: e.target.value } } : s));

  return (
    <>
      <PageHeader
        title="المنتجات"
        actions={
          <>
            <LinkButton href="/products/labels">طباعة ملصقات باركود</LinkButton>
            {canEdit && <Button onClick={() => open(null)}>+ منتج جديد</Button>}
          </>
        }
      />
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="بحث" className="min-w-60 flex-1">
            <Input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="الاسم، SKU، الباركود، الفئة (أو امسح)" />
          </Field>
          <Checkbox label="عرض المؤرشف" checked={archived} onChange={(v) => { setArchived(v); setPage(1); }} />
        </div>
      </Card>
      {loading && !data && <Loading />}
      <ErrorBox error={error} onRetry={reload} />
      {data && data.items.length === 0 && <EmptyState title="لا توجد منتجات" />}
      {data && data.items.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>المنتج</Th>
              <Th>SKU</Th>
              <Th>الباركود</Th>
              <Th>الفئة</Th>
              <Th>السعر</Th>
              {data.items[0].cost !== null && <Th>التكلفة</Th>}
              <Th>حد التنبيه</Th>
              <Th>التتبع</Th>
              {canEdit && <Th />}
            </tr>
          </thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id} className={p.isArchived ? 'opacity-60' : ''}>
                <Td className="font-semibold">{p.name}</Td>
                <Td className="ltr font-mono text-xs">{p.sku}</Td>
                <Td className="ltr font-mono text-xs">{p.barcode}</Td>
                <Td>{p.category}</Td>
                <Td>{f.money(p.price)}</Td>
                {p.cost !== null && <Td>{f.money(p.cost)}</Td>}
                <Td>{f.n(p.minStockAlert)}</Td>
                <Td>{p.trackUnits ? <Badge>بالقطعة</Badge> : <span className="text-xs text-slate-500">بالكمية</span>}</Td>
                {canEdit && (
                  <Td className="whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => open(p)}>
                      تعديل
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleArchive(p)}>
                      {p.isArchived ? 'استعادة' : 'أرشفة'}
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'تعديل منتج' : 'منتج جديد'}
        wide
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="اسم المنتج" error={errors.name} className="sm:col-span-2">
              <Input value={fm.name} onChange={set('name')} />
            </Field>
            <Field label="SKU" error={errors.sku}>
              <Input dir="ltr" value={fm.sku} onChange={set('sku')} />
            </Field>
            <Field label="الباركود" error={errors.barcode} hint="امسحه بالسكانر وسيُملأ تلقائياً">
              <Input dir="ltr" value={fm.barcode} onChange={set('barcode')} />
            </Field>
            <Field label="الفئة" error={errors.category}>
              <Input value={fm.category} onChange={set('category')} />
            </Field>
            <Field label="الوحدة">
              <Input value={fm.unit} onChange={set('unit')} />
            </Field>
            <Field label="السعر" error={errors.price}>
              <Input dir="ltr" type="number" step="0.01" min="0" value={fm.price} onChange={set('price')} />
            </Field>
            <Field label="التكلفة" error={errors.cost}>
              <Input dir="ltr" type="number" step="0.01" min="0" value={fm.cost} onChange={set('cost')} />
            </Field>
            <Field label="الحد الأدنى للتنبيه" error={errors.minStockAlert} hint="تنبيه عند انخفاض المتاح (البرتقالي) عن هذا الرقم">
              <Input dir="ltr" type="number" min="0" value={fm.minStockAlert} onChange={set('minStockAlert')} />
            </Field>
            <Field label="رابط صورة (اختياري)" error={errors.imageUrl}>
              <Input dir="ltr" value={fm.imageUrl} onChange={set('imageUrl')} />
            </Field>
            <div className="sm:col-span-2">
              <Checkbox
                label="تتبع كل قطعة برقم تسلسلي (لا يمكن تغييره بعد أول حركة)"
                checked={fm.trackUnits}
                onChange={(v) => setEditing((s) => (s ? { ...s, form: { ...s.form, trackUnits: v } } : s))}
              />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
