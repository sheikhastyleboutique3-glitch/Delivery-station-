import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { Errors } from '@/lib/errors';
import { operationInclude } from '@/lib/stock/engine';
import { assertOperationAccess } from '@/lib/services/queries';

type P = { id: string };
export const GET = route<P>({}, async ({ actor, params }) => {
  const op = await prisma.operation.findUnique({
    where: { id: params.id },
    include: { ...operationInclude, driver: { select: { id: true, fullName: true, phone: true, vehiclePlate: true, deliveryPointId: true } } },
  });
  if (!op) throw Errors.notFound('السند');
  assertOperationAccess(actor, op);
  return op;
});
