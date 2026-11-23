import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { getAlerts } from '@/lib/services/alerts';

export const GET = route({}, async ({ actor }) => getAlerts(prisma, actor));
