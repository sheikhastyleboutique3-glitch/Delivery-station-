import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { getMonthlyAttendance, markAttendance } from '@/lib/hr/attendance';

type P = { id: string };
export const GET = route<P>({ roles: ['ADMIN'] }, async ({ actor, params, query }) => getMonthlyAttendance(prisma, actor, params.id, query.month));
export const POST = route<P>({ roles: ['ADMIN'] }, async ({ actor, params, body }) => markAttendance(prisma, actor, params.id, await body()));
