import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { pageSchema } from '@/lib/validation';

export const GET = route({ roles: ['ADMIN'] }, async ({ query }) => {
  const page = pageSchema.parse(query.page);
  const pageSize = 50;
  const where = {
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.action ? { action: { contains: query.action } } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { name: true, role: true } } },
    }),
  ]);
  return { items, total, page, pageSize };
});
