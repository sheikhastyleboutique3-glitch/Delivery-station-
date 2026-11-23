import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { createPoint, listPoints } from '@/lib/services/master-data';

export const GET = route({}, async ({ actor }) => listPoints(prisma, actor));
export const POST = route({ roles: ['ADMIN'] }, async ({ actor, body }) => createPoint(prisma, actor, await body()));
