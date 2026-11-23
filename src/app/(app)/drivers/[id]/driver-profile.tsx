'use client';

import { useRef, useState } from 'react';
import { DRIVER_STATUS_LABELS, MOVEMENT_TYPES, MOVEMENT_LABELS } from '@/lib/domain';
import { apiSend, newIdempotencyKey, type ApiError } from '@/lib/client/api';
import { useApi } from '@/lib/client/hooks';
import type { Custody, Driver, Operation } from '@/lib/client/types';
import { ColorChip } from '@/components/colors';
import { DeliveryForm } from '@/components/delivery-form';
import { DriverFormModal } from '@/components/driver-form';
import { MovementsList } from '@/components/movements';
import { PointSelect } from '@/components/pickers';
import { useApp } from '@/components/providers';
import { Button, Card, Checkbox, EmptyState, ErrorBox, Field, Input, LinkButton, Loading, Modal, PageHeader, Select } from '@/components/ui';

export function DriverProfile({ id }: { id: string }) {
  const { f, user, toast } = useApp();
  const driver = useApi<Driver>(`/api/drivers/${id}`);
  const custody = useApi<Custody>(`/api/drivers/${id}/custody`, { refreshMs: 20_000 });
  const [editing, setEditing] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [settling, setSettling] = useState(false);
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const canSettle = user.role === 'ADMIN' || user.role === 'WAREHOUSE';

  if (driver.loading && !driver.data) return <Loading />;
  if (driver.error) return <ErrorBox error={driver.error} onRetry={driver.reload} />;
  const d = driver.data!;

  return (
    <>
      <PageHeader
        title={d.fullName}
        subtitle={`${DRIVER_STATUS_LABELS[d.status]} · ${d.deliveryPoint?.name ?? ''}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              تعديل البيانات
            </Button>
            <LinkButton href={`/returns?driverId=${d.id}`}>استلام مرتجع</LinkButton>
            {canSettle && <Button onClick={() => setSettling(true)}>تسوية العهدة</Button>}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="البيانات">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-slate-500">الهاتف</dt>
            <dd className="ltr text-start">{d.phone}</dd>
            <dt className="text-slate-500">رقم بديل</dt>
            <dd className="ltr text-start">{d.altPhone ?? '—'}</dd>
            <dt className="text-slate-500">الهوية</dt>
            <dd className="ltr text-start">{d.nationalId}</dd>
            <dt className="text-slate-500">العنوان</dt>
            <dd>{d.address ?? '—'}</dd>
            <dt className="text-slate-500">المركبة</dt>
            <dd>
              {d.vehicleType ?? '—'} <span className="ltr">{d.vehiclePlate ?? ''}</span>
            </dd>
            <dt className="text-slate-500">حساب الدخول</dt>
            <dd className="ltr text-start">{d.user?.email ?? 'لا يوجد'}</dd>
            <dt className="text-slate-500">آخر تسوية</dt>
            <dd>{f.dateTime(d.lastSettledAt)}</dd>
          </dl>
          {d.notes && <p className="mt-3 rounded-lg bg-slate-50 p-2 text-sm">{d.notes}</p>}
        </Card>

        <Card
          className="lg:col-span-2"
          title={custody.data ? `العهدة الحالية: ${f.n(custody.data.total)} قطعة` : 'العهدة الحالية'}
          actions={
            custody.data && custody.data.total > 0 ? (
              <Button variant="success" onClick={() => setDelivering(true)}>
                تسجيل تسليم
              </Button>
            ) : null
          }
        >
          {custody.data?.oldestSince && <p className="mb-2 text-sm text-slate-600">أقدم عهدة مفتوحة {f.since(custody.data.oldestSince)}</p>}
          {custody.data && custody.data.lines.length === 0 && <EmptyState title="لا توجد عهدة" hint="كل ما صُرف لهذا السائق تم تسليمه أو إرجاعه" />}
          <ul className="grid gap-2 sm:grid-cols-2">
            {custody.data?.lines.map((l) => (
              <li key={`${l.productId}-${l.pointId}`} className="flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
                <div className="min-w-0">
                  <p className="truncate font-bold">{l.productName}</p>
                  <p className="text-xs text-slate-600">
                    {l.pointName} · {f.since(l.since)}
                  </p>
                  {l.serials.length > 0 && <p className="ltr text-start font-mono text-[11px]">{l.serials.join(' ')}</p>}
                </div>
                <ColorChip color="BLUE" count={l.quantity} compact />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="سجل السائق: ماذا أخذ، ماذا سلّم، ماذا أرجع" className="mt-4">
        <div className="no-print mb-3 grid gap-3 sm:grid-cols-3">
          <Field label="نوع الحركة">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">الكل</option>
              {MOVEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MOVEMENT_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="من تاريخ">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="إلى تاريخ">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <MovementsList filter={{ driverId: d.id, type: type || undefined, from: from || undefined, to: to || undefined }} />
      </Card>

      {d.settlements && d.settlements.length > 0 && (
        <Card title="التسويات السابقة" className="mt-4">
          <ul className="divide-y divide-slate-100 text-sm">
            {d.settlements.map((s) => (
              <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <span className="ltr font-mono font-bold">{s.operation.opNo}</span> · {f.dateTime(s.createdAt)} · {s.settledBy.name}
                </span>
                <span className="text-slate-600">
                  مصروف {f.n(Number(s.summary.dispatched ?? 0))} · مسلّم {f.n(Number(s.summary.delivered ?? 0))} · مرتجع{' '}
                  {f.n(Number(s.summary.returnedGood ?? 0) + Number(s.summary.returnedDamaged ?? 0))} · عجز {f.n(Number(s.summary.shortageRecorded ?? 0))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <DriverFormModal
          driver={d}
          open
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            driver.reload();
          }}
        />
      )}

      <Modal open={delivering} onClose={() => setDelivering(false)} title={`تسجيل تسليم — ${d.fullName}`} wide>
        {custody.data && (
          <DeliveryForm
            driverId={d.id}
            custody={custody.data}
            onDone={() => {
              setDelivering(false);
              custody.reload();
            }}
          />
        )}
      </Modal>

      {settling && custody.data && (
        <SettleModal
          driver={d}
          custody={custody.data}
          onClose={() => setSettling(false)}
          onDone={(op) => {
            setSettling(false);
            toast(`تمت التسوية ${op.opNo}`);
            custody.reload();
            driver.reload();
          }}
        />
      )}
    </>
  );
}

function SettleModal({ driver, custody, onClose, onDone }: { driver: Driver; custody: Custody; onClose: () => void; onDone: (op: Operation) => void }) {
  const { f, toast } = useApp();
  const key = useRef(newIdempotencyKey());
  const [mark, setMark] = useState(false);
  const [reason, setReason] = useState('');
  const [pointId, setPointId] = useState('');
  const [busy, setBusy] = useState(false);
  const remaining = custody.total;

  async function submit() {
    setBusy(true);
    try {
      const op = await apiSend<Operation>('POST', '/api/stock/settle', {
        idempotencyKey: key.current,
        driverId: driver.id,
        receivingPointId: pointId || null,
        markRemainingAsShortage: mark,
        reason: reason || null,
      });
      onDone(op);
    } catch (err) {
      const e = err as ApiError;
      toast(e.messageAr, 'error');
      if (!e.isNetwork) key.current = newIdempotencyKey();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`تسوية عهدة ${driver.fullName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant={mark ? 'danger' : 'primary'} onClick={submit} loading={busy} disabled={(remaining > 0 && !mark) || (mark && !reason.trim())}>
            تأكيد التسوية
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          التسوية تقارن ما صُرف للسائق بما سلّمه وأرجعه منذ آخر تسوية ({f.dateTime(driver.lastSettledAt)}).
        </p>
        {remaining === 0 ? (
          <p className="rounded-xl bg-green-50 p-3 font-bold text-green-900">لا توجد عهدة متبقية. يمكن إغلاق التسوية مباشرة.</p>
        ) : (
          <>
            <p className="rounded-xl bg-amber-50 p-3 font-bold text-amber-900">
              متبقٍ لدى السائق {f.n(remaining)} قطعة. سجّل إرجاعها أولاً، أو سجّلها كعجز (تنتقل إلى الأحمر).
            </p>
            <Checkbox label="تسجيل المتبقي كعجز / مفقود" checked={mark} onChange={setMark} />
            {mark && (
              <>
                <Field label="سبب العجز (إلزامي)">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="فقدان، لم يُرجع، تلف أثناء النقل…" />
                </Field>
                <PointSelect value={pointId} onChange={setPointId} label="تسجيل العجز في نقطة" allowAll emptyLabel="نقطة مصدر البضاعة (تلقائي)" locked={false} />
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
