import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { createUser, listUsers } from '@/lib/services/master-data';

export const GET = route({ roles: ['ADMIN'] }, async ({ actor }) => listUsers(prisma, actor));
export const POST = route({ roles: ['ADMIN'] }, async ({ actor, body }) => createUser(prisma, actor, await body()));
