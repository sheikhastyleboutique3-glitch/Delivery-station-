import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { changeEmployeeStatus } from '@/lib/hr/employees';

type P = { id: string };
export const POST = route<P>({ roles: ['ADMIN'] }, async ({ actor, params, body }) => changeEmployeeStatus(prisma, actor, params.id, await body()));
