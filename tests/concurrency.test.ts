import { afterAll, describe, expect, it } from 'vitest';
import { deliver, dispatch } from '@/lib/services/stock-ops';
import { reconcile } from '@/lib/services/reconcile';
import { balance, fixture, key, prisma } from './helpers';

afterAll(() => prisma.$disconnect());

describe('التزامن', () => {
  it('معيار 3: طلبات صرف متزامنة على آخر وحدة متاحة — ينجح واحد فقط', async () => {
    const fx = await fixture({ orange: 1 });
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        dispatch(prisma, fx.A.keeper, {
          idempotencyKey: key(),
          driverId: i % 2 ? fx.driver.id : fx.driver2.id,
          pointId: fx.point.id,
          lines: [{ productId: fx.product.id, quantity: 1 }],
        }),
      ),
    );
    const ok = attempts.filter((a) => a.status === 'fulfilled');
    const failed = attempts.filter((a) => a.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(7);
    for (const f of failed) expect((f.reason as { code: string }).code).toBe('INSUFFICIENT_STOCK');
    expect(await balance(fx.product.id, fx.point.id)).toMatchObject({ ORANGE: 0, BLUE: 1 });
  });

  it('عمليات متزامنة متشابكة (صرف + تسليم) تبقي الأرصدة مطابقة للسجل', async () => {
    const fx = await fixture({ orange: 40 });
    await dispatch(prisma, fx.A.keeper, { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 10 }] });
    const jobs = [
      ...Array.from({ length: 6 }, () =>
        dispatch(prisma, fx.A.keeper, { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 2 }] }),
      ),
      ...Array.from({ length: 6 }, () =>
        deliver(prisma, fx.A.driver, { idempotencyKey: key(), driverId: fx.driver.id, customerId: fx.customer.id, lines: [{ productId: fx.product.id, quantity: 1 }] }),
      ),
    ];
    const results = await Promise.allSettled(jobs);
    expect(results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason?.message).slice(0, 300))).toEqual([]);
    expect(await balance(fx.product.id, fx.point.id)).toMatchObject({ ORANGE: 18, BLUE: 16, GREEN: 6 });
    const r = await reconcile(prisma);
    expect(r.mismatches).toEqual([]);
  });
});
