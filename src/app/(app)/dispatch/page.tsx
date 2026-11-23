'use client';

import { useCallback, useState } from 'react';
import type { Driver } from '@/lib/client/types';
import { LinesList, removeSerialPatch, useLines } from '@/components/lines';
import { OpSuccess, useOperationSubmit } from '@/components/op-submit';
import { DriverSelect, PointSelect } from '@/components/pickers';
import { useApp } from '@/components/providers';
import { ScanBox } from '@/components/scanner/scan-box';
import { Button, Card, Field, PageHeader, Textarea } from '@/components/ui';
import { useBalances } from '@/components/use-balances';

export default function DispatchPage() {
  const { f } = useApp();
  const [pointId, setPointId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [driver, setDriver] = useState<Driver | null>(null);
  const [notes, setNotes] = useState('');
  const L = useLines(useCallback(() => ({}), []));
  const op = useOperationSubmit('dispatch');

  // الرصيد البرتقالي المتاح للأصناف المضافة في النقطة المختارة
  const balances = useBalances(pointId, L.lines.map((l) => l.product.id));
  const maxFor = (productId: string) => balances.get(productId, 'ORANGE');
  const over = L.lines.some((l) => {
    const m = maxFor(l.product.id);
    return m !== undefined && l.quantity > m;
  });

  async function save() {
    const res = await op.submit({ pointId, driverId, lines: L.toPayload(), notes });
    if (res) {
      L.clear();
      setNotes('');
    }
  }

  if (op.result) return <OpSuccess op={op.result} onNew={op.reset} />;

  return (
    <>
      <PageHeader title="صرف بضاعة لسائق" subtitle="تنتقل الكمية من البرتقالي (متاح) إلى الأزرق (عهدة السائق)" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="الأصناف">
          <ScanBox onResult={(r, src) => L.addFromLookup(r, src, { max: maxFor(r.product.id) })} />
          <div className="mt-4">
            <LinesList
              lines={L.lines}
              onQty={(k, q) => L.update(k, { quantity: q })}
              onRemove={L.remove}
              onRemoveSerial={(k, s) => L.update(k, (l) => removeSerialPatch(l, s))}
              maxFor={(l) => maxFor(l.product.id)}
            />
          </div>
        </Card>
        <Card title="بيانات الصرف">
          <div className="space-y-3">
            <PointSelect
              value={pointId}
              onChange={(v) => {
                setPointId(v);
                setDriverId('');
                setDriver(null);
              }}
              label="الصرف من نقطة"
            />
            <DriverSelect
              value={driverId}
              pointId={pointId || undefined}
              onChange={(id, d) => {
                setDriverId(id);
                setDriver(d);
              }}
            />
            {driver && (
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="font-bold">{driver.fullName}</p>
                <p className="ltr text-start text-slate-600">{driver.phone}</p>
                {driver.vehiclePlate && <p className="text-slate-600">المركبة: {driver.vehicleType} {driver.vehiclePlate}</p>}
                {!!driver.custodyTotal && <p className="mt-1 font-semibold text-blue-800">عهدة حالية: {f.n(driver.custodyTotal)} قطعة</p>}
              </div>
            )}
            <Field label="ملاحظات (اختياري)">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="رقم الطلب، المنطقة…" />
            </Field>
            {over && <p className="text-sm font-bold text-red-700">بعض الكميات أكبر من الرصيد المتاح</p>}
            <Button className="w-full" size="lg" onClick={save} loading={op.busy} disabled={!pointId || !driverId || L.lines.length === 0 || over}>
              تأكيد الصرف
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
