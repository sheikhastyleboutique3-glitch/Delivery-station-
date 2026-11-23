import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { addPayment } from '@/lib/hr/payroll';

type P = { id: string };
export const POST = route<P>({ roles: ['ADMIN'] }, async ({ actor, params, body }) => addPayment(prisma, actor, params.id, await body()));
