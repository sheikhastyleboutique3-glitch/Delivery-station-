import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/token';

/**
 * حارس الصفحات (Next.js 16 proxy). يوجّه غير المسجلين إلى /login
 * ويبقي السائق داخل واجهته. الحماية الفعلية للبيانات في الـ API نفسه.
 */
const ADMIN_ONLY = ['/users', '/settings', '/audit', '/points'];
const DRIVER_ALLOWED = ['/driver', '/ops'];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === '/login') {
    if (claims) return NextResponse.redirect(new URL(claims.role === 'DRIVER' ? '/driver' : '/', req.url));
    return NextResponse.next();
  }

  if (!claims) {
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }

  if (claims.role === 'DRIVER' && !DRIVER_ALLOWED.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.redirect(new URL('/driver', req.url));
  }
  if (claims.role !== 'ADMIN' && ADMIN_ONLY.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.redirect(new URL('/', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icons|logo|manifest.webmanifest|sw.js|offline.html|.*\\.(?:svg|png|jpg|ico|webp)$).*)'],
};
