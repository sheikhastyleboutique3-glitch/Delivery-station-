import { afterAll, describe, expect, it } from 'vitest';
import { computeCustodyFromMovements, getDriverCustody } from '@/lib/services/custody';
import {
  adminStatusChange,
  customerReturn,
  deliver,
  dispatch,
  resolveRed,
  returnToWarehouse,
  settleDriver,
  sortPurple,
  transfer,
} from '@/lib/services/stock-ops';
import { balance, fixture, key, prisma, rejects, setSetting } from './helpers';

afterAll(async () => {
  await setSetting('autoRestockGoodReturns', false);
  await prisma.$disconnect();
});

describe('الصرف (برتقالي ← أزرق)', () => {
  it('معيار 1: صرف 5 من 20 يجعل البرتقالي 15 والأزرق 5 وعهدة السائق 5', async () => {
    const fx = await fixture({ orange: 20 });
    const res = await dispatch(prisma, fx.A.keeper, {
      idempotencyKey: key(),
      driverId: fx.driver.id,
      pointId: fx.point.id,
      lines: [{ productId: fx.product.id, quantity: 5 }],
    });
    expect(res.operation.status).toBe('PENDING_DRIVER_ACK');
    expect(res.operation.opNo).toMatch(/^DSP-\d{6}$/);
    expect(await balance(fx.product.id, fx.point.id)).toMatchObject({ ORANGE: 15, BLUE: 5 });
    const custody = await getDriverCustody(prisma, fx.driver.id);
    expect(custody.total).toBe(5);
    expect(custody.lines[0]).toMatchObject({ productId: fx.product.id, quantity: 5 });
    const d = await prisma.driver.findUniqueOrThrow({ where: { id: fx.driver.id } });
    expect(d.status).toBe('ON_TRIP');
  });

  it('معيار 2: صرف 25 من 20 يُرفض برسالة عربية دون تغيير أي رقم', async () => {
    const fx = await fixture({ orange: 20 });
    const before = await prisma.stockMovement.count({ where: { productId: fx.product.id } });
    const err = await rejects(
      dispatch(prisma, fx.A.keeper, {
        idempotencyKey: key(),
        driverId: fx.driver.id,
        pointId: fx.point.id,
        lines: [{ productId: fx.product.id, quantity: 25 }],
      }),
    );
    expect(err.code).toBe('INSUFFICIENT_STOCK');
    expect(err.messageAr).toMatch(/أكبر من الرصيد/);
    expect(err.messageAr).toContain('(20)');
    expect(await balance(fx.product.id, fx.point.id)).toMatchObject({ ORANGE: 20, BLUE: 0 });
    expect(await prisma.stockMovement.count({ where: { productId: fx.product.id } })).toBe(before);
    expect(await prisma.operation.count({ where: { kind: 'DISPATCH', driverId: fx.driver.id } })).toBe(0);
  });

  it('سند متعدد الأصناف: إما ينجح كله أو يفشل كله', async () => {
    const fx = await fixture({ orange: 10 });
    const p2 = await prisma.product.create({ data: { name: 'ب', sku: `B-${fx.product.sku}`, barcode: `B-${fx.product.barcode}`, category: 'x', price: 1, cost: 1 } });
    await rejects(
      dispatch(prisma, fx.A.keeper, {
        idempotencyKey: key(),
        driverId: fx.driver.id,
        pointId: fx.point.id,
        lines: [
          { productId: fx.product.id, quantity: 4 },
          { productId: p2.id, quantity: 1 }, // لا رصيد له
        ],
      }),
    );
    expect(await balance(fx.product.id, fx.point.id)).toMatchObject({ ORANGE: 10, BLUE: 0 });
  });

  it('يرفض الصرف لسائق غير نشط أو من نقطة أخرى (لغير المدير)', async () => {
    const fx = await fixture({ orange: 10 });
    await prisma.driver.update({ where: { id: fx.driver2.id }, data: { status: 'INACTIVE' } });
    const e1 = await rejects(
      dispatch(prisma, fx.A.keeper, { idempotencyKey: key(), driverId: fx.driver2.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 1 }] }),
    );
    expect(e1.messageAr).toMatch(/غير نشط/);
    await prisma.driver.update({ where: { id: fx.driver.id }, data: { deliveryPointId: fx.other.id } });
    const e2 = await rejects(
      dispatch(prisma, fx.A.keeper, { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 1 }] }),
    );
    expect(e2.messageAr).toMatch(/لا يتبع هذه النقطة/);
    // المدير يستطيع
    await dispatch(prisma, fx.A.admin, { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 1 }] });
  });
});

describe('التسليم (أزرق ← أخضر)', () => {
  it('يسلّم من العهدة وينشئ عميلاً جديداً، ولا يتجاوز العهدة', async () => {
    const fx = await fixture({ orange: 10 });
    await dispatch(prisma, fx.A.keeper, { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 4 }] });
    const res = await deliver(prisma, fx.A.driver, {
      idempotencyKey: key(),
      driverId: fx.driver.id,
      newCustomer: { name: 'عميل جديد', phone: '+97455000000' },
      lines: [{ productId: fx.product.id, quantity: 3 }],
    });
    expect(res.operation.customer?.name).toBe('عميل جديد');
    expect(await balance(fx.product.id, fx.point.id)).toMatchObject({ ORANGE: 6, BLUE: 1, GREEN: 3 });
    const over = await rejects(
      deliver(prisma, fx.A.driver, { idempotencyKey: key(), driverId: fx.driver.id, customerId: fx.customer.id, lines: [{ productId: fx.product.id, quantity: 2 }] }),
    );
    expect(over.code).toBe('INSUFFICIENT_STOCK');
    expect(over.messageAr).toMatch(/عهدة السائق/);
  });
});

describe('الإرجاع', () => {
  it('معيار 5: إرجاع 1 سليمة و1 تالفة: بنفسجي +1، أحمر +1، أزرق −2', async () => {
    const fx = await fixture({ orange: 10 });
    await dispatch(prisma, fx.A.keeper, { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 5 }] });
    const before = await balance(fx.product.id, fx.point.id);
    await returnToWarehouse(prisma, fx.A.keeper, {
      idempotencyKey: key(),
      driverId: fx.driver.id,
      receivingPointId: fx.point.id,
      lines: [
        { productId: fx.product.id, quantity: 1, condition: 'GOOD' },
        { productId: fx.product.id, quantity: 1, condition: 'DAMAGED', reason: 'كسر' },
      ],
    });
    const after = await balance(fx.product.id, fx.point.id);
    expect(after.BLUE).toBe(before.BLUE - 2);
    expect(after.PURPLE).toBe(before.PURPLE + 1);
    expect(after.RED).toBe(before.RED + 1);
    expect(after.ORANGE).toBe(before.ORANGE);
  });

  it('السبب إلزامي للتالف، وإعداد الإرجاع المباشر يحوّل السليم إلى برتقالي', async () => {
    const fx = await fixture({ orange: 10 });
    await dispatch(prisma, fx.A.keeper, { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 4 }] });
    const e = await rejects(
      returnToWarehouse(prisma, fx.A.keeper, {
        idempotencyKey: key(),
        driverId: fx.driver.id,
        receivingPointId: fx.point.id,
        lines: [{ productId: fx.product.id, quantity: 1, condition: 'DAMAGED' }],
      }),
    );
    expect(e.message).toMatch(/سبب الإرجاع إلزامي/);

    await setSetting('autoRestockGoodReturns', true);
    try {
      await returnToWarehouse(prisma, fx.A.keeper, {
        idempotencyKey: key(),
        driverId: fx.driver.id,
        receivingPointId: fx.point.id,
        lines: [{ productId: fx.product.id, quantity: 2, condition: 'GOOD' }],
      });
    } finally {
      await setSetting('autoRestockGoodReturns', false);
    }
    expect(await balance(fx.product.id, fx.point.id)).toMatchObject({ ORANGE: 8, BLUE: 2, PURPLE: 0 });
  });

  it('الفرز ومعالجة الأحمر ومرتجع العميل', async () => {
    const fx = await fixture({ orange: 10 });
    await dispatch(prisma, fx.A.keeper, { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 6 }] });
    await deliver(prisma, fx.A.driver, { idempotencyKey: key(), driverId: fx.driver.id, customerId: fx.customer.id, lines: [{ productId: fx.product.id, quantity: 2 }] });
    await returnToWarehouse(prisma, fx.A.keeper, {
      idempotencyKey: key(),
      driverId: fx.driver.id,
      receivingPointId: fx.point.id,
      lines: [{ productId: fx.product.id, quantity: 4, condition: 'GOOD' }],
    });
    await sortPurple(prisma, fx.A.keeper, {
      idempotencyKey: key(),
      pointId: fx.point.id,
      lines: [
        { productId: fx.product.id, quantity: 3, result: 'AVAILABLE' },
        { productId: fx.product.id, quantity: 1, result: 'DAMAGED', reason: 'خدش' },
      ],
    });
    await customerReturn(prisma, fx.A.keeper, {
      idempotencyKey: key(),
      receivingPointId: fx.point.id,
      customerId: fx.customer.id,
      lines: [{ productId: fx.product.id, quantity: 1, condition: 'DAMAGED', reason: 'لا يعمل' }],
    });
    expect(await balance(fx.product.id, fx.point.id)).toEqual({ ORANGE: 7, BLUE: 0, GREEN: 1, RED: 2, PURPLE: 0 });

    // أمين المستودع لا يعالج الأحمر
    const e = await rejects(
      resolveRed(prisma, fx.A.keeper, { idempotencyKey: key(), pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 1, action: 'RESTOCK', reason: 'أصلح' }] }),
    );
    expect(e.code).toBe('FORBIDDEN');
    await resolveRed(prisma, fx.A.admin, {
      idempotencyKey: key(),
      pointId: fx.point.id,
      lines: [
        { productId: fx.product.id, quantity: 1, action: 'RESTOCK', reason: 'تم الإصلاح' },
        { productId: fx.product.id, quantity: 1, action: 'WRITE_OFF', reason: 'تالف نهائياً' },
      ],
    });
    expect(await balance(fx.product.id, fx.point.id)).toEqual({ ORANGE: 8, BLUE: 0, GREEN: 1, RED: 0, PURPLE: 0 });
  });
});

describe('العهدة والتسوية', () => {
  it('getDriverCustody يطابق الحساب من سجل الحركات', async () => {
    const fx = await fixture({ orange: 30 });
    await dispatch(prisma, fx.A.keeper, { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 12 }] });
    await deliver(prisma, fx.A.driver, { idempotencyKey: key(), driverId: fx.driver.id, customerId: fx.customer.id, lines: [{ productId: fx.product.id, quantity: 5 }] });
    await returnToWarehouse(prisma, fx.A.keeper, {
      idempotencyKey: key(),
      driverId: fx.driver.id,
      receivingPointId: fx.point.id,
      lines: [{ productId: fx.product.id, quantity: 3, condition: 'GOOD' }],
    });
    const custody = await getDriverCustody(prisma, fx.driver.id);
    const fromLedger = await computeCustodyFromMovements(prisma, fx.driver.id);
    expect(custody.total).toBe(12 - 5 - 3);
    expect(fromLedger.get(`${fx.product.id}|${fx.point.id}`)).toBe(custody.total);
  });

  it('التسوية ترفض مع عهدة مفتوحة، وتسجل المتبقي عجزاً (أحمر) عند الطلب', async () => {
    const fx = await fixture({ orange: 10 });
    await dispatch(prisma, fx.A.keeper, { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 3 }] });
    const e = await rejects(settleDriver(prisma, fx.A.keeper, { idempotencyKey: key(), driverId: fx.driver.id }));
    expect(e.code).toBe('CONFLICT');
    const res = await settleDriver(prisma, fx.A.keeper, {
      idempotencyKey: key(),
      driverId: fx.driver.id,
      markRemainingAsShortage: true,
      reason: 'لم يُرجع',
    });
    expect(res.operation.settlement?.summary).toMatchObject({ dispatched: 3, shortageRecorded: 3, remainingBefore: 3 });
    expect(await balance(fx.product.id, fx.point.id)).toMatchObject({ ORANGE: 7, BLUE: 0, RED: 3 });
    const d = await prisma.driver.findUniqueOrThrow({ where: { id: fx.driver.id } });
    expect(d.status).toBe('AVAILABLE');
    expect(d.lastSettledAt).not.toBeNull();
  });
});

describe('التحويل والقطع الفردية والتعديل الاستثنائي', () => {
  it('التحويل ينقل البرتقالي بين النقاط', async () => {
    const fx = await fixture({ orange: 10 });
    await transfer(prisma, fx.A.keeper, { idempotencyKey: key(), fromPointId: fx.point.id, toPointId: fx.other.id, lines: [{ productId: fx.product.id, quantity: 4 }] });
    expect((await balance(fx.product.id, fx.point.id)).ORANGE).toBe(6);
    expect((await balance(fx.product.id, fx.other.id)).ORANGE).toBe(4);
  });

  it('المنتج المتتبع بالقطعة: كل قطعة تتبع لونها وموقعها', async () => {
    const fx = await fixture({ orange: 4, trackUnits: true });
    const [s1, s2, s3] = fx.serials;
    // الكمية يجب أن تساوي عدد الأرقام التسلسلية
    const e = await rejects(
      dispatch(prisma, fx.A.keeper, { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 2, unitSerials: [s1] }] }),
    );
    expect(e.message).toMatch(/رقم تسلسلي/);
    await dispatch(prisma, fx.A.keeper, { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 3, unitSerials: [s1, s2, s3] }] });
    await deliver(prisma, fx.A.driver, { idempotencyKey: key(), driverId: fx.driver.id, customerId: fx.customer.id, lines: [{ productId: fx.product.id, quantity: 1, unitSerials: [s2] }] });
    const units = await prisma.inventoryUnit.findMany({ where: { productId: fx.product.id }, orderBy: { serial: 'asc' } });
    const bySerial = Object.fromEntries(units.map((u) => [u.serial, u]));
    expect(bySerial[s1]).toMatchObject({ color: 'BLUE', driverId: fx.driver.id });
    expect(bySerial[s2]).toMatchObject({ color: 'GREEN', driverId: null });
    expect(bySerial[fx.serials[3]]).toMatchObject({ color: 'ORANGE' });
    // قطعة سُلّمت لا يمكن تسليمها مرة ثانية
    const again = await rejects(
      deliver(prisma, fx.A.driver, { idempotencyKey: key(), driverId: fx.driver.id, customerId: fx.customer.id, lines: [{ productId: fx.product.id, quantity: 1, unitSerials: [s2] }] }),
    );
    expect(again.message).toMatch(/ليست في عهدة/);
  });

  it('التعديل الاستثنائي للمدير فقط ولا يمس الأزرق', async () => {
    const fx = await fixture({ orange: 5 });
    const e1 = await rejects(
      adminStatusChange(prisma, fx.A.keeper, { idempotencyKey: key(), pointId: fx.point.id, productId: fx.product.id, fromColor: 'ORANGE', toColor: 'RED', quantity: 1, reason: 'x' }),
    );
    expect(e1.code).toBe('FORBIDDEN');
    const e2 = await rejects(
      adminStatusChange(prisma, fx.A.admin, { idempotencyKey: key(), pointId: fx.point.id, productId: fx.product.id, fromColor: 'ORANGE', toColor: 'BLUE', quantity: 1, reason: 'x' }),
    );
    expect(e2.code).toBe('INVALID_TRANSITION');
    await adminStatusChange(prisma, fx.A.admin, { idempotencyKey: key(), pointId: fx.point.id, productId: fx.product.id, fromColor: 'ORANGE', toColor: 'RED', quantity: 2, reason: 'جرد: وجد تالف' });
    expect(await balance(fx.product.id, fx.point.id)).toMatchObject({ ORANGE: 3, RED: 2 });
  });
});
