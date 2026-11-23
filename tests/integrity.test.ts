import { afterAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '@/lib/audit';
import { reconcile } from '@/lib/services/reconcile';
import { dispatch } from '@/lib/services/stock-ops';
import { fixture, key, prisma, rejects } from './helpers';

afterAll(() => prisma.$disconnect());

describe('سلامة البيانات على مستوى قاعدة البيانات', () => {
  it('معيار 8: UPDATE / DELETE / TRUNCATE على stock_movements و audit_logs تفشل', async () => {
    const fx = await fixture({ orange: 3 });
    const m = await prisma.stockMovement.findFirstOrThrow({ where: { productId: fx.product.id } });
    const e1 = await rejects(prisma.$executeRaw`UPDATE stock_movements SET quantity = 999 WHERE id = ${m.id}`);
    expect(e1.message).toMatch(/للإضافة فقط/);
    const e2 = await rejects(prisma.$executeRaw`DELETE FROM stock_movements WHERE id = ${m.id}`);
    expect(e2.message).toMatch(/للإضافة فقط/);
    const e3 = await rejects(prisma.$executeRawUnsafe('TRUNCATE stock_movements CASCADE'));
    expect(e3.message).toMatch(/للإضافة فقط/);
    const a = await prisma.auditLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
    const e4 = await rejects(prisma.$executeRaw`UPDATE audit_logs SET action = 'x' WHERE id = ${a.id}`);
    expect(e4.message).toMatch(/للإضافة فقط/);
    const e5 = await rejects(prisma.auditLog.delete({ where: { id: a.id } }));
    expect(e5.message).toMatch(/للإضافة فقط/);
    expect(await prisma.stockMovement.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ quantity: 3 });
  });

  it('CHECK يمنع الرصيد السالب حتى لو تجاوز أحد الكود', async () => {
    const fx = await fixture({ orange: 2 });
    const e = await rejects(
      prisma.$executeRaw`UPDATE stock_color_balances SET quantity = -1 WHERE product_id = ${fx.product.id} AND color = 'ORANGE'`,
    );
    expect(e.message).toMatch(/balances_quantity_nonneg/);
  });

  it('معيار 9: reconcile يكتشف تعديلاً يدوياً على الرصيد', async () => {
    const fx = await fixture({ orange: 10 });
    await dispatch(prisma, fx.A.keeper, { idempotencyKey: key(), driverId: fx.driver.id, pointId: fx.point.id, lines: [{ productId: fx.product.id, quantity: 2 }] });
    expect((await reconcile(prisma)).ok).toBe(true);

    await prisma.$executeRaw`UPDATE stock_color_balances SET quantity = quantity + 5 WHERE product_id = ${fx.product.id} AND color = 'ORANGE'`;
    await prisma.$executeRaw`UPDATE driver_custody SET quantity = quantity + 1 WHERE driver_id = ${fx.driver.id}`;
    const r = await reconcile(prisma);
    expect(r.ok).toBe(false);
    const bal = r.mismatches.find((x) => x.kind === 'balance' && x.productId === fx.product.id);
    expect(bal).toMatchObject({ color: 'ORANGE', expected: 8, actual: 13 });
    const cus = r.mismatches.find((x) => x.kind === 'custody' && x.driverId === fx.driver.id);
    expect(cus).toMatchObject({ expected: 2, actual: 3 });

    // إرجاع القيم حتى لا تؤثر على بقية الاختبارات
    await prisma.$executeRaw`UPDATE stock_color_balances SET quantity = quantity - 5 WHERE product_id = ${fx.product.id} AND color = 'ORANGE'`;
    await prisma.$executeRaw`UPDATE driver_custody SET quantity = quantity - 1 WHERE driver_id = ${fx.driver.id}`;
    expect((await reconcile(prisma)).ok).toBe(true);
  });

  it('سلسلة التدقيق تكتشف تعديلاً حتى لو عطّل مالك القاعدة الحماية', async () => {
    await fixture({ orange: 1 });
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
    const last = await prisma.auditLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
    await prisma.$executeRawUnsafe('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only');
    try {
      await prisma.$executeRaw`UPDATE audit_logs SET action = 'tampered' WHERE id = ${last.id}`;
      const r = await verifyAuditChain(prisma);
      expect(r.ok).toBe(false);
      expect(r.brokenAtId).toBe(last.id);
      await prisma.$executeRaw`UPDATE audit_logs SET action = ${last.action} WHERE id = ${last.id}`;
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only');
    }
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
  });
});
