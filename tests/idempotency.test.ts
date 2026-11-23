import { afterAll, describe, expect, it } from 'vitest';
import { dispatch } from '@/lib/services/stock-ops';
import { balance, fixture, key, prisma, rejects } from './helpers';

afterAll(() => prisma.$disconnect());

describe('منع التكرار (Idempotency)', () => {
  it('معيار 4: إعادة إرسال نفس الطلب بنفس المفتاح لا تنتج حركة ثانية', async () => {
    const fx = await fixture({ orange: 10 });
    const body = { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 3 }] };
    const first = await dispatch(prisma, fx.A.keeper, body);
    const second = await dispatch(prisma, fx.A.keeper, body);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.operation.id).toBe(first.operation.id);
    expect(await prisma.stockMovement.count({ where: { operationId: first.operation.id } })).toBe(1);
    expect(await balance(fx.product.id, fx.point.id)).toMatchObject({ ORANGE: 7, BLUE: 3 });
  });

  it('نفس المفتاح بطلب مختلف يُرفض', async () => {
    const fx = await fixture({ orange: 10 });
    const k = key();
    await dispatch(prisma, fx.A.keeper, { idempotencyKey: k, driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 1 }] });
    const e = await rejects(
      dispatch(prisma, fx.A.keeper, { idempotencyKey: k, driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 2 }] }),
    );
    expect(e.code).toBe('CONFLICT');
  });

  it('نفس المفتاح يصل مرتين في نفس اللحظة (ضعف الشبكة) — عملية واحدة فقط', async () => {
    const fx = await fixture({ orange: 10 });
    const body = { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 2 }] };
    const results = await Promise.all(Array.from({ length: 5 }, () => dispatch(prisma, fx.A.keeper, body)));
    const ids = new Set(results.map((r) => r.operation.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await balance(fx.product.id, fx.point.id)).toMatchObject({ ORANGE: 8, BLUE: 2 });
  });
});
