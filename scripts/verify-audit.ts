/** فحص سلامة سلسلة سجل التدقيق: npm run audit:verify */
import { PrismaClient } from '@prisma/client';
import { verifyAuditChain } from '../src/lib/audit';

const prisma = new PrismaClient();

verifyAuditChain(prisma)
  .then((r) => {
    if (r.ok) console.log(`✓ سلسلة التدقيق سليمة (${r.checked} سجل)`);
    else {
      console.error(`✗ ${r.reason} — عند السجل رقم ${r.brokenAtId}`);
      process.exitCode = 1;
    }
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
