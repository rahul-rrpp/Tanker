import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge gate: no session cookies → /login. Whether the user is really an administrator is decided by the
 * backend on every request (the console also checks /admin/auth/me and signs out non-admins).
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get('ttms_at')?.value || req.cookies.get('ttms_rt')?.value);
  if (pathname === '/login') return NextResponse.next();
  if (!hasSession) {
    const url = new URL('/login', req.url);
    if (pathname !== '/' && pathname !== '/dashboard') url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)'],
};
