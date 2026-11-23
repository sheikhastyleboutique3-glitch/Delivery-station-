'use client';

import type { StockColor } from '@/lib/domain';
import { qs } from '@/lib/client/api';
import { useApi } from '@/lib/client/hooks';

/** أرصدة الأصناف المضافة في النقطة المختارة، تتحدث كل 15 ثانية */
export function useBalances(pointId: string, productIds: string[]) {
  const ids = [...new Set(productIds)].sort().join(',');
  const { data, reload } = useApi<Record<string, Record<StockColor, number>>>(
    pointId && ids ? `/api/balances${qs({ pointId, productIds: ids })}` : null,
    { refreshMs: 15_000 },
  );
  return {
    ready: !!data,
    reload,
    get: (productId: string, color: StockColor): number | undefined => (data ? data[productId]?.[color] ?? 0 : undefined),
  };
}
