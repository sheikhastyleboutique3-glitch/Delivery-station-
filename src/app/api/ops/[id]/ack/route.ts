import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { acknowledgeDispatch } from '@/lib/services/stock-ops';

type P = { id: string };
export const POST = route<P>({ roles: ['DRIVER', 'ADMIN'] }, async ({ actor, params }) => acknowledgeDispatch(prisma, actor, params.id));
