import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { myEarnings } from '@/lib/hr/payroll';

export const GET = route({ roles: ['DRIVER'] }, async ({ actor }) => myEarnings(prisma, actor));
