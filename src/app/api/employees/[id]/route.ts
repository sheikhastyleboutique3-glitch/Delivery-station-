import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { getEmployee, updateEmployee } from '@/lib/hr/employees';

type P = { id: string };
export const GET = route<P>({ roles: ['ADMIN'] }, async ({ actor, params }) => getEmployee(prisma, actor, params.id));
export const PATCH = route<P>({ roles: ['ADMIN'] }, async ({ actor, params, body }) => updateEmployee(prisma, actor, params.id, await body()));
