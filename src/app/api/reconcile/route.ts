import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { reconcile } from '@/lib/services/reconcile';

export const GET = route({ roles: ['ADMIN'] }, async () => reconcile(prisma));
