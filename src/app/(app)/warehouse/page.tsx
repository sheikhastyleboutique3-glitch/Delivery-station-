import type { Metadata } from 'next';
import { COLORS, type StockColor } from '@/lib/domain';
import { WarehouseView } from './warehouse-view';

export const metadata: Metadata = { title: 'المستودع بالألوان' };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const color = COLORS.includes(sp.color as StockColor) ? (sp.color as StockColor) : null;
  return <WarehouseView initialColor={color} initialQ={sp.q ?? ''} />;
}
