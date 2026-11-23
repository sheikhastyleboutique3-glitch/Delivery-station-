import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { updateUser } from '@/lib/services/master-data';

type P = { id: string };
export const PATCH = route<P>({ roles: ['ADMIN'] }, async ({ actor, params, body }) => updateUser(prisma, actor, params.id, await body()));
