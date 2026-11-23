import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { getDriver, updateDriver } from '@/lib/services/master-data';

type P = { id: string };
export const GET = route<P>({}, async ({ actor, params }) => getDriver(prisma, actor, params.id));
export const PATCH = route<P>({ roles: ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER'] }, async ({ actor, params, body }) =>
  updateDriver(prisma, actor, params.id, await body()),
);
