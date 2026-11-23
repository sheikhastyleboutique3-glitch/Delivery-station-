import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { lookupCode } from '@/lib/services/queries';

export const GET = route({}, async ({ actor, query }) => lookupCode(prisma, actor, query.code ?? ''));
