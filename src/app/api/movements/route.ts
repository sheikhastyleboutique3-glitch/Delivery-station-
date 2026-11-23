import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { listMovements } from '@/lib/services/queries';

export const GET = route({}, async ({ actor, query }) => listMovements(prisma, actor, query));
