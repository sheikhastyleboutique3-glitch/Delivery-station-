import { prisma } from '@/lib/db';
import { route } from '@/lib/api/handler';
import { Errors } from '@/lib/errors';
import type { Actor } from '@/lib/actor';
import type { Db } from '@/lib/db';
import type { OperationResult } from '@/lib/stock/engine';
import {
  adminStatusChange,
  customerReturn,
  deliver,
  dispatch,
  resolveRed,
  returnToWarehouse,
  settleDriver,
  sortPurple,
  stockIn,
  transfer,
} from '@/lib/services/stock-ops';

const ACTIONS: Record<string, (db: Db, actor: Actor, raw: unknown) => Promise<OperationResult>> = {
  'stock-in': stockIn,
  dispatch,
  deliver,
  return: returnToWarehouse,
  sort: sortPurple,
  'resolve-red': resolveRed,
  'customer-return': customerReturn,
  transfer,
  settle: settleDriver,
  'status-change': adminStatusChange,
};

type P = { action: string };
export const POST = route<P>({}, async ({ actor, params, body }) => {
  const fn = ACTIONS[params.action];
  if (!fn) throw Errors.notFound('الإجراء');
  const result = await fn(prisma, actor, await body());
  return Response.json(
    { ok: true, data: result.operation, replayed: result.replayed },
    { status: result.replayed ? 200 : 201, headers: { 'Cache-Control': 'no-store' } },
  );
});
