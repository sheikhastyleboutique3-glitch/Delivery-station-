import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { listOperations } from '@/lib/services/queries';

export const GET = route({}, async ({ actor, query }) => listOperations(prisma, actor, query));
