import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { previewPayout } from '@/lib/hr/payroll';

export const GET = route({ roles: ['ADMIN'] }, async ({ actor, query }) => previewPayout(prisma, actor, query));
