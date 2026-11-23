import { redirect } from 'next/navigation';
import { getActor } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { AppProvider } from '@/components/providers';
import { AppShell } from '@/components/app-shell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect('/login');
  const [settings, point] = await Promise.all([
    getSettings(prisma),
    actor.deliveryPointId ? prisma.deliveryPoint.findUnique({ where: { id: actor.deliveryPointId }, select: { name: true } }) : null,
  ]);
  return (
    <AppProvider
      settings={settings}
      user={{
        id: actor.id,
        name: actor.name,
        role: actor.role,
        deliveryPointId: actor.deliveryPointId,
        driverId: actor.driverId,
        pointName: point?.name ?? null,
      }}
    >
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
