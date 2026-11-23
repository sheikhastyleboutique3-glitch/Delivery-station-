import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '../domain';

/** يعمل في Node وفي proxy.ts (لا يستورد Prisma) */

export const SESSION_COOKIE = 'rasd_session';

export interface SessionClaims {
  sub: string;
  role: Role;
  name: string;
  pointId: string | null;
  driverId: string | null;
  tv: number; // token version
}

let cachedKey: Uint8Array | null = null;
function secretKey(): Uint8Array {
  if (cachedKey) return cachedKey;
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET غير مضبوط أو أقصر من 32 حرفاً. أضفه في متغيرات البيئة.');
  }
  cachedKey = new TextEncoder().encode(secret);
  return cachedKey;
}

export function sessionHours(): number {
  const h = Number(process.env.SESSION_HOURS ?? 12);
  return Number.isFinite(h) && h > 0 && h <= 24 * 30 ? h : 12;
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role, name: claims.name, pointId: claims.pointId, driverId: claims.driverId, tv: claims.tv })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('rasd')
    .setAudience('rasd')
    .setExpirationTime(`${sessionHours()}h`)
    .sign(secretKey());
}

export async function verifySession(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: 'rasd', audience: 'rasd', algorithms: ['HS256'] });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      role: payload.role as Role,
      name: String(payload.name ?? ''),
      pointId: (payload.pointId as string | null) ?? null,
      driverId: (payload.driverId as string | null) ?? null,
      tv: Number(payload.tv ?? 0),
    };
  } catch {
    return null;
  }
}
