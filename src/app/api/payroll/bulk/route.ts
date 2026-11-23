import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { createPayoutsBulk } from '@/lib/hr/payroll';

export const POST = route({ roles: ['ADMIN'] }, async ({ actor, body }) => createPayoutsBulk(prisma, actor, await body()));
