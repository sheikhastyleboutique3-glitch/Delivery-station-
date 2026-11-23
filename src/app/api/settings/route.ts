import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { getSettings } from '@/lib/settings';
import { updateSettings } from '@/lib/services/master-data';

export const GET = route({}, async () => getSettings(prisma));
export const PUT = route({ roles: ['ADMIN'] }, async ({ actor, body }) => updateSettings(prisma, actor, await body()));
