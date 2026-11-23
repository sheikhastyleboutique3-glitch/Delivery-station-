'use client';

import { useCallback, useState } from 'react';
import type { ScanSource } from '@/lib/domain';
import type { LookupProduct, LookupResult } from './scanner/scan-box';
import { Badge, Button, QuantityStepper } from './ui';
import { useApp } from './providers';

export interface Line<X = Record<string, unknown>> {
  key: string;
  product: Pick<LookupProduct, 'id' | 'name' | 'sku' | 'barcode' | 'unit' | 'trackUnits'>;
  quantity: number;
  unitSerials: string[];
  scannedBarcode: string | null;
  scanSource: ScanSource | null;
  extra: X;
}

/**
 * قائمة أصناف العملية. مسح نفس الباركود مرة ثانية يزيد الكمية ولا يكرر السطر.
 * المنتجات المتتبعة بالقطعة تُضاف بمسح الرقم التسلسلي لكل قطعة.
 */
export function useLines<X extends Record<string, unknown>>(defaultExtra: () => X) {
  const { toast } = useApp();
  const [lines, setLines] = useState<Line<X>[]>([]);

  const addFromLookup = useCallback(
    (r: Extract<LookupResult, { found: true }>, source: ScanSource, opts?: { max?: number }) => {
      const p = r.product;
      if (p.trackUnits && !r.unit) {
        toast(`"${p.name}" يُتتبع بالقطعة: امسح الرقم التسلسلي الملصق على القطعة`, 'error');
        return;
      }
      setLines((prev) => {
        const idx = prev.findIndex((l) => l.product.id === p.id);
        if (idx >= 0) {
          const l = prev[idx];
          if (r.unit) {
            if (l.unitSerials.includes(r.unit.serial)) {
              toast(`القطعة ${r.unit.serial} ممسوحة مسبقاً`, 'info');
              return prev;
            }
            const serials = [...l.unitSerials, r.unit.serial];
            const next = [...prev];
            next[idx] = { ...l, unitSerials: serials, quantity: serials.length };
            return next;
          }
          if (opts?.max !== undefined && l.quantity + 1 > opts.max) {
            toast(`لا يمكن تجاوز الكمية المتاحة (${opts.max}) من "${p.name}"`, 'error');
            return prev;
          }
          const next = [...prev];
          next[idx] = { ...l, quantity: l.quantity + 1 };
          // انقل السطر لأعلى القائمة ليراه المستخدم فوراً
          next.unshift(next.splice(idx, 1)[0]);
          return next;
        }
        return [
          {
            key: `${p.id}-${Date.now()}`,
            product: { id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, unit: p.unit, trackUnits: p.trackUnits },
            quantity: 1,
            unitSerials: r.unit ? [r.unit.serial] : [],
            scannedBarcode: r.code,
            scanSource: source,
            extra: defaultExtra(),
          },
          ...prev,
        ];
      });
    },
    [toast, defaultExtra],
  );

  const addProduct = useCallback(
    (product: Line<X>['product'], quantity = 1, extra?: Partial<X>) => {
      setLines((prev) => {
        const idx = prev.findIndex((l) => l.product.id === product.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...prev[idx], quantity: prev[idx].quantity + quantity };
          return next;
        }
        return [
          { key: `${product.id}-${Date.now()}`, product, quantity, unitSerials: [], scannedBarcode: null, scanSource: 'MANUAL', extra: { ...defaultExtra(), ...extra } },
          ...prev,
        ];
      });
    },
    [defaultExtra],
  );

  const update = useCallback((key: string, patch: Partial<Line<X>> | ((l: Line<X>) => Partial<Line<X>>)) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...(typeof patch === 'function' ? patch(l) : patch) } : l)));
  }, []);

  const remove = useCallback((key: string) => setLines((prev) => prev.filter((l) => l.key !== key)), []);
  const clear = useCallback(() => setLines([]), []);

  const toPayload = useCallback(
    (mapExtra?: (l: Line<X>) => Record<string, unknown>) =>
      lines.map((l) => ({
        productId: l.product.id,
        quantity: l.quantity,
        unitSerials: l.unitSerials,
        scannedBarcode: l.scannedBarcode,
        scanSource: l.scanSource,
        ...(mapExtra ? mapExtra(l) : {}),
      })),
    [lines],
  );

  return { lines, setLines, addFromLookup, addProduct, update, remove, clear, toPayload };
}

export function LinesList<X extends Record<string, unknown>>({
  lines,
  onQty,
  onRemove,
  onRemoveSerial,
  maxFor,
  renderExtra,
  empty = 'لم تتم إضافة أي منتج بعد. امسح الباركود للبدء.',
}: {
  lines: Line<X>[];
  onQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
  onRemoveSerial?: (key: string, serial: string) => void;
  maxFor?: (l: Line<X>) => number | undefined;
  renderExtra?: (l: Line<X>) => React.ReactNode;
  empty?: string;
}) {
  const { f } = useApp();
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  if (lines.length === 0) {
    return <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">{empty}</p>;
  }
  return (
    <div>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {lines.map((l) => {
          const max = maxFor?.(l);
          const over = max !== undefined && l.quantity > max;
          return (
            <li key={l.key} className={`p-3 ${over ? 'bg-red-50' : ''}`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{l.product.name}</p>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="ltr font-mono">{l.product.sku}</span>
                    {max !== undefined && (
                      <span className={over ? 'font-bold text-red-700' : ''}>
                        المتاح: {f.n(max)}
                      </span>
                    )}
                    {l.product.trackUnits && <Badge>بالقطعة</Badge>}
                  </p>
                </div>
                {l.product.trackUnits ? (
                  <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-black">{f.n(l.quantity)}</span>
                ) : (
                  <QuantityStepper value={l.quantity} onChange={(v) => onQty(l.key, v)} max={max} />
                )}
                <Button variant="ghost" size="sm" onClick={() => onRemove(l.key)} aria-label={`حذف ${l.product.name}`}>
                  حذف
                </Button>
              </div>
              {l.unitSerials.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {l.unitSerials.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onRemoveSerial?.(l.key, s)}
                      className="ltr rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs hover:border-red-400 hover:text-red-700"
                      title="إزالة القطعة"
                    >
                      {s} ×
                    </button>
                  ))}
                </div>
              )}
              {renderExtra && <div className="mt-2">{renderExtra(l)}</div>}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-sm font-semibold text-slate-600">
        {f.n(lines.length)} صنف · إجمالي الكمية {f.n(totalQty)}
      </p>
    </div>
  );
}

export function removeSerialPatch<X>(l: Line<X>, serial: string): Partial<Line<X>> {
  const serials = l.unitSerials.filter((s) => s !== serial);
  return { unitSerials: serials, quantity: serials.length };
}
