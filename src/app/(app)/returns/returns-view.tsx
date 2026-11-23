'use client';

import { useCallback, useState } from 'react';
import { qs } from '@/lib/client/api';
import { useApi, useDebounce } from '@/lib/client/hooks';
import type { Custody, Customer, Paged } from '@/lib/client/types';
import type { AppSettings as Settings } from '@/lib/domain';
import { ColorChip } from '@/components/colors';
import { LinesList, removeSerialPatch, useLines, type Line } from '@/components/lines';
import { OpSuccess, useOperationSubmit } from '@/components/op-submit';
import { DriverSelect, PointSelect } from '@/components/pickers';
import { useApp } from '@/components/providers';
import { ScanBox } from '@/components/scanner/scan-box';
import { useBalances } from '@/components/use-balances';
import { Button, Card, Field, Input, PageHeader, Tabs, Textarea, cx } from '@/components/ui';

type Condition = 'GOOD' | 'DAMAGED' | 'MISSING';
type DriverExtra = { condition: Condition; reason: string };
type CustomerExtra = { condition: 'GOOD' | 'DAMAGED'; reason: string };

const CONDITIONS: { key: Condition; label: string; color: 'PURPLE' | 'RED' }[] = [
  { key: 'GOOD', label: 'سليمة', color: 'PURPLE' },
  { key: 'DAMAGED', label: 'تالفة / ناقصة', color: 'RED' },
  { key: 'MISSING', label: 'مفقودة', color: 'RED' },
];

function ConditionPicker<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="حالة القطعة">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={cx(
            'min-h-10 rounded-lg border px-3 text-sm font-bold',
            value === o.key ? (o.key === 'GOOD' ? 'border-purple-600 bg-purple-600 text-white' : 'border-red-600 bg-red-600 text-white') : 'border-slate-300 bg-white',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ReturnsView({ initialDriverId, initialTab }: { initialDriverId: string; initialTab: 'driver' | 'customer' }) {
  const [tab, setTab] = useState<'driver' | 'customer'>(initialTab);
  return (
    <>
      <PageHeader title="استلام المرتجعات" subtitle="السليم ينتقل إلى البنفسجي (بانتظار الفرز)، والتالف أو المفقود إلى الأحمر" />
      <Tabs
        tabs={[
          { key: 'driver', label: 'مرتجع من سائق' },
          { key: 'customer', label: 'مرتجع من عميل (بعد التسليم)' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'driver' ? <DriverReturn initialDriverId={initialDriverId} /> : <CustomerReturn />}
    </>
  );
}

function DriverReturn({ initialDriverId }: { initialDriverId: string }) {
  const { f } = useApp();
  const [pointId, setPointId] = useState('');
  const [driverId, setDriverId] = useState(initialDriverId);
  const [notes, setNotes] = useState('');
  const L = useLines<DriverExtra>(useCallback(() => ({ condition: 'GOOD' as Condition, reason: '' }), []));
  const op = useOperationSubmit('return');
  const { data: settings } = useApi<Settings>('/api/settings');
  const { data: custody, reload } = useApi<Custody>(driverId ? `/api/drivers/${driverId}/custody` : null);

  const custodyOf = (productId: string) =>
    custody ? custody.lines.filter((l) => l.productId === productId).reduce((s, l) => s + l.quantity, 0) : undefined;
  // مجموع الكمية المرتجعة لنفس المنتج عبر كل الحالات لا يتجاوز العهدة
  const usedOf = (productId: string, exceptKey?: string) =>
    L.lines.filter((l) => l.product.id === productId && l.key !== exceptKey).reduce((s, l) => s + l.quantity, 0);
  const invalid = L.lines.some((l) => {
    const max = custodyOf(l.product.id);
    return (max !== undefined && usedOf(l.product.id) > max) || (l.extra.condition !== 'GOOD' && !l.extra.reason.trim());
  });

  function addSplit(l: Line<DriverExtra>) {
    // تقسيم: نفس المنتج بحالة مختلفة (مثلاً 3 سليمة و1 تالفة)
    L.setLines((prev) => [
      ...prev,
      { ...l, key: `${l.product.id}-${Date.now()}`, quantity: 1, unitSerials: [], extra: { condition: 'DAMAGED', reason: '' } },
    ]);
  }

  async function save() {
    const res = await op.submit({
      driverId,
      receivingPointId: pointId,
      notes,
      lines: L.toPayload((l) => ({ condition: l.extra.condition, reason: l.extra.reason || null })),
    });
    if (res) {
      L.clear();
      setNotes('');
      reload();
    }
  }

  if (op.result) return <OpSuccess op={op.result} onNew={op.reset} />;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card title="عهدة السائق الحالية">
          {!driverId ? (
            <p className="text-sm text-slate-500">اختر السائق لعرض عهدته.</p>
          ) : !custody ? (
            <p className="text-sm text-slate-500">جارِ التحميل…</p>
          ) : custody.lines.length === 0 ? (
            <p className="text-sm text-slate-500">لا توجد عهدة لدى هذا السائق.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {custody.lines.map((c) => (
                <li key={`${c.productId}-${c.pointId}`} className="flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 p-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{c.productName}</p>
                    <p className="text-xs text-slate-600">
                      {c.pointName} · {f.since(c.since)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ColorChip color="BLUE" count={c.quantity} compact />
                    {!c.trackUnits && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          const used = usedOf(c.productId);
                          const left = (custodyOf(c.productId) ?? 0) - used;
                          if (left > 0)
                            L.addProduct({ id: c.productId, name: c.productName, sku: c.sku, barcode: c.barcode, unit: c.unit, trackUnits: c.trackUnits }, left);
                        }}
                      >
                        إرجاع الكل
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="الأصناف المرتجعة">
          <ScanBox onResult={(r, src) => L.addFromLookup(r, src, { max: custodyOf(r.product.id) })} disabled={!driverId} />
          <div className="mt-4">
            <LinesList
              lines={L.lines}
              onQty={(k, q) => L.update(k, { quantity: q })}
              onRemove={L.remove}
              onRemoveSerial={(k, s) => L.update(k, (l) => removeSerialPatch(l, s))}
              maxFor={(l) => {
                const m = custodyOf(l.product.id);
                return m === undefined ? undefined : m - usedOf(l.product.id, l.key);
              }}
              renderExtra={(l) => (
                <div className="space-y-2">
                  <ConditionPicker value={l.extra.condition} options={CONDITIONS} onChange={(c) => L.update(l.key, { extra: { ...l.extra, condition: c } })} />
                  {l.extra.condition !== 'GOOD' && (
                    <Input
                      placeholder="سبب الإرجاع (إلزامي): كسر، نقص قطعة، رفض العميل…"
                      value={l.extra.reason}
                      onChange={(e) => L.update(l.key, { extra: { ...l.extra, reason: e.target.value } })}
                      className={!l.extra.reason.trim() ? 'border-red-400' : ''}
                    />
                  )}
                  {!l.product.trackUnits && l.quantity > 1 && (
                    <button type="button" className="text-xs font-bold text-blue-700 underline" onClick={() => addSplit(l)}>
                      + جزء منها بحالة مختلفة
                    </button>
                  )}
                </div>
              )}
              empty="امسح المنتجات المرتجعة أو اضغط «إرجاع الكل» من العهدة"
            />
          </div>
        </Card>
      </div>

      <Card title="بيانات الاستلام">
        <div className="space-y-3">
          <PointSelect value={pointId} onChange={setPointId} label="نقطة الاستلام" />
          <DriverSelect value={driverId} onChange={(id) => { setDriverId(id); L.clear(); }} includeInactive />
          <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            القطع السليمة تذهب إلى{' '}
            {settings?.autoRestockGoodReturns ? <b>البرتقالي (متاح) مباشرة</b> : <b>البنفسجي (بانتظار الفرز)</b>} حسب إعدادات المستودع.
          </p>
          <Field label="ملاحظات (اختياري)">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {invalid && <p className="text-sm font-bold text-red-700">تحقق من الكميات وأسباب الإرجاع للقطع التالفة/المفقودة</p>}
          <Button className="w-full" size="lg" onClick={save} loading={op.busy} disabled={!pointId || !driverId || L.lines.length === 0 || invalid}>
            تأكيد الاستلام
          </Button>
        </div>
      </Card>
    </div>
  );
}

function CustomerReturn() {
  const [pointId, setPointId] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState('');
  const dq = useDebounce(search, 300);
  const { data: customers } = useApi<Paged<Customer>>(dq.length >= 2 && !customer ? `/api/customers${qs({ q: dq, pageSize: 8 })}` : null);
  const L = useLines<CustomerExtra>(useCallback(() => ({ condition: 'GOOD' as const, reason: '' }), []));
  const op = useOperationSubmit('customer-return');
  const balances = useBalances(pointId, L.lines.map((l) => l.product.id));
  const invalid = L.lines.some((l) => !l.extra.reason.trim() || (balances.get(l.product.id, 'GREEN') ?? Infinity) < l.quantity);

  async function save() {
    const res = await op.submit({
      receivingPointId: pointId,
      customerId: customer?.id ?? null,
      notes,
      lines: L.toPayload((l) => ({ condition: l.extra.condition, reason: l.extra.reason })),
    });
    if (res) {
      L.clear();
      setNotes('');
    }
  }

  if (op.result) return <OpSuccess op={op.result} onNew={op.reset} />;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2" title="الأصناف المرتجعة من العميل">
        <ScanBox onResult={(r, src) => L.addFromLookup(r, src)} />
        <div className="mt-4">
          <LinesList
            lines={L.lines}
            onQty={(k, q) => L.update(k, { quantity: q })}
            onRemove={L.remove}
            onRemoveSerial={(k, s) => L.update(k, (l) => removeSerialPatch(l, s))}
            maxFor={(l) => balances.get(l.product.id, 'GREEN')}
            renderExtra={(l) => (
              <div className="space-y-2">
                <ConditionPicker
                  value={l.extra.condition}
                  options={[
                    { key: 'GOOD' as const, label: 'سليمة' },
                    { key: 'DAMAGED' as const, label: 'تالفة' },
                  ]}
                  onChange={(c) => L.update(l.key, { extra: { ...l.extra, condition: c } })}
                />
                <Input
                  placeholder="سبب الإرجاع (إلزامي)"
                  value={l.extra.reason}
                  onChange={(e) => L.update(l.key, { extra: { ...l.extra, reason: e.target.value } })}
                  className={!l.extra.reason.trim() ? 'border-red-400' : ''}
                />
              </div>
            )}
          />
        </div>
      </Card>
      <Card title="بيانات المرتجع">
        <div className="space-y-3">
          <PointSelect value={pointId} onChange={setPointId} label="نقطة الاستلام" />
          <Field label="العميل (اختياري)">
            {customer ? (
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm">
                <span>
                  <b>{customer.name}</b> · <span className="ltr">{customer.phone}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => setCustomer(null)}>
                  تغيير
                </Button>
              </div>
            ) : (
              <>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو الهاتف" />
                {customers?.items.map((c) => (
                  <button key={c.id} type="button" onClick={() => setCustomer(c)} className="mt-1 flex min-h-11 w-full items-center justify-between rounded-lg px-2 text-sm hover:bg-slate-50">
                    <span>{c.name}</span>
                    <span className="ltr text-slate-500">{c.phone}</span>
                  </button>
                ))}
              </>
            )}
          </Field>
          <Field label="ملاحظات (اختياري)">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <p className="text-xs text-slate-500">تُخصم الكمية من الأخضر (المُسلّم) في نقطة الاستلام.</p>
          <Button className="w-full" size="lg" onClick={save} loading={op.busy} disabled={!pointId || L.lines.length === 0 || invalid}>
            تسجيل المرتجع
          </Button>
        </div>
      </Card>
    </div>
  );
}
