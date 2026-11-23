import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { createPayout, listPayouts } from '@/lib/hr/payroll';

export const GET = route({ roles: ['ADMIN'] }, async ({ actor, query }) => listPayouts(prisma, actor, query));
export const POST = route({ roles: ['ADMIN'] }, async ({ actor, body }) => createPayout(prisma, actor, await body()));
