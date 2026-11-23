import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { getDriver } from '@/lib/services/master-data';
import { getDriverCustody } from '@/lib/services/custody';

type P = { id: string };
export const GET = route<P>({}, async ({ actor, params }) => {
  await getDriver(prisma, actor, params.id); // يتحقق من الصلاحية والنطاق
  return getDriverCustody(prisma, params.id);
});
