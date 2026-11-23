import { afterAll, describe, expect, it } from 'vitest';
import { getDriver, createProduct, listDrivers, updateProduct } from '@/lib/services/master-data';
import { getWarehouseView, listMovements } from '@/lib/services/queries';
import { deliver, dispatch, returnToWarehouse, settleDriver, stockIn } from '@/lib/services/stock-ops';
import { fixture, key, prisma, rejects } from './helpers';

afterAll(() => prisma.$disconnect());

describe('الصلاحيات', () => {
  it('معيار 6: السائق لا يصل لسائق آخر ولا لإدارة المنتجات (403)', async () => {
    const fx = await fixture({ orange: 10 });
    await dispatch(prisma, fx.A.keeper, { idempotencyKey: key(), driverId: fx.driver2.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 2 }] });

    const cases: (() => Promise<unknown>)[] = [
      () => getDriver(prisma, fx.A.driver, fx.driver2.id),
      () => deliver(prisma, fx.A.driver, { idempotencyKey: key(), driverId: fx.driver2.id, customerId: fx.customer.id, lines: [{ productId: fx.product.id, quantity: 1 }] }),
      () => createProduct(prisma, fx.A.driver, { name: 'x', sku: 'X1', barcode: 'X1', category: 'x', price: 1, cost: 1 }),
      () => updateProduct(prisma, fx.A.driver, fx.product.id, { name: 'y' }),
      () => dispatch(prisma, fx.A.driver, { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 1 }] }),
      () => stockIn(prisma, fx.A.driver, { idempotencyKey: key(), pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 1 }] }),
      () => returnToWarehouse(prisma, fx.A.driver, {
        idempotencyKey: key(),
        driverId: fx.driver.id,
        receivingPointId: fx.point.id,
        lines: [{ productId: fx.product.id, quantity: 1, condition: 'GOOD' }],
      }),
      () => listDrivers(prisma, fx.A.driver, {}),
    ];
    for (const c of cases) {
      const e = await rejects(c());
      expect(e.status).toBe(403);
    }
    // السائق يرى حركاته فقط
    const mine = await listMovements(prisma, fx.A.driver, {});
    expect(mine.items.every((m) => m.driverId === fx.driver.id)).toBe(true);
  });

  it('معيار 7: مسؤول النقطة لا يرى ولا يعمل على نقطة أخرى', async () => {
    const fx = await fixture({ orange: 10 });
    const e1 = await rejects(getWarehouseView(prisma, fx.A.otherHub, { pointId: fx.point.id }));
    expect(e1.status).toBe(403);
    const e2 = await rejects(stockIn(prisma, fx.A.otherHub, { idempotencyKey: key(), pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 1 }] }));
    expect(e2.status).toBe(403);
    const e3 = await rejects(getDriver(prisma, fx.A.otherHub, fx.driver.id));
    expect(e3.status).toBe(403);
    const e4 = await rejects(settleDriver(prisma, fx.A.otherHub, { idempotencyKey: key(), driverId: fx.driver.id }));
    expect(e4.status).toBe(403);

    // عرضه الافتراضي مقيّد بنقطته: منتج النقطة الأولى يظهر بلا أرصدة
    const view = await getWarehouseView(prisma, fx.A.otherHub, { q: fx.product.sku });
    expect(view.pointId).toBe(fx.other.id);
    expect(view.items[0]?.colors.ORANGE ?? 0).toBe(0);
    const drivers = await listDrivers(prisma, fx.A.otherHub, {});
    expect(drivers.items.find((d) => d.id === fx.driver.id)).toBeUndefined();
  });

  it('السائق لا يرى التكلفة', async () => {
    const fx = await fixture();
    const { lookupCode } = await import('@/lib/services/queries');
    const r = await lookupCode(prisma, fx.A.driver, fx.product.barcode);
    expect(r.found && r.product.cost).toBeNull();
    const r2 = await lookupCode(prisma, fx.A.keeper, fx.product.barcode);
    expect(r2.found && r2.product.cost).toBe('5');
  });
});
