'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MOVEMENT_LABELS, SCAN_SOURCE_LABELS, COLOR_META, type StockColor } from '@/lib/domain';
import { qs } from '@/lib/client/api';
import { useApi } from '@/lib/client/hooks';
import type { Movement, Paged } from '@/lib/client/types';
import { ColorChip } from './colors';
import { useApp } from './providers';
import { EmptyState, ErrorBox, Loading, Modal, Pagination, Table, Td, Th } from './ui';

export interface MovementFilter {
  productId?: string;
  driverId?: string;
  customerId?: string;
  pointId?: string;
  color?: StockColor;
  type?: string;
  from?: string;
  to?: string;
  q?: string;
}

export function MovementFlow({ m }: { m: Pick<Movement, 'fromColor' | 'toColor'> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {m.fromColor ? <ColorChip color={m.fromColor} compact /> : <span className="text-xs text-slate-400">جديد</span>}
      <span aria-label="إلى" className="text-slate-400">
        ←
      </span>
      {m.toColor ? <ColorChip color={m.toColor} compact /> : <span className="text-xs font-bold text-slate-500">مشطوب</span>}
    </span>
  );
}

function describe(m: Movement) {
  return `${m.fromColor ? COLOR_META[m.fromColor].label : 'جديد'} ← ${m.toColor ? COLOR_META[m.toColor].label : 'مشطوب'}`;
}

/** جدول (حاسوب) وبطاقات (جوال) لسجل الحركات مع ترقيم صفحات من الخادم */
export function MovementsList({ filter, pageSize = 25, refreshMs }: { filter: MovementFilter; pageSize?: number; refreshMs?: number }) {
  const { f } = useApp();
  const [page, setPage] = useState(1);
  const key = JSON.stringify(filter);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setPage(1);
  }
  const { data, error, loading, reload } = useApi<Paged<Movement>>(`/api/movements${qs({ ...filter, page, pageSize })}`, { refreshMs });

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data || data.items.length === 0) return <EmptyState title="لا توجد حركات مطابقة" />;

  return (
    <div>
      {/* جوال */}
      <ul className="space-y-2 md:hidden">
        {data.items.map((m) => (
          <li key={m.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold">{m.product.name}</p>
                <p className="text-xs text-slate-500">{MOVEMENT_LABELS[m.type]}</p>
              </div>
              <span className="text-lg font-black tabular-nums">{f.n(m.quantity)}</span>
            </div>
            <div className="mt-2">
              <MovementFlow m={m} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {f.dateTime(m.createdAt)} · {m.performedBy?.name}
              {m.driver ? ` · السائق: ${m.driver.fullName}` : ''}
              {m.customer ? ` · العميل: ${m.customer.name}` : ''}
            </p>
            {m.reason && <p className="mt-1 text-xs font-semibold text-red-700">السبب: {m.reason}</p>}
            {m.operation && (
              <Link href={`/ops/${m.operation.id}`} className="mt-1 inline-block text-xs font-bold text-blue-700 underline">
                {m.operation.opNo}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {/* حاسوب */}
      <div className="hidden md:block">
        <Table>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>التاريخ</Th>
              <Th>الحركة</Th>
              <Th>المنتج</Th>
              <Th>الكمية</Th>
              <Th>اللون</Th>
              <Th>النقطة</Th>
              <Th>السائق / العميل</Th>
              <Th>السبب</Th>
              <Th>المسح</Th>
              <Th>المنفّذ</Th>
              <Th>السند</Th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((m) => (
              <tr key={m.id} title={describe(m)}>
                <Td className="ltr font-mono text-xs text-slate-500">{m.movementNo}</Td>
                <Td className="whitespace-nowrap text-xs">{f.dateTime(m.createdAt)}</Td>
                <Td className="whitespace-nowrap">{MOVEMENT_LABELS[m.type]}</Td>
                <Td>
                  <p className="font-semibold">{m.product.name}</p>
                  {m.unitSerials.length > 0 && <p className="ltr font-mono text-[11px] text-slate-500">{m.unitSerials.join(' ')}</p>}
                </Td>
                <Td className="font-black tabular-nums">{f.n(m.quantity)}</Td>
                <Td>
                  <MovementFlow m={m} />
                </Td>
                <Td className="text-xs">
                  {m.fromPoint?.name}
                  {m.toPoint && m.toPoint.id !== m.fromPoint?.id ? ` ← ${m.toPoint.name}` : ''}
                </Td>
                <Td className="text-xs">
                  {m.driver && <p>السائق: {m.driver.fullName}</p>}
                  {m.customer && <p>العميل: {m.customer.name}</p>}
                </Td>
                <Td className="max-w-48 text-xs text-red-700">{m.reason}</Td>
                <Td className="text-xs">{m.scanSource ? SCAN_SOURCE_LABELS[m.scanSource] : ''}</Td>
                <Td className="text-xs">{m.performedBy?.name}</Td>
                <Td>
                  {m.operation && (
                    <Link href={`/ops/${m.operation.id}`} className="ltr font-mono text-xs font-bold text-blue-700 underline">
                      {m.operation.opNo}
                    </Link>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </div>
  );
}

export function MovementsDrawer({ open, onClose, title, filter }: { open: boolean; onClose: () => void; title: string; filter: MovementFilter }) {
  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      {open && <MovementsList filter={filter} pageSize={20} />}
      <div className="mt-3 text-center">
        <Link href={`/movements${qs({ ...filter })}`} className="text-sm font-bold text-blue-700 underline">
          فتح السجل الكامل مع الفلاتر
        </Link>
      </div>
    </Modal>
  );
}
