'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiSend, flushQueue, qs, readQueue, type ApiError, type QueuedRequest } from '@/lib/client/api';
import { useApi, useOnline } from '@/lib/client/hooks';
import type { Custody, Operation, Paged } from '@/lib/client/types';
import { ColorChip } from '@/components/colors';
import { DeliveryForm } from '@/components/delivery-form';
import { MovementsList } from '@/components/movements';
import { useApp } from '@/components/providers';
import { Button, Card, EmptyState, ErrorBox, Loading, Modal, PageHeader } from '@/components/ui';

export default function DriverHome() {
  const { user, f, toast } = useApp();
  const online = useOnline();
  const driverId = user.driverId;
  const custody = useApi<Custody>(driverId ? `/api/drivers/${driverId}/custody` : null, { refreshMs: 30_000 });
  const pending = useApi<Paged<Operation>>(driverId ? `/api/ops${qs({ kind: 'DISPATCH', status: 'PENDING_DRIVER_ACK', pageSize: 20 })}` : null, { refreshMs: 30_000 });
  const [delivering, setDelivering] = useState(false);
  const [queue, setQueue] = useState<QueuedRequest[]>([]);
  const [acking, setAcking] = useState<string | null>(null);

  const refreshQueue = useCallback(() => setQueue(readQueue()), []);
  const flush = useCallback(async () => {
    if (readQueue().length === 0) return;
    const r = await flushQueue();
    if (r.sent) toast(`تم إرسال ${r.sent} عملية محفوظة`);
    for (const fail of r.failed) toast(`تعذر إرسال "${fail.item.label}": ${fail.error}`, 'error');
    refreshQueue();
    custody.reload();
  }, [toast, refreshQueue, custody]);

  useEffect(() => {
    refreshQueue();
    window.addEventListener('rasd-queue', refreshQueue);
    return () => window.removeEventListener('rasd-queue', refreshQueue);
  }, [refreshQueue]);

  useEffect(() => {
    if (online) flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  async function ack(op: Operation) {
    setAcking(op.id);
    try {
      await apiSend('POST', `/api/ops/${op.id}/ack`);
      toast(`تم تأكيد استلام ${op.opNo}`);
      pending.reload();
    } catch (err) {
      toast((err as ApiError).messageAr, 'error');
    } finally {
      setAcking(null);
    }
  }

  if (!driverId) {
    return <EmptyState title="هذا الحساب غير مرتبط بسجل سائق" hint="اطلب من مدير النظام ربط حسابك بسجل السائق" />;
  }

  return (
    <>
      <PageHeader title="عهدتي" subtitle={user.pointName ?? undefined} />

      {!online && <p className="mb-3 rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-900">أنت غير متصل بالإنترنت. التسليمات ستُحفظ على الجهاز.</p>}
      {queue.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
          <span className="font-bold text-amber-900">{f.n(queue.length)} عملية بانتظار الإرسال</span>
          <Button size="sm" variant="secondary" onClick={flush} disabled={!online}>
            إرسال الآن
          </Button>
        </div>
      )}

      {pending.data && pending.data.items.length > 0 && (
        <Card title="بضاعة بانتظار تأكيد استلامك" className="mb-4 border-blue-300">
          <ul className="space-y-2">
            {pending.data.items.map((op) => (
              <li key={op.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-blue-50 p-3">
                <div>
                  <Link href={`/ops/${op.id}`} className="ltr font-mono font-bold underline">
                    {op.opNo}
                  </Link>
                  <p className="text-xs text-slate-600">
                    {f.n(op.totalQuantity ?? 0)} قطعة · {f.since(op.createdAt)}
                  </p>
                </div>
                <Button size="lg" onClick={() => ack(op)} loading={acking === op.id}>
                  استلمت البضاعة
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title={custody.data ? `العهدة الحالية: ${f.n(custody.data.total)} قطعة` : 'العهدة الحالية'}
        actions={
          custody.data && custody.data.total > 0 ? (
            <Button variant="success" size="lg" onClick={() => setDelivering(true)}>
              تسجيل تسليم لعميل
            </Button>
          ) : null
        }
      >
        {custody.loading && !custody.data && <Loading />}
        <ErrorBox error={custody.error} onRetry={custody.reload} />
        {custody.data && custody.data.lines.length === 0 && <EmptyState title="لا توجد عهدة حالياً" hint="ستظهر هنا البضاعة التي يصرفها لك المستودع" />}
        <ul className="space-y-2">
          {custody.data?.lines.map((l) => (
            <li key={`${l.productId}-${l.pointId}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
              <div className="min-w-0">
                <p className="font-bold">{l.productName}</p>
                <p className="text-xs text-slate-500">
                  {l.pointName} · {f.since(l.since)}
                </p>
                {l.serials.length > 0 && <p className="ltr text-start font-mono text-[11px] text-slate-500">{l.serials.join(' ')}</p>}
              </div>
              <ColorChip color="BLUE" count={l.quantity} />
            </li>
          ))}
        </ul>
      </Card>

      <Card title="آخر حركاتي" className="mt-4">
        <MovementsList filter={{ driverId }} pageSize={10} />
      </Card>

      <Modal open={delivering} onClose={() => setDelivering(false)} title="تسجيل تسليم لعميل" wide>
        {custody.data && (
          <DeliveryForm
            driverId={driverId}
            custody={custody.data}
            offlineQueue
            onDone={() => {
              setDelivering(false);
              custody.reload();
              refreshQueue();
            }}
          />
        )}
      </Modal>
    </>
  );
}
