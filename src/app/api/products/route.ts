import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { createProduct, listProducts } from '@/lib/services/master-data';

export const GET = route({}, async ({ actor, query }) => listProducts(prisma, actor, query));
export const POST = route({ roles: ['ADMIN', 'WAREHOUSE'] }, async ({ actor, body }) => createProduct(prisma, actor, await body()));
