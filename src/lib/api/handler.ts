import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Actor } from '../actor';
import { AppError, Errors, toErrorBody } from '../errors';
import { requireActor } from '../auth/session';
import type { Role } from '../domain';

export const CSRF_HEADER = 'x-rasd-request';

interface Ctx<P> {
  req: NextRequest;
  actor: Actor;
  params: P;
  query: Record<string, string | undefined>;
  body: () => Promise<unknown>;
}

interface Options {
  roles?: readonly Role[];
  public?: boolean;
}

/**
 * حماية CSRF: الكوكي SameSite=Lax + ترويسة مخصصة لا يستطيع موقع آخر إرسالها
 * دون CORS (ولا نسمح بـ CORS) + مطابقة Origin إن وُجد.
 */
export function assertSameOrigin(req: NextRequest) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (req.headers.get(CSRF_HEADER) !== '1') throw Errors.forbidden('طلب مرفوض (CSRF)');
  const origin = req.headers.get('origin');
  if (origin) {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!host || originHost !== host) throw Errors.forbidden('طلب مرفوض: مصدر غير موثوق');
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(err: unknown) {
  const { status, body } = toErrorBody(err);
  return NextResponse.json({ ok: false, error: body }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function queryOf(req: NextRequest) {
  const out: Record<string, string | undefined> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    if (v !== '') out[k] = v;
  });
  return out;
}

export function route<P = Record<string, never>, T = unknown>(
  opts: Options,
  fn: (ctx: Ctx<P>) => Promise<T | Response>,
) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    try {
      assertSameOrigin(req);
      const actor = opts.public ? (null as unknown as Actor) : await requireActor(opts.roles);
      const params = (await context?.params) ?? ({} as P);
      const result = await fn({
        req,
        actor,
        params,
        query: queryOf(req),
        body: async () => {
          try {
            return await req.json();
          } catch {
            throw new AppError('BAD_JSON', 400, 'محتوى الطلب ليس JSON صحيحاً');
          }
        },
      });
      if (result instanceof Response) return result;
      return ok(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
      return fail(err);
    }
  };
}
