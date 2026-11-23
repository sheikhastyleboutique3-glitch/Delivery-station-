import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { deletePayout, getPayout, updatePayout } from '@/lib/hr/payroll';

type P = { id: string };
export const GET = route<P>({ roles: ['ADMIN'] }, async ({ actor, params }) => getPayout(prisma, actor, params.id));
export const PATCH = route<P>({ roles: ['ADMIN'] }, async ({ actor, params, body }) => updatePayout(prisma, actor, params.id, await body()));
export const DELETE = route<P>({ roles: ['ADMIN'] }, async ({ actor, params }) => deletePayout(prisma, actor, params.id));
