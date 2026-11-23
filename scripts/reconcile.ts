/** فحص تطابق الأرصدة مع سجل الحركات من سطر الأوامر: npm run reconcile */
import { PrismaClient } from '@prisma/client';
import { applyDatabaseEnv } from '../src/lib/env';

applyDatabaseEnv();
import { reconcile } from '../src/lib/services/reconcile';

const prisma = new PrismaClient();

reconcile(prisma)
  .then((r) => {
    if (r.ok) {
      console.log(`✓ كل الأرصدة مطابقة (${r.balanceRows} رصيد لوني، ${r.custodyRows} عهدة سائق)`);
    } else {
      console.error(`✗ ${r.mismatches.length} فرق بين الأرصدة وسجل الحركات:`);
      for (const m of r.mismatches) {
        console.error(`  [${m.kind}] ${m.productName} @ ${m.pointName} ${m.color ?? ''}${m.driverId ? ` driver=${m.driverId}` : ''}: المتوقع ${m.expected} والمخزن ${m.actual}`);
      }
      process.exitCode = 1;
    }
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
