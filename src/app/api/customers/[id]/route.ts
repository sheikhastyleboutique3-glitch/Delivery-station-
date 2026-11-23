import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { updateCustomer } from '@/lib/services/master-data';

type P = { id: string };
export const PATCH = route<P>({ roles: ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER'] }, async ({ actor, params, body }) =>
  updateCustomer(prisma, actor, params.id, await body()),
);
