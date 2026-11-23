import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { createDriver, listDrivers } from '@/lib/services/master-data';

const STAFF = ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER'] as const;
export const GET = route({ roles: STAFF }, async ({ actor, query }) => listDrivers(prisma, actor, query));
export const POST = route({ roles: STAFF }, async ({ actor, body }) => createDriver(prisma, actor, await body()));
