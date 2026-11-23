import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { createCustomer, listCustomers } from '@/lib/services/master-data';

export const GET = route({}, async ({ actor, query }) => listCustomers(prisma, actor, query));
export const POST = route({}, async ({ actor, body }) => createCustomer(prisma, actor, await body()));
