'use client';

import { useEffect, useRef, useState } from 'react';
import { isValidEan13 } from '@/lib/domain';
import { qs } from '@/lib/client/api';
import { useApi, useDebounce } from '@/lib/client/hooks';
import type { Paged, Product } from '@/lib/client/types';
import { useApp } from '@/components/providers';
import { Button, Card, Field, Input, PageHeader, QuantityStepper, Select } from '@/components/ui';

type Format = 'CODE128' | 'EAN13' | 'QR';

function Label({ product, format, widthMm, heightMm }: { product: Product; format: Format; widthMm: number; heightMm: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [qr, setQr] = useState<string | null>(null);
  const effective: Format = format === 'EAN13' && !isValidEan13(product.barcode) ? 'CODE128' : format;

  useEffect(() => {
    let cancelled = false;
    if (effective === 'QR') {
      import('qrcode').then((QR) => QR.toDataURL(product.barcode, { margin: 0, width: 256 })).then((u) => !cancelled && setQr(u));
    } else if (svgRef.current) {
      import('jsbarcode').then(({ default: JsBarcode }) => {
        if (cancelled || !svgRef.current) return;
        JsBarcode(svgRef.current, product.barcode, {
          format: effective === 'EAN13' ? 'EAN13' : 'CODE128',
          displayValue: true,
          fontSize: 14,
          margin: 0,
          height: 40,
          width: 1.6,
        });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [product.barcode, effective]);

  return (
    <div
      className="flex break-inside-avoid flex-col items-center justify-between overflow-hidden border border-dashed border-slate-300 bg-white p-1 text-center print:border-slate-200"
      style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}
    >
      <p className="w-full truncate text-[9pt] font-bold leading-tight">{product.name}</p>
      {effective === 'QR' ? (
        // eslint-disable-next-line @next/next/no-img-element
        qr && <img src={qr} alt={product.barcode} style={{ height: `${heightMm * 0.62}mm` }} />
      ) : (
        <svg ref={svgRef} style={{ maxWidth: '100%', maxHeight: `${heightMm * 0.7}mm` }} />
      )}
      {effective === 'QR' && <p className="ltr font-mono text-[7pt]">{product.barcode}</p>}
    </div>
  );
}

export default function LabelsPage() {
  const { settings } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);
  const [format, setFormat] = useState<Format>(settings.barcodeFormat);
  const [w, setW] = useState(settings.labelWidthMm);
  const [h, setH] = useState(settings.labelHeightMm);
  const [selected, setSelected] = useState<Record<string, { product: Product; copies: number }>>({});
  const { data } = useApi<Paged<Product>>(`/api/products${qs({ q: dq, pageSize: 30 })}`);
  const labels = Object.values(selected).flatMap((s) => Array.from({ length: s.copies }, (_, i) => ({ key: `${s.product.id}-${i}`, product: s.product })));

  return (
    <>
      <PageHeader
        title="ملصقات الباركود"
        subtitle="اختر المنتجات وعدد النسخ ثم اطبع"
        actions={
          <Button onClick={() => window.print()} disabled={labels.length === 0}>
            طباعة {labels.length} ملصق
          </Button>
        }
      />
      <div className="no-print grid gap-4 lg:grid-cols-3">
        <Card title="المنتجات" className="lg:col-span-2">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث عن منتج" />
          <ul className="mt-3 max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {data?.items.map((p) => {
              const s = selected[p.id];
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <b>{p.name}</b> <span className="ltr font-mono text-xs text-slate-500">{p.barcode}</span>
                  </span>
                  {s ? (
                    <span className="flex items-center gap-2">
                      <QuantityStepper value={s.copies} max={500} onChange={(v) => setSelected((x) => ({ ...x, [p.id]: { product: p, copies: v } }))} />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setSelected((x) => {
                            const n = { ...x };
                            delete n[p.id];
                            return n;
                          })
                        }
                      >
                        إزالة
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setSelected((x) => ({ ...x, [p.id]: { product: p, copies: 1 } }))}>
                      إضافة
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="إعدادات الملصق">
          <div className="space-y-3">
            <Field label="نوع الباركود" hint="EAN-13 يُستخدم فقط للباركودات الصحيحة ذات 13 رقماً، وإلا يُطبع Code128">
              <Select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                <option value="CODE128">Code 128</option>
                <option value="EAN13">EAN-13</option>
                <option value="QR">QR</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="العرض (مم)">
                <Input dir="ltr" type="number" min={20} max={150} value={w} onChange={(e) => setW(Number(e.target.value) || 50)} />
              </Field>
              <Field label="الارتفاع (مم)">
                <Input dir="ltr" type="number" min={10} max={150} value={h} onChange={(e) => setH(Number(e.target.value) || 30)} />
              </Field>
            </div>
          </div>
        </Card>
      </div>
      <div className="print-area mt-4 flex flex-wrap gap-[2mm]">
        {labels.map((l) => (
          <Label key={l.key} product={l.product} format={format} widthMm={w} heightMm={h} />
        ))}
      </div>
    </>
  );
}
