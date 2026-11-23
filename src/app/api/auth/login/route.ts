import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { loginSchema } from '@/lib/validation';
import { Errors } from '@/lib/errors';
import { dummyHash, verifyPassword } from '@/lib/auth/password';
import { assertNotLocked, clearFailures, recordFailure } from '@/lib/auth/rate-limit';
import { clientInfo, setSessionCookie } from '@/lib/auth/session';
import { writeAudit } from '@/lib/audit';

export const POST = route({ public: true }, async ({ body }) => {
  const input = loginSchema.parse(await body());
  const { ip, userAgent } = await clientInfo();
  await assertNotLocked(prisma, ip, input.email);

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { driver: { select: { id: true } } },
  });
  const valid = await verifyPassword(input.password, user?.passwordHash ?? (await dummyHash()));
  if (!user || !valid || !user.isActive) {
    await recordFailure(prisma, ip, input.email);
    throw Errors.validation(user && valid && !user.isActive ? 'هذا الحساب معطّل' : 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
  }
  await clearFailures(prisma, ip, input.email);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await writeAudit(tx, { id: user.id, ip, userAgent }, { action: 'auth.login', entityType: 'user', entityId: user.id });
  });
  await setSessionCookie({
    id: user.id,
    name: user.name,
    role: user.role,
    deliveryPointId: user.deliveryPointId,
    driverId: user.driver?.id ?? null,
    tokenVersion: user.tokenVersion,
  });
  return { id: user.id, name: user.name, role: user.role, home: user.role === 'DRIVER' ? '/driver' : '/' };
});
