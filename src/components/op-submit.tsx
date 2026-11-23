'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { OPERATION_LABELS } from '@/lib/domain';
import { apiSend, newIdempotencyKey, type ApiError } from '@/lib/client/api';
import type { Operation } from '@/lib/client/types';
import { useApp } from './providers';
import { Button } from './ui';
import { Icon } from './icons';

/**
 * يرسل عملية مخزون مع مفتاح منع التكرار.
 * المفتاح ثابت لنفس المحاولة: إذا انقطع الاتصال وأعاد المستخدم الإرسال
 * لا تُسجَّل الحركة مرتين. يُولَّد مفتاح جديد بعد النجاح فقط.
 */
export function useOperationSubmit(action: string) {
  const { toast } = useApp();
  const keyRef = useRef<string>(newIdempotencyKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<Operation | null>(null);

  const submit = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const op = await apiSend<Operation>('POST', `/api/stock/${action}`, { ...payload, idempotencyKey: keyRef.current });
        keyRef.current = newIdempotencyKey();
        setResult(op);
        toast(`تم حفظ ${OPERATION_LABELS[op.kind]} رقم ${op.opNo}`);
        return op;
      } catch (err) {
        const e = err as ApiError;
        setError(e);
        toast(e.messageAr, 'error');
        // تغيّر محتوى الطلب بعد خطأ تحقق؟ مفتاح جديد حتى لا يُرفض كـ"طلب مختلف"
        if (!e.isNetwork) keyRef.current = newIdempotencyKey();
        return null;
      } finally {
        setBusy(false);
      }
    },
    [action, toast],
  );

  return { submit, busy, error, result, reset: () => setResult(null) };
}

export function OpSuccess({ op, onNew }: { op: Operation; onNew: () => void }) {
  const { f } = useApp();
  const qty = op.movements?.reduce((s, m) => s + m.quantity, 0) ?? 0;
  return (
    <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-white">
        <Icon name="check" className="h-8 w-8" />
      </span>
      <p className="mt-1 text-lg font-extrabold text-green-900">تم الحفظ بنجاح</p>
      <p className="mt-1 text-sm text-green-900">
        {OPERATION_LABELS[op.kind]} <span className="ltr font-mono font-bold">{op.opNo}</span> · {f.n(op.movements?.length ?? 0)} حركة · {f.n(qty)} قطعة
      </p>
      {op.status === 'PENDING_DRIVER_ACK' && <p className="mt-1 text-xs text-green-800">بانتظار تأكيد السائق الاستلام من تطبيقه</p>}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href={`/ops/${op.id}`} className="inline-flex min-h-11 items-center rounded-xl border border-green-300 bg-white px-4 text-sm font-bold">
          عرض / طباعة السند
        </Link>
        <Button onClick={onNew}>عملية جديدة</Button>
      </div>
    </div>
  );
}
