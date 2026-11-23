'use client';

import { useState } from 'react';
import { ATTENDANCE_LABELS, ATTENDANCE_SOURCE_LABELS, ATTENDANCE_STATUSES, type AttendanceStatus } from '@/lib/domain';
import { apiSend, type ApiError } from '@/lib/client/api';
import { useApi } from '@/lib/client/hooks';
import type { AttendanceLogRow, AttendanceMonth } from '@/lib/client/types';
import { useApp } from '../providers';
import { Button, Field, Input, Loading, Modal, Select, cx } from '../ui';

const STYLE: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-green-600 text-white',
  ABSENT: 'bg-red-600 text-white',
  LEAVE: 'bg-amber-400 text-amber-950',
  OFF: 'bg-slate-300 text-slate-800',
};

const WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** تقويم الحضور الشهري: الأيام الخضراء محسوبة تلقائياً من الاستلام والتسليم */
export function AttendancePanel({ employeeId }: { employeeId: string }) {
  const { f, toast, settings } = useApp();
  const [month, setMonth] = useState<string | null>(null);
  const { data, loading, reload } = useApi<AttendanceMonth>(`/api/employees/${employeeId}/attendance${month ? `?month=${month}` : ''}`);
  const [editing, setEditing] = useState<{ date: string; status: AttendanceStatus; notes: string; log: AttendanceLogRow | null } | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading />;
  if (!data) return null;
  const ym = data.month;
  const [y, m] = ym.split('-').map(Number);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const byDate = new Map(data.logs.map((l) => [l.date, l]));
  const s = data.summary;

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      await apiSend('POST', `/api/employees/${employeeId}/attendance`, { date: editing.date, status: editing.status, notes: editing.notes || null });
      toast('تم تسجيل الحضور');
      setEditing(null);
      reload();
    } catch (err) {
      toast((err as ApiError).messageAr, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setMonth(shiftMonth(ym, -1))} aria-label="الشهر السابق">
            ‹ السابق
          </Button>
          <span className="min-w-32 text-center font-extrabold">
            {new Intl.DateTimeFormat(settings.numerals === 'arabic' ? 'ar-EG' : 'ar-u-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-15T12:00:00Z`))}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setMonth(shiftMonth(ym, 1))} disabled={ym >= data.today.slice(0, 7)} aria-label="الشهر التالي">
            التالي ›
          </Button>
        </div>
        <p className="text-xs text-slate-500">اضغط على أي يوم لتسجيله يدوياً (للإداريين أو للتصحيح).</p>
      </div>

      <dl className="mb-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4 lg:grid-cols-7">
        {[
          ['أيام الحضور', s.presentDays, 'bg-green-50 text-green-900'],
          ['غياب', s.absentDays, 'bg-red-50 text-red-900'],
          ['إجازة', s.leaveDays, 'bg-amber-50 text-amber-900'],
          ['راحة', s.offDays, 'bg-slate-50'],
          ['قطع مستلمة للتوصيل', s.receivedUnits, 'bg-blue-50 text-blue-900'],
          ['قطع مسلّمة', s.deliveredUnits, 'bg-green-50 text-green-900'],
          ['طرود مسلّمة', s.deliveredColis, 'bg-green-50 text-green-900'],
        ].map(([label, v, cls]) => (
          <div key={label as string} className={cx('rounded-xl p-2', cls as string)}>
            <dt className="text-[11px]">{label}</dt>
            <dd className="text-xl font-black tabular-nums">{f.n(v as number)}</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-slate-500">
        {WEEKDAYS.map((w) => (
          <div key={w} className="truncate">
            {w}
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: firstDow }, (_, i) => (
          <div key={`e${i}`} />
        ))}
        {Array.from({ length: daysIn }, (_, i) => {
          const date = `${ym}-${String(i + 1).padStart(2, '0')}`;
          const log = byDate.get(date);
          const future = date > data.today;
          return (
            <button
              key={date}
              type="button"
              disabled={future}
              onClick={() => setEditing({ date, status: log?.status ?? 'PRESENT', notes: log?.notes ?? '', log: log ?? null })}
              className={cx(
                'flex min-h-14 flex-col items-center justify-center rounded-lg border text-sm',
                log ? STYLE[log.status] + ' border-transparent' : 'border-slate-200 bg-white',
                future && 'opacity-40',
                date === data.today && 'ring-2 ring-slate-900',
              )}
              title={log ? `${ATTENDANCE_LABELS[log.status]} · ${ATTENDANCE_SOURCE_LABELS[log.source]}` : 'لا يوجد تسجيل'}
            >
              <span className="font-black">{i + 1}</span>
              {log && log.deliveredUnits > 0 && <span className="text-[10px] font-bold">{f.n(log.deliveredUnits)} قطعة</span>}
              {log && log.source !== 'MANUAL' && <span className="text-[9px] opacity-80">تلقائي</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {ATTENDANCE_STATUSES.map((st) => (
          <span key={st} className="flex items-center gap-1">
            <span className={cx('h-3 w-3 rounded', STYLE[st])} /> {ATTENDANCE_LABELS[st]}
          </span>
        ))}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `تسجيل يوم ${f.ymd(editing.date)}` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              إلغاء
            </Button>
            <Button onClick={save} loading={busy}>
              حفظ
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            {editing.log && editing.log.source !== 'MANUAL' && (
              <p className="rounded-xl bg-green-50 p-3 text-sm text-green-900">
                سُجّل تلقائياً ({ATTENDANCE_SOURCE_LABELS[editing.log.source]}): استلم {f.n(editing.log.receivedUnits)} وسلّم {f.n(editing.log.deliveredUnits)} قطعة في{' '}
                {f.n(editing.log.deliveredColis)} طرد. تغيير الحالة يدوياً لا يحذف هذه الأرقام.
              </p>
            )}
            <Field label="الحالة">
              <Select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as AttendanceStatus })}>
                {ATTENDANCE_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {ATTENDANCE_LABELS[st]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="ملاحظة (اختياري)">
              <Input value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
