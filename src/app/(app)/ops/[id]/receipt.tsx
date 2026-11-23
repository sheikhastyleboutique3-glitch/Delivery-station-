'use client';

import { useState } from 'react';
import { MOVEMENT_LABELS, OPERATION_LABELS } from '@/lib/domain';
import { apiSend, type ApiError } from '@/lib/client/api';
import { useApi } from '@/lib/client/hooks';
import type { Operation } from '@/lib/client/types';
import { LogoMark } from '@/components/logo';
import { MovementFlow } from '@/components/movements';
import { useApp } from '@/components/providers';
import { Badge, Button, ErrorBox, Loading, Table, Td, Th } from '@/components/ui';

const STATUS: Record<Operation['status'], { label: string; cls: string }> = {
  COMPLETED: { label: 'مكتمل', cls: 'border-green-300 bg-green-100 text-green-900' },
  PENDING_DRIVER_ACK: { label: 'بانتظار تأكيد السائق', cls: 'border-amber-300 bg-amber-100 text-amber-900' },
  ACKNOWLEDGED: { label: 'أكّد السائق الاستلام', cls: 'border-blue-300 bg-blue-100 text-blue-900' },
};

export function OperationReceipt({ id }: { id: string }) {
  const { f, user, settings, toast } = useApp();
  const { data: op, error, loading, reload } = useApi<Operation>(`/api/ops/${id}`);
  const [acking, setAcking] = useState(false);

  async function ack() {
    setAcking(true);
    try {
      await apiSend('POST', `/api/ops/${id}/ack`);
      toast('تم تأكيد الاستلام');
      reload();
    } catch (err) {
      toast((err as ApiError).messageAr, 'error');
    } finally {
      setAcking(false);
    }
  }

  if (loading && !op) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!op) return null;
  const total = op.movements?.reduce((s, m) => s + m.quantity, 0) ?? 0;
  const canAck = op.status === 'PENDING_DRIVER_ACK' && ((user.role === 'DRIVER' && user.driverId === op.driver?.id) || user.role === 'ADMIN');

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-3 flex flex-wrap justify-end gap-2">
        {canAck && (
          <Button size="lg" onClick={ack} loading={acking}>
            تأكيد استلام البضاعة
          </Button>
        )}
        <Button variant="secondary" onClick={() => window.print()}>
          طباعة
        </Button>
      </div>
      <article className="print-area rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <LogoMark className="h-12 w-12" />
            <div>
              <p className="text-lg font-black">{settings.companyName}</p>
              <p className="text-sm text-slate-500">{OPERATION_LABELS[op.kind]}</p>
            </div>
          </div>
          <div className="text-end">
            <p className="ltr font-mono text-xl font-black">{op.opNo}</p>
            <p className="text-sm text-slate-600">{f.dateTime(op.createdAt)}</p>
            <Badge className={STATUS[op.status].cls}>{STATUS[op.status].label}</Badge>
          </div>
        </header>

        <dl className="grid gap-x-6 gap-y-2 py-4 text-sm sm:grid-cols-2">
          {op.deliveryPoint && (
            <div>
              <dt className="text-slate-500">النقطة</dt>
              <dd className="font-semibold">{op.deliveryPoint.name}</dd>
            </div>
          )}
          {op.toDeliveryPoint && (
            <div>
              <dt className="text-slate-500">إلى نقطة</dt>
              <dd className="font-semibold">{op.toDeliveryPoint.name}</dd>
            </div>
          )}
          {op.driver && (
            <div>
              <dt className="text-slate-500">السائق</dt>
              <dd className="font-semibold">
                {op.driver.fullName} <span className="ltr text-slate-500">{op.driver.phone}</span>
                {op.driver.vehiclePlate && <span className="text-slate-500"> · {op.driver.vehiclePlate}</span>}
              </dd>
            </div>
          )}
          {op.customer && (
            <div>
              <dt className="text-slate-500">العميل</dt>
              <dd className="font-semibold">
                {op.customer.name} <span className="ltr text-slate-500">{op.customer.phone}</span>
                {op.customer.address && <span className="block text-xs text-slate-500">{op.customer.address}</span>}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-slate-500">المنفّذ</dt>
            <dd className="font-semibold">{op.performedBy?.name}</dd>
          </div>
          {op.acknowledgedAt && (
            <div>
              <dt className="text-slate-500">تأكيد الاستلام</dt>
              <dd className="font-semibold">
                {f.dateTime(op.acknowledgedAt)} · {op.acknowledgedBy?.name}
              </dd>
            </div>
          )}
          {op.reason && (
            <div className="sm:col-span-2">
              <dt className="text-slate-500">السبب</dt>
              <dd>{op.reason}</dd>
            </div>
          )}
          {op.notes && (
            <div className="sm:col-span-2">
              <dt className="text-slate-500">ملاحظات</dt>
              <dd>{op.notes}</dd>
            </div>
          )}
        </dl>

        {op.movements && op.movements.length > 0 && (
          <Table className="print:overflow-visible">
            <thead>
              <tr>
                <Th>#</Th>
                <Th>المنتج</Th>
                <Th>SKU</Th>
                <Th>الحركة</Th>
                <Th>اللون</Th>
                <Th>الكمية</Th>
                <Th>السبب</Th>
              </tr>
            </thead>
            <tbody>
              {op.movements.map((m, i) => (
                <tr key={m.id}>
                  <Td>{i + 1}</Td>
                  <Td className="font-semibold">
                    {m.product.name}
                    {m.unitSerials.length > 0 && <p className="ltr font-mono text-[11px] font-normal text-slate-500">{m.unitSerials.join(' ')}</p>}
                  </Td>
                  <Td className="ltr font-mono text-xs">{m.product.sku}</Td>
                  <Td>{MOVEMENT_LABELS[m.type]}</Td>
                  <Td>
                    <MovementFlow m={m} />
                  </Td>
                  <Td className="font-black">{f.n(m.quantity)}</Td>
                  <Td className="text-xs">{m.reason}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={5} className="text-end font-bold">
                  الإجمالي
                </Td>
                <Td className="font-black">{f.n(total)}</Td>
                <Td />
              </tr>
            </tfoot>
          </Table>
        )}

        {op.settlement && (
          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
            <p className="font-bold">ملخص التسوية</p>
            <p>
              مصروف {f.n(Number(op.settlement.summary.dispatched))} · مسلّم {f.n(Number(op.settlement.summary.delivered))} · مرتجع سليم{' '}
              {f.n(Number(op.settlement.summary.returnedGood))} · مرتجع تالف {f.n(Number(op.settlement.summary.returnedDamaged))} · عجز{' '}
              {f.n(Number(op.settlement.summary.shortageRecorded))}
            </p>
          </div>
        )}

        <footer className="mt-10 grid grid-cols-2 gap-8 text-center text-sm">
          <div className="border-t border-slate-400 pt-2">توقيع المستلم</div>
          <div className="border-t border-slate-400 pt-2">توقيع المسلّم</div>
        </footer>
      </article>
    </div>
  );
}
