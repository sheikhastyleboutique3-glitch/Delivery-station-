import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { getWarehouseView } from '@/lib/services/queries';

export const GET = route({ roles: ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER'] }, async ({ actor, query }) =>
  getWarehouseView(prisma, actor, query),
);
