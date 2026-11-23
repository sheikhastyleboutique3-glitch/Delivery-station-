'use client';

import { useRef, useState } from 'react';
import { apiSend, enqueue, newIdempotencyKey, qs, type ApiError } from '@/lib/client/api';
import { useApi, useDebounce } from '@/lib/client/hooks';
import type { Custody, Customer, Operation, Paged } from '@/lib/client/types';
import { useApp } from './providers';
import { ScanBox } from './scanner/scan-box';
import { Button, Field, Input, QuantityStepper, Tabs, Textarea } from './ui';

/**
 * تسجيل تسليم للعميل (أزرق ← أخضر). يُستخدم في تطبيق السائق وفي ملف السائق.
 * عند انقطاع الإنترنت (offlineQueue) يُحفظ الطلب على الجهاز بنفس مفتاح منع التكرار.
 */
export function DeliveryForm({
  driverId,
  custody,
  onDone,
  offlineQueue,
}: {
  driverId: string;
  custody: Custody;
  onDone: (op: Operation | null) => void;
  offlineQueue?: boolean;
}) {
  const { f, toast } = useApp();
  const keyRef = useRef(newIdempotencyKey());
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState('');
  const [newC, setNewC] = useState({ name: '', phone: '', address: '', deliveryNotes: '' });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const dq = useDebounce(search, 300);
  const { data: results } = useApi<Paged<Customer>>(mode === 'existing' && !customer && dq.length >= 2 ? `/api/customers${qs({ q: dq, pageSize: 8 })}` : null);

  // نجمع العهدة حسب المنتج (قد تكون من أكثر من نقطة)
  const products = Object.values(
    custody.lines.reduce<Record<string, { id: string; name: string; sku: string; trackUnits: boolean; max: number; serials: string[] }>>((acc, l) => {
      acc[l.productId] ??= { id: l.productId, name: l.productName, sku: l.sku, trackUnits: l.trackUnits, max: 0, serials: [] };
      acc[l.productId].max += l.quantity;
      acc[l.productId].serials.push(...l.serials);
      return acc;
    }, {}),
  );

  const lines = products
    .map((p) => (p.trackUnits ? { productId: p.id, quantity: (serials[p.id] ?? []).length, unitSerials: serials[p.id] ?? [] } : { productId: p.id, quantity: qty[p.id] ?? 0, unitSerials: [] as string[] }))
    .filter((l) => l.quantity > 0);
  const total = lines.reduce((s, l) => s + l.quantity, 0);
  const customerOk = mode === 'existing' ? !!customer : newC.name.trim().length > 0 && newC.phone.trim().length >= 6;

  async function submit() {
    const body = {
      idempotencyKey: keyRef.current,
      driverId,
      customerId: mode === 'existing' ? customer?.id : null,
      newCustomer: mode === 'new' ? { ...newC, address: newC.address || null, deliveryNotes: newC.deliveryNotes || null } : null,
      lines: lines.map((l) => ({ ...l, scanSource: 'MANUAL' })),
      notes: notes || null,
    };
    setBusy(true);
    try {
      const op = await apiSend<Operation>('POST', '/api/stock/deliver', body);
      toast(`تم تسجيل التسليم ${op.opNo}`);
      keyRef.current = newIdempotencyKey();
      onDone(op);
    } catch (err) {
      const e = err as ApiError;
      if (e.isNetwork && offlineQueue) {
        enqueue({ id: body.idempotencyKey, url: '/api/stock/deliver', body, label: `تسليم ${total} قطعة`, queuedAt: new Date().toISOString() });
        toast('لا يوجد اتصال: حُفظ التسليم على الجهاز وسيُرسل تلقائياً', 'info');
        keyRef.current = newIdempotencyKey();
        onDone(null);
      } else {
        toast(e.messageAr, 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-bold">العميل</p>
        <Tabs
          tabs={[
            { key: 'existing', label: 'عميل مسجّل' },
            { key: 'new', label: 'عميل جديد' },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'existing' ? (
          customer ? (
            <div className="flex items-center justify-between rounded-xl bg-green-50 p-3 text-sm">
              <span>
                <b>{customer.name}</b> · <span className="ltr">{customer.phone}</span>
                {customer.address && <span className="block text-xs text-slate-600">{customer.address}</span>}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setCustomer(null)}>
                تغيير
              </Button>
            </div>
          ) : (
            <>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو رقم الهاتف" type="search" />
              <ul>
                {results?.items.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setCustomer(c)} className="flex min-h-12 w-full items-center justify-between rounded-lg px-2 text-sm hover:bg-slate-50">
                      <span className="font-semibold">{c.name}</span>
                      <span className="ltr text-slate-500">{c.phone}</span>
                    </button>
                  </li>
                ))}
                {results && results.items.length === 0 && (
                  <li className="p-2 text-sm text-slate-500">
                    لا يوجد عميل مطابق.{' '}
                    <button className="font-bold text-blue-700 underline" onClick={() => setMode('new')}>
                      أضف عميلاً جديداً
                    </button>
                  </li>
                )}
              </ul>
            </>
          )
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="الاسم">
              <Input value={newC.name} onChange={(e) => setNewC({ ...newC, name: e.target.value })} />
            </Field>
            <Field label="الهاتف">
              <Input dir="ltr" inputMode="tel" value={newC.phone} onChange={(e) => setNewC({ ...newC, phone: e.target.value })} />
            </Field>
            <Field label="العنوان" className="sm:col-span-2">
              <Input value={newC.address} onChange={(e) => setNewC({ ...newC, address: e.target.value })} />
            </Field>
            <Field label="ملاحظات التوصيل" className="sm:col-span-2">
              <Input value={newC.deliveryNotes} onChange={(e) => setNewC({ ...newC, deliveryNotes: e.target.value })} />
            </Field>
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-bold">المنتجات المسلّمة</p>
        <ScanBox
          placeholder="امسح باركود المنتج المسلّم"
          onResult={(r) => {
            const p = products.find((x) => x.id === r.product.id);
            if (!p) return toast(`"${r.product.name}" ليس في عهدتك`, 'error');
            if (p.trackUnits) {
              if (!r.unit) return toast('امسح الرقم التسلسلي للقطعة', 'error');
              if (!p.serials.includes(r.unit.serial)) return toast(`القطعة ${r.unit.serial} ليست في عهدتك`, 'error');
              setSerials((s) => ({ ...s, [p.id]: [...new Set([...(s[p.id] ?? []), r.unit!.serial])] }));
            } else {
              setQty((q) => ({ ...q, [p.id]: Math.min(p.max, (q[p.id] ?? 0) + 1) }));
            }
          }}
        />
        <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {products.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="font-bold">{p.name}</p>
                <p className="text-xs text-slate-500">في العهدة: {f.n(p.max)}</p>
              </div>
              {p.trackUnits ? (
                <div className="flex flex-wrap gap-1">
                  {p.serials.map((s) => {
                    const on = (serials[p.id] ?? []).includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSerials((x) => ({ ...x, [p.id]: on ? (x[p.id] ?? []).filter((y) => y !== s) : [...(x[p.id] ?? []), s] }))}
                        className={`ltr min-h-9 rounded-md border px-2 font-mono text-xs ${on ? 'border-green-600 bg-green-600 text-white' : 'border-slate-300'}`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <QuantityStepper value={qty[p.id] ?? 0} min={0} max={p.max} onChange={(v) => setQty((q) => ({ ...q, [p.id]: v }))} />
              )}
            </li>
          ))}
        </ul>
      </div>

      <Field label="ملاحظات (اختياري)">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => onDone(null)}>
          إلغاء
        </Button>
        <Button variant="success" size="lg" onClick={submit} loading={busy} disabled={!customerOk || total === 0}>
          تأكيد تسليم {f.n(total)} قطعة
        </Button>
      </div>
    </div>
  );
}
