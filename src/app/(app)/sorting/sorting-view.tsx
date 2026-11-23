'use client';

import { useState } from 'react';
import { COLOR_META } from '@/lib/domain';
import { qs } from '@/lib/client/api';
import { useApi, useDebounce } from '@/lib/client/hooks';
import { ColorChip, type ColorTotals } from '@/components/colors';
import { MovementsDrawer } from '@/components/movements';
import { useOperationSubmit } from '@/components/op-submit';
import { PointSelect } from '@/components/pickers';
import { useApp } from '@/components/providers';
import { useBarcodeScanner } from '@/components/scanner/use-barcode-scanner';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, QuantityStepper, Tabs } from '@/components/ui';

interface Item {
  id: string;
  name: string;
  sku: string;
  trackUnits: boolean;
  colors: ColorTotals;
}

type Pending = { item: Item; action: 'AVAILABLE' | 'DAMAGED' | 'RESTOCK' | 'WRITE_OFF'; quantity: number; reason: string; serials: string };

const ACTION_LABEL: Record<Pending['action'], string> = {
  AVAILABLE: 'إعادة إتاحة (← برتقالي)',
  DAMAGED: 'تالف (← أحمر)',
  RESTOCK: 'تمت المعالجة: إعادة إتاحة (← برتقالي)',
  WRITE_OFF: 'شطب نهائي من المخزون',
};

export function SortingView({ initialTab }: { initialTab: 'purple' | 'red' }) {
  const { user, f, toast } = useApp();
  const [tab, setTab] = useState<'purple' | 'red'>(initialTab);
  const [pointId, setPointId] = useState('');
  const [q, setQ] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [history, setHistory] = useState<Item | null>(null);
  const dq = useDebounce(q, 300);
  const color = tab === 'purple' ? 'PURPLE' : 'RED';
  const { data, error, loading, reload } = useApi<{ items: Item[] }>(
    pointId ? `/api/warehouse${qs({ color, pointId: user.role === 'ADMIN' || !user.deliveryPointId ? pointId : undefined, q: dq, pageSize: 100 })}` : null,
    { refreshMs: 15_000 },
  );
  const sort = useOperationSubmit('sort');
  const resolve = useOperationSubmit('resolve-red');
  const isAdmin = user.role === 'ADMIN';

  useBarcodeScanner((code) => setQ(code));

  async function confirm() {
    if (!pending) return;
    const serials = pending.serials.split(/[\s,]+/).filter(Boolean);
    const line = {
      productId: pending.item.id,
      quantity: pending.item.trackUnits ? serials.length : pending.quantity,
      unitSerials: serials,
      reason: pending.reason || null,
    };
    const res =
      pending.action === 'AVAILABLE' || pending.action === 'DAMAGED'
        ? await sort.submit({ pointId, lines: [{ ...line, result: pending.action }] })
        : await resolve.submit({ pointId, lines: [{ ...line, action: pending.action }] });
    if (res) {
      setPending(null);
      reload();
    }
  }

  const needsReason = pending && pending.action !== 'AVAILABLE';
  const items = data?.items ?? [];

  return (
    <>
      <PageHeader title="الفرز والمعالجة" subtitle="فرز المرتجعات السليمة (البنفسجي) ومعالجة التالف (الأحمر)" />
      <Tabs
        tabs={[
          { key: 'purple', label: 'بانتظار الفرز (بنفسجي)' },
          { key: 'red', label: 'تالف / ناقص (أحمر)' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <PointSelect value={pointId} onChange={setPointId} />
          <Field label="بحث">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="الاسم أو SKU أو امسح الباركود" type="search" />
          </Field>
        </div>
        {tab === 'red' && !isAdmin && (
          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">معالجة الأحمر (إعادة الإتاحة أو الشطب) من صلاحية مدير النظام فقط. يمكنك عرض القائمة وسجل كل منتج.</p>
        )}
      </Card>

      <div className="mt-4">
        {loading && !data && <Loading />}
        <ErrorBox error={error} onRetry={reload} />
        {data && items.length === 0 && <EmptyState title={tab === 'purple' ? 'لا توجد مرتجعات بانتظار الفرز' : 'لا توجد قطع تالفة'} />}
        <ul className="grid gap-3 md:grid-cols-2">
          {items.map((it) => (
            <li key={it.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold">{it.name}</p>
                  <p className="ltr text-start font-mono text-xs text-slate-500">{it.sku}</p>
                </div>
                <ColorChip color={color} count={it.colors[color]} onClick={() => setHistory(it)} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {tab === 'purple' ? (
                  <>
                    <Button variant="success" size="sm" onClick={() => setPending({ item: it, action: 'AVAILABLE', quantity: it.colors.PURPLE, reason: '', serials: '' })}>
                      إعادة إتاحة
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => setPending({ item: it, action: 'DAMAGED', quantity: 1, reason: '', serials: '' })}>
                      تالف
                    </Button>
                  </>
                ) : (
                  isAdmin && (
                    <>
                      <Button variant="success" size="sm" onClick={() => setPending({ item: it, action: 'RESTOCK', quantity: 1, reason: '', serials: '' })}>
                        تمت المعالجة — إعادة إتاحة
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => setPending({ item: it, action: 'WRITE_OFF', quantity: it.colors.RED, reason: '', serials: '' })}>
                        شطب
                      </Button>
                    </>
                  )
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Modal
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending ? ACTION_LABEL[pending.action] : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>
              إلغاء
            </Button>
            <Button
              variant={pending?.action === 'WRITE_OFF' || pending?.action === 'DAMAGED' ? 'danger' : 'success'}
              loading={sort.busy || resolve.busy}
              disabled={!!needsReason && !pending?.reason.trim()}
              onClick={() => {
                if (pending?.action === 'WRITE_OFF' && !window.confirm('الشطب لا يمكن التراجع عنه. هل أنت متأكد؟')) return;
                confirm().catch(() => toast('تعذر الحفظ', 'error'));
              }}
            >
              تأكيد
            </Button>
          </>
        }
      >
        {pending && (
          <div className="space-y-3">
            <p className="font-bold">{pending.item.name}</p>
            {pending.item.trackUnits ? (
              <Field label="الأرقام التسلسلية (افصل بمسافة)">
                <Input dir="ltr" value={pending.serials} onChange={(e) => setPending({ ...pending, serials: e.target.value })} />
              </Field>
            ) : (
              <Field label={`الكمية (المتاح ${f.n(pending.item.colors[color])})`}>
                <QuantityStepper value={pending.quantity} max={pending.item.colors[color]} onChange={(v) => setPending({ ...pending, quantity: v })} />
              </Field>
            )}
            <Field label={needsReason ? 'السبب (إلزامي)' : 'ملاحظة (اختياري)'}>
              <Input value={pending.reason} onChange={(e) => setPending({ ...pending, reason: e.target.value })} placeholder="مثال: تم الإصلاح، تلف غير قابل للإصلاح…" />
            </Field>
          </div>
        )}
      </Modal>

      <MovementsDrawer
        open={!!history}
        onClose={() => setHistory(null)}
        title={history ? `${history.name} — ${COLOR_META[color].label}` : ''}
        filter={{ productId: history?.id, color, pointId }}
      />
    </>
  );
}
