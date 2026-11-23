'use client';

import Link from 'next/link';
import { useState } from 'react';
import { COLORS, COLOR_META, type StockColor } from '@/lib/domain';
import { qs } from '@/lib/client/api';
import { useApi, useDebounce } from '@/lib/client/hooks';
import { ColorBar, ColorChip, ColorIcon, ColorSummary, type ColorTotals } from '@/components/colors';
import { MovementsDrawer, type MovementFilter } from '@/components/movements';
import { PointSelect } from '@/components/pickers';
import { useApp } from '@/components/providers';
import { useBarcodeScanner } from '@/components/scanner/use-barcode-scanner';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Field, Input, Loading, PageHeader, Pagination, Select, Table, Td, Th, cx } from '@/components/ui';

interface Item {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  unit: string;
  price: string;
  minStockAlert: number;
  trackUnits: boolean;
  colors: ColorTotals;
  lowStock: boolean;
}

interface View {
  items: Item[];
  totals: ColorTotals;
  categories: string[];
  pointId: string | null;
  page: number;
  pageSize: number;
  total: number;
}

export function WarehouseView({ initialColor, initialQ }: { initialColor: StockColor | null; initialQ: string }) {
  const { f, user } = useApp();
  const [q, setQ] = useState(initialQ);
  const [color, setColor] = useState<StockColor | null>(initialColor);
  const [category, setCategory] = useState('');
  const [pointId, setPointId] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<'cards' | 'table'>('cards');
  const [drawer, setDrawer] = useState<{ title: string; filter: MovementFilter } | null>(null);
  const dq = useDebounce(q, 300);
  const scoped = user.role !== 'ADMIN' && !!user.deliveryPointId;

  const url = `/api/warehouse${qs({ q: dq, color, category, pointId: scoped ? undefined : pointId, lowOnly: lowOnly ? '1' : undefined, page, pageSize: 48 })}`;
  // تحديث فوري للأرقام كل 15 ثانية
  const { data, error, loading, reload } = useApi<View>(url, { refreshMs: 15_000 });

  // مسح الباركود بالسكانر الخارجي في هذه الشاشة = بحث فوري
  useBarcodeScanner((code) => {
    setQ(code);
    setPage(1);
  });

  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  function openColor(item: Item, c: StockColor) {
    setDrawer({
      title: `${item.name} — ${COLOR_META[c].label}`,
      filter: { productId: item.id, color: c, pointId: data?.pointId ?? undefined },
    });
  }

  return (
    <>
      <PageHeader
        title="المستودع بالألوان"
        subtitle="حالة كل منتج وكمياته لحظياً. اضغط على أي لون لعرض حركاته."
        actions={
          <div className="flex rounded-xl border border-slate-300 bg-white p-1" role="group" aria-label="طريقة العرض">
            {(['cards', 'table'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={cx('min-h-9 rounded-lg px-3 text-sm font-bold', mode === m ? 'bg-slate-900 text-white' : 'text-slate-600')}
              >
                {m === 'cards' ? 'بطاقات' : 'جدول'}
              </button>
            ))}
          </div>
        }
      />

      {data && <ColorSummary totals={data.totals} active={color} onSelect={(c) => reset(() => setColor(c))} />}

      <Card className="mt-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="بحث" className="sm:col-span-2 lg:col-span-1">
            <Input value={q} onChange={(e) => reset(() => setQ(e.target.value))} placeholder="الاسم أو SKU أو الباركود (أو امسح)" type="search" />
          </Field>
          <Field label="اللون">
            <Select value={color ?? ''} onChange={(e) => reset(() => setColor((e.target.value || null) as StockColor | null))}>
              <option value="">كل الألوان</option>
              {COLORS.map((c) => (
                <option key={c} value={c}>
                  {COLOR_META[c].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="الفئة">
            <Select value={category} onChange={(e) => reset(() => setCategory(e.target.value))}>
              <option value="">كل الفئات</option>
              {data?.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          {!scoped && <PointSelect value={pointId} onChange={(v) => reset(() => setPointId(v))} allowAll locked={false} activeOnly={false} />}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Checkbox label="المنتجات تحت الحد الأدنى فقط" checked={lowOnly} onChange={(v) => reset(() => setLowOnly(v))} />
          {(q || color || category || pointId || lowOnly) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                reset(() => {
                  setQ('');
                  setColor(null);
                  setCategory('');
                  setPointId('');
                  setLowOnly(false);
                })
              }
            >
              مسح الفلاتر
            </Button>
          )}
        </div>
      </Card>

      <div className="mt-4">
        {loading && !data && <Loading />}
        <ErrorBox error={error} onRetry={reload} />
        {data && data.items.length === 0 && <EmptyState title="لا توجد منتجات مطابقة" hint="غيّر الفلاتر أو أضف منتجات جديدة" />}

        {data && data.items.length > 0 && mode === 'cards' && (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((it) => (
              <li key={it.id} className={cx('rounded-2xl border bg-white p-4 shadow-sm', it.lowStock ? 'border-amber-300' : 'border-slate-200')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{it.name}</p>
                    <p className="text-xs text-slate-500">
                      {it.category} · <span className="ltr font-mono">{it.sku}</span>
                    </p>
                  </div>
                  {it.lowStock && <Badge className="border-amber-300 bg-amber-100 text-amber-900">منخفض</Badge>}
                </div>
                <div className="my-3">
                  <ColorBar totals={it.colors} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {COLORS.map((c) => (
                    <ColorChip key={c} color={c} count={it.colors[c]} onClick={() => openColor(it, c)} active={color === c} />
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  الحد الأدنى: {f.n(it.minStockAlert)} · الباركود: <span className="ltr font-mono">{it.barcode}</span>
                </p>
              </li>
            ))}
          </ul>
        )}

        {data && data.items.length > 0 && mode === 'table' && (
          <Table>
            <thead>
              <tr>
                <Th>المنتج</Th>
                <Th>SKU</Th>
                <Th>الفئة</Th>
                {COLORS.map((c) => (
                  <Th key={c} className="text-center">
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden className={cx('flex h-4 w-4 items-center justify-center rounded-full', COLOR_META[c].solid)}>
                        <ColorIcon color={c} className="h-2.5 w-2.5" />
                      </span>
                      {COLOR_META[c].label}
                    </span>
                  </Th>
                ))}
                <Th>الحد الأدنى</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.id} className={it.lowStock ? 'bg-amber-50' : ''}>
                  <Td className="font-semibold">{it.name}</Td>
                  <Td className="ltr font-mono text-xs">{it.sku}</Td>
                  <Td className="text-xs">{it.category}</Td>
                  {COLORS.map((c) => (
                    <Td key={c} className="text-center">
                      <button
                        onClick={() => openColor(it, c)}
                        className={cx('min-h-9 min-w-12 rounded-lg border px-2 font-black tabular-nums', COLOR_META[c].chip, it.colors[c] === 0 && 'opacity-40')}
                        aria-label={`${COLOR_META[c].label}: ${it.colors[c]} — عرض الحركات`}
                      >
                        {f.n(it.colors[c])}
                      </button>
                    </Td>
                  ))}
                  <Td>{f.n(it.minStockAlert)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
        {data && (
          <p className="mt-3 text-center text-xs text-slate-500">
            {f.n(data.total)} منتج · يتحدث تلقائياً كل 15 ثانية ·{' '}
            <Link href="/stock-in" className="font-bold underline">
              إدخال مخزون
            </Link>
          </p>
        )}
      </div>

      <MovementsDrawer open={!!drawer} onClose={() => setDrawer(null)} title={drawer?.title ?? ''} filter={drawer?.filter ?? {}} />
    </>
  );
}
