import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { getBalances } from '@/lib/services/queries';

export const GET = route({ roles: ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER'] }, async ({ actor, query }) =>
  getBalances(prisma, actor, query.pointId, query.productIds),
);
