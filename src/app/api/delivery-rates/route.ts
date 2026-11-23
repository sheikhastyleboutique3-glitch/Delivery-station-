import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { listRates, upsertRate } from '@/lib/hr/payroll';

export const GET = route({ roles: ['ADMIN'] }, async ({ actor }) => listRates(prisma, actor));
export const POST = route({ roles: ['ADMIN'] }, async ({ actor, body }) => upsertRate(prisma, actor, await body()));
