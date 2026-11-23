import 'server-only';
import { cookies, headers } from 'next/headers';
import { prisma } from '../db';
import type { Actor } from '../actor';
import { Errors } from '../errors';
import type { Role } from '../domain';
import { SESSION_COOKIE, sessionHours, signSession, verifySession } from './token';

export async function clientInfo() {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  const ip = (fwd ? fwd.split(',')[0] : h.get('x-real-ip'))?.trim() || null;
  return { ip, userAgent: h.get('user-agent') };
}

/**
 * يقرأ الجلسة ويتحقق من المستخدم في قاعدة البيانات في كل طلب،
 * فالحساب المعطّل أو الذي تغيّرت كلمة مروره يُطرد فوراً.
 */
export async function getActor(): Promise<Actor | null> {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, name: true, role: true, deliveryPointId: true, isActive: true, tokenVersion: true, driver: { select: { id: true } } },
  });
  if (!user || !user.isActive || user.tokenVersion !== claims.tv) return null;
  const info = await clientInfo();
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    deliveryPointId: user.deliveryPointId,
    driverId: user.driver?.id ?? null,
    ip: info.ip,
    userAgent: info.userAgent,
  };
}

export async function requireActor(roles?: readonly Role[]): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw Errors.unauthorized();
  if (roles && !roles.includes(actor.role)) throw Errors.forbidden();
  return actor;
}

export async function setSessionCookie(user: {
  id: string;
  name: string;
  role: Role;
  deliveryPointId: string | null;
  driverId: string | null;
  tokenVersion: number;
}) {
  const token = await signSession({
    sub: user.id,
    name: user.name,
    role: user.role,
    pointId: user.deliveryPointId,
    driverId: user.driverId,
    tv: user.tokenVersion,
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: sessionHours() * 3600,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
}
