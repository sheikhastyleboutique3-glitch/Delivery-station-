import type { Db } from '../db';
import { requireRole, type Actor } from '../actor';
import { writeAudit } from '../audit';
import { Errors } from '../errors';
import { getSettings } from '../settings';
import { attendanceMarkSchema } from './validation';
import { dbDate, localDate, monthRange, ymdOf } from './util';

export interface AttendanceSummary {
  from: string;
  to: string;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  offDays: number;
  receivedUnits: number;
  deliveredUnits: number;
  deliveredColis: number;
}

export async function attendanceFor(db: Db, employeeId: string, from: string, to: string) {
  const logs = await db.attendanceLog.findMany({
    where: { employeeId, date: { gte: dbDate(from), lte: dbDate(to) } },
    orderBy: { date: 'asc' },
    include: { setBy: { select: { name: true } } },
  });
  const summary: AttendanceSummary = {
    from,
    to,
    presentDays: 0,
    absentDays: 0,
    leaveDays: 0,
    offDays: 0,
    receivedUnits: 0,
    deliveredUnits: 0,
    deliveredColis: 0,
  };
  for (const l of logs) {
    if (l.status === 'PRESENT') summary.presentDays++;
    else if (l.status === 'ABSENT') summary.absentDays++;
    else if (l.status === 'LEAVE') summary.leaveDays++;
    else summary.offDays++;
    summary.receivedUnits += l.receivedUnits;
    summary.deliveredUnits += l.deliveredUnits;
    summary.deliveredColis += l.deliveredColis;
  }
  return { logs: logs.map((l) => ({ ...l, date: ymdOf(l.date) })), summary };
}

export async function getMonthlyAttendance(db: Db, actor: Actor, employeeId: string, month: string | undefined) {
  requireRole(actor, ['ADMIN']);
  const settings = await getSettings(db);
  const ym = month ?? localDate(new Date(), settings.timezone).slice(0, 7);
  const { from, to } = monthRange(ym);
  return { month: ym, today: localDate(new Date(), settings.timezone), ...(await attendanceFor(db, employeeId, from, to)) };
}

/**
 * تسجيل يدوي (للإداريين وأمناء المستودع، أو لتصحيح يوم).
 * يحفظ أعداد القطع المسجلة تلقائياً كما هي حتى لا تضيع أدلة العمل.
 */
export async function markAttendance(db: Db, actor: Actor, employeeId: string, raw: unknown) {
  requireRole(actor, ['ADMIN']);
  const input = attendanceMarkSchema.parse(raw);
  const settings = await getSettings(db);
  if (input.date > localDate(new Date(), settings.timezone)) throw Errors.validation('لا يمكن تسجيل حضور ليوم في المستقبل');
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { hireDate: true, terminationDate: true } });
  if (!emp) throw Errors.notFound('الموظف');
  if (input.date < ymdOf(emp.hireDate)) throw Errors.validation('التاريخ قبل تاريخ التحاق الموظف');
  if (emp.terminationDate && input.date > ymdOf(emp.terminationDate)) throw Errors.validation('التاريخ بعد تاريخ توقف الموظف عن العمل');

  return db.$transaction(async (tx) => {
    const date = dbDate(input.date);
    const before = await tx.attendanceLog.findUnique({ where: { employeeId_date: { employeeId, date } } });
    const log = await tx.attendanceLog.upsert({
      where: { employeeId_date: { employeeId, date } },
      create: { employeeId, date, status: input.status, source: 'MANUAL', notes: input.notes, setById: actor.id },
      update: { status: input.status, source: 'MANUAL', notes: input.notes, setById: actor.id, updatedAt: new Date() },
    });
    await writeAudit(tx, actor, { action: 'attendance.mark', entityType: 'employee', entityId: employeeId, before, after: log });
    return { ...log, date: ymdOf(log.date) };
  });
}
