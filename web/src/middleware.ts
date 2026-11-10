import { NextResponse, type NextRequest } from 'next/server';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const PROTECTED = ['/company', '/transporter', '/employee', '/admin', '/agency', '/finance', '/customer', '/driver', '/account', '/pending-verification'];
const GUEST_ONLY = ['/login', '/register', '/signup', '/forgot-password', '/reset-password', '/verify-otp'];

/**
 * Phase 1 releases only the Company Portal. Screens for other roles stay in the codebase (backend-ready)
 * but are not reachable unless NEXT_PUBLIC_ENABLED_PORTALS=all.
 */
const LEGACY_PORTALS = ['/admin', '/agency', '/finance', '/customer', '/driver', '/account', '/pending-verification', '/signup', '/verify-otp'];
const released = new Set((process.env.NEXT_PUBLIC_ENABLED_PORTALS ?? 'company').split(',').map((s) => s.trim()));
const legacyEnabled = released.has('all');
const hidden = (path: string) => {
  if (path === '/transporter' || path.startsWith('/transporter/') || path.startsWith('/register/transporter')) return !legacyEnabled && !released.has('transporter');
  if (path === '/employee' || path.startsWith('/employee/') || path.startsWith('/login/employee')) return !legacyEnabled && !released.has('employee');
  // /driver/app is the legacy stub; every other /driver page belongs to the released sub-login.
  if ((path === '/driver' || path.startsWith('/driver/')) && path !== '/driver/app' && released.has('driver')) return false;
  return !legacyEnabled && matches(path, LEGACY_PORTALS);
};

const matches = (path: string, prefixes: string[]) => prefixes.some((p) => path === p || path.startsWith(`${p}/`));

/** Merges Set-Cookie values into an incoming Cookie header so server components see the refreshed session. */
function mergeCookies(cookieHeader: string, setCookies: string[]): string {
  const jar = new Map<string, string>();
  for (const part of cookieHeader.split(/;\s*/).filter(Boolean)) {
    const i = part.indexOf('=');
    jar.set(part.slice(0, i), part.slice(i + 1));
  }
  for (const sc of setCookies) {
    const [pair] = sc.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Edge gate for protected pages:
 *  - no session cookies → redirect to /login
 *  - access cookie expired but refresh cookie present → rotate the session server-side, then continue
 * Role/agency authorisation itself is enforced by the backend (and checked in server layouts).
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const access = req.cookies.get('ttms_at')?.value;
  const refresh = req.cookies.get('ttms_rt')?.value;

  if (hidden(pathname)) {
    return NextResponse.redirect(new URL(pathname.startsWith('/signup') ? '/register' : '/login', req.url));
  }

  if (matches(pathname, GUEST_ONLY)) {
    if (access) {
      // Already signed in: let /auth/me decide where to go.
      const me = await fetch(`${API_URL}/api/v1/auth/me`, { headers: { cookie: req.headers.get('cookie') ?? '' } }).catch(() => null);
      if (me?.ok) {
        const body = (await me.json()) as { data: { redirectTo: string } };
        return NextResponse.redirect(new URL(body.data.redirectTo, req.url));
      }
    }
    return NextResponse.next();
  }

  if (!matches(pathname, PROTECTED)) return NextResponse.next();

  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('next', pathname + search);

  if (access) return NextResponse.next();
  if (!refresh) return NextResponse.redirect(loginUrl);

  const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: req.headers.get('cookie') ?? '',
      'x-csrf-token': req.cookies.get('ttms_csrf')?.value ?? '',
      'user-agent': req.headers.get('user-agent') ?? 'ttms-web',
      'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
    },
    body: '{}',
  }).catch(() => null);

  if (!res?.ok) {
    loginUrl.searchParams.set('reason', 'expired');
    const redirect = NextResponse.redirect(loginUrl);
    for (const name of ['ttms_at', 'ttms_rt', 'ttms_csrf']) redirect.cookies.delete(name);
    return redirect;
  }

  const setCookies = res.headers.getSetCookie();
  const forwarded = new Headers(req.headers);
  forwarded.set('cookie', mergeCookies(req.headers.get('cookie') ?? '', setCookies));
  const next = NextResponse.next({ request: { headers: forwarded } });
  for (const c of setCookies) next.headers.append('set-cookie', c);
  return next;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)'],
};
