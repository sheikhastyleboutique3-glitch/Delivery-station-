import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { getReturnable } from '@/lib/hr/returns';

type P = { id: string };
export const GET = route<P>({ roles: ['ADMIN', 'WAREHOUSE', 'HUB_MANAGER'] }, async ({ actor, params }) => getReturnable(prisma, actor, params.id));
