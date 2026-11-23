import { route } from '@/lib/api/handler';

export const GET = route({}, async ({ actor }) => ({
  id: actor.id,
  name: actor.name,
  role: actor.role,
  deliveryPointId: actor.deliveryPointId,
  driverId: actor.driverId,
}));
