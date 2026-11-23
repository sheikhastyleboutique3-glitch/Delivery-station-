import type { Metadata } from 'next';
import { COLORS, MOVEMENT_TYPES, type MovementType, type StockColor } from '@/lib/domain';
import { MovementsView } from './movements-view';

export const metadata: Metadata = { title: 'سجل الحركات' };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <MovementsView
      initial={{
        productId: sp.productId,
        driverId: sp.driverId,
        pointId: sp.pointId,
        customerId: sp.customerId,
        color: COLORS.includes(sp.color as StockColor) ? (sp.color as StockColor) : undefined,
        type: MOVEMENT_TYPES.includes(sp.type as MovementType) ? sp.type : undefined,
        from: sp.from,
        to: sp.to,
        q: sp.q,
      }}
    />
  );
}
