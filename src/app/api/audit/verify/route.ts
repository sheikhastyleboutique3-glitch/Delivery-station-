import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { verifyAuditChain } from '@/lib/audit';

export const GET = route({ roles: ['ADMIN'] }, async () => verifyAuditChain(prisma));
