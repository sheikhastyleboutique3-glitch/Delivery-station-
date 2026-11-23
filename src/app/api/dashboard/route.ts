import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { getDashboard } from '@/lib/services/queries';
import { getAlerts } from '@/lib/services/alerts';

export const GET = route({ roles: ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER'] }, async ({ actor }) => {
  const [stats, alerts] = await Promise.all([getDashboard(prisma, actor), getAlerts(prisma, actor)]);
  return { ...stats, alerts };
});
