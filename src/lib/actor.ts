import type { Role } from './domain';
import { Errors } from './errors';

/** المستخدم المنفّذ للطلب الحالي */
export interface Actor {
  id: string;
  name: string;
  role: Role;
  deliveryPointId: string | null;
  driverId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export function requireRole(actor: Actor, roles: readonly Role[]): void {
  if (!roles.includes(actor.role)) throw Errors.forbidden();
}

/**
 * النقطة التي يُقيَّد بها المستخدم، أو null إذا كان يرى كل النقاط.
 * - ADMIN: كل النقاط.
 * - HUB_MANAGER: نقطته فقط دائماً.
 * - WAREHOUSE: نقطته إذا رُبط بنقطة، وإلا كل النقاط.
 * - DRIVER: نقطته (للقراءة فقط).
 */
export function scopedPointId(actor: Actor): string | null {
  if (actor.role === 'ADMIN') return null;
  if (actor.role === 'HUB_MANAGER') {
    if (!actor.deliveryPointId) throw Errors.forbidden('حساب مسؤول النقطة غير مرتبط بنقطة دليفري');
    return actor.deliveryPointId;
  }
  return actor.deliveryPointId;
}

export function assertPointAccess(actor: Actor, pointId: string): void {
  const scope = scopedPointId(actor);
  if (scope && scope !== pointId) throw Errors.forbidden('لا يمكنك العمل على نقطة دليفري غير نقطتك');
}

export function assertDriverSelf(actor: Actor, driverId: string): void {
  if (actor.role === 'DRIVER' && actor.driverId !== driverId) {
    throw Errors.forbidden('لا يمكنك الوصول إلى بيانات سائق آخر');
  }
}
