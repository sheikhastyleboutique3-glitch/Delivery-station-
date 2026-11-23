'use client';

import { useCallback, useState } from 'react';
import { LinesList, removeSerialPatch, useLines } from '@/components/lines';
import { OpSuccess, useOperationSubmit } from '@/components/op-submit';
import { PointSelect } from '@/components/pickers';
import { useApp } from '@/components/providers';
import { ScanBox } from '@/components/scanner/scan-box';
import { Button, Card, Field, Input, LinkButton, PageHeader, Textarea } from '@/components/ui';

export default function StockInPage() {
  const { user } = useApp();
  const [pointId, setPointId] = useState('');
  const [notes, setNotes] = useState('');
  const [serialInput, setSerialInput] = useState<Record<string, string>>({});
  const [notFound, setNotFound] = useState<string | null>(null);
  const L = useLines(useCallback(() => ({}), []));
  const op = useOperationSubmit('stock-in');

  async function save() {
    const res = await op.submit({ pointId, lines: L.toPayload(), notes });
    if (res) {
      L.clear();
      setNotes('');
    }
  }

  if (op.result) return <OpSuccess op={op.result} onNew={op.reset} />;

  return (
    <>
      <PageHeader title="إدخال مخزون" subtitle="البضاعة المُدخلة تظهر باللون البرتقالي (متاح) فوراً" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="الأصناف">
          <ScanBox
            onResult={(r, src) => {
              setNotFound(null);
              if (r.product.trackUnits && !r.unit) {
                // منتج متتبع بالقطعة: أضف السطر ثم أدخل الأرقام التسلسلية الجديدة
                L.addProduct({ ...r.product }, 0);
                return;
              }
              L.addFromLookup(r, src);
            }}
            onNotFound={setNotFound}
          />
          {notFound && (user.role === 'ADMIN' || user.role === 'WAREHOUSE') && (
            <p className="mt-2 text-sm">
              <LinkButton href={`/products?new=${encodeURIComponent(notFound)}`} variant="secondary">
                + إضافة منتج جديد بالباركود {notFound}
              </LinkButton>
            </p>
          )}
          <div className="mt-4">
            <LinesList
              lines={L.lines}
              onQty={(k, q) => L.update(k, { quantity: q })}
              onRemove={L.remove}
              onRemoveSerial={(k, s) => L.update(k, (l) => removeSerialPatch(l, s))}
              renderExtra={(l) =>
                l.product.trackUnits ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const v = (serialInput[l.key] ?? '').trim();
                      if (!v) return;
                      const parts = v.split(/[\s,]+/).filter(Boolean);
                      L.update(l.key, (cur) => {
                        const serials = [...new Set([...cur.unitSerials, ...parts])];
                        return { unitSerials: serials, quantity: serials.length };
                      });
                      setSerialInput((s) => ({ ...s, [l.key]: '' }));
                    }}
                  >
                    <Input
                      dir="ltr"
                      placeholder="الأرقام التسلسلية للقطع الجديدة (امسح أو افصل بمسافة)"
                      value={serialInput[l.key] ?? ''}
                      onChange={(e) => setSerialInput((s) => ({ ...s, [l.key]: e.target.value }))}
                    />
                    <Button type="submit" variant="secondary">
                      إضافة
                    </Button>
                  </form>
                ) : null
              }
            />
          </div>
        </Card>
        <Card title="بيانات الإدخال">
          <div className="space-y-3">
            <PointSelect value={pointId} onChange={setPointId} label="نقطة الاستلام" />
            <Field label="ملاحظات (اختياري)">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="رقم فاتورة المورد، اسم المورد…" />
            </Field>
            <Button className="w-full" size="lg" onClick={save} loading={op.busy} disabled={!pointId || L.lines.length === 0 || L.lines.some((l) => l.quantity < 1)}>
              حفظ الإدخال
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
