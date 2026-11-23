import type { Metadata } from 'next';
import { ReturnsView } from './returns-view';

export const metadata: Metadata = { title: 'استلام المرتجعات' };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <ReturnsView initialDriverId={sp.driverId ?? ''} initialTab={sp.tab === 'customer' ? 'customer' : 'driver'} />;
}
