import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { getProduct, updateProduct } from '@/lib/services/master-data';

type P = { id: string };
export const GET = route<P>({}, async ({ actor, params }) => getProduct(prisma, actor, params.id));
export const PATCH = route<P>({ roles: ['ADMIN', 'WAREHOUSE'] }, async ({ actor, params, body }) =>
  updateProduct(prisma, actor, params.id, await body()),
);
