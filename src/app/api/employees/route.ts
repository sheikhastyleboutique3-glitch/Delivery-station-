import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { createEmployee, listEmployees } from '@/lib/hr/employees';

export const GET = route({ roles: ['ADMIN'] }, async ({ actor, query }) => listEmployees(prisma, actor, query));
export const POST = route({ roles: ['ADMIN'] }, async ({ actor, body }) => createEmployee(prisma, actor, await body()));
