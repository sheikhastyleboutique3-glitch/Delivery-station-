'use client';

import { useCallback, useState } from 'react';
import { LinesList, removeSerialPatch, useLines } from '@/components/lines';
import { OpSuccess, useOperationSubmit } from '@/components/op-submit';
import { PointSelect } from '@/components/pickers';
import { ScanBox } from '@/components/scanner/scan-box';
import { useBalances } from '@/components/use-balances';
import { Button, Card, Field, PageHeader, Textarea } from '@/components/ui';

export default function TransfersPage() {
  const [fromPointId, setFrom] = useState('');
  const [toPointId, setTo] = useState('');
  const [notes, setNotes] = useState('');
  const L = useLines(useCallback(() => ({}), []));
  const op = useOperationSubmit('transfer');
  const balances = useBalances(fromPointId, L.lines.map((l) => l.product.id));
  const over = L.lines.some((l) => (balances.get(l.product.id, 'ORANGE') ?? Infinity) < l.quantity);

  async function save() {
    const res = await op.submit({ fromPointId, toPointId, lines: L.toPayload(), notes });
    if (res) L.clear();
  }

  if (op.result) return <OpSuccess op={op.result} onNew={op.reset} />;

  return (
    <>
      <PageHeader title="تحويل بين نقاط الدليفري" subtitle="ينقل كمية متاحة (برتقالي) من نقطة إلى أخرى في عملية واحدة" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="الأصناف">
          <ScanBox onResult={(r, src) => L.addFromLookup(r, src, { max: balances.get(r.product.id, 'ORANGE') })} />
          <div className="mt-4">
            <LinesList
              lines={L.lines}
              onQty={(k, q) => L.update(k, { quantity: q })}
              onRemove={L.remove}
              onRemoveSerial={(k, s) => L.update(k, (l) => removeSerialPatch(l, s))}
              maxFor={(l) => balances.get(l.product.id, 'ORANGE')}
            />
          </div>
        </Card>
        <Card title="بيانات التحويل">
          <div className="space-y-3">
            <PointSelect value={fromPointId} onChange={setFrom} label="من نقطة" />
            <PointSelect value={toPointId} onChange={setTo} label="إلى نقطة" allowAll emptyLabel="اختر نقطة الوجهة…" locked={false} />
            {fromPointId && fromPointId === toPointId && <p className="text-sm font-bold text-red-700">اختر نقطة وجهة مختلفة</p>}
            <Field label="ملاحظات (اختياري)">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Button
              className="w-full"
              size="lg"
              onClick={save}
              loading={op.busy}
              disabled={!fromPointId || !toPointId || fromPointId === toPointId || L.lines.length === 0 || over}
            >
              تأكيد التحويل
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
