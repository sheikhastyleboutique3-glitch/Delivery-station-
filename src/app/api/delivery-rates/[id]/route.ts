import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { deactivateRate } from '@/lib/hr/payroll';

type P = { id: string };
export const DELETE = route<P>({ roles: ['ADMIN'] }, async ({ actor, params }) => deactivateRate(prisma, actor, params.id));
