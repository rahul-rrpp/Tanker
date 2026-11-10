import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ApiEnvelope, AuthUser, RoleName } from './types';

export const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/** Server-side call to the backend, forwarding the caller's session cookies. */
export async function serverApi<T>(path: string): Promise<{ status: number; body: ApiEnvelope<T> | null }> {
  const cookieHeader = (await cookies()).toString();
  const h = await headers();
  try {
    const res = await fetch(`${API_URL}/api/v1${path}`, {
      headers: {
        cookie: cookieHeader,
        'user-agent': h.get('user-agent') ?? 'ttms-web',
        'x-forwarded-for': h.get('x-forwarded-for') ?? '',
      },
      cache: 'no-store',
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as ApiEnvelope<T> | null };
  } catch {
    return { status: 503, body: null };
  }
}

export async function getCurrentUser(): Promise<{ user: AuthUser; redirectTo: string } | null> {
  const { status, body } = await serverApi<{ user: AuthUser; redirectTo: string }>('/auth/me');
  if (status !== 200 || !body?.success) return null;
  return body.data;
}

interface RequireOptions {
  roles?: RoleName[];
  /** Agency sections require the agency to be approved by a Super Admin. */
  requireApprovedAgency?: boolean;
  next?: string;
}

/**
 * Server-side guard for protected pages. Authorisation is decided by the backend's view of the user
 * (roles, agency status); middleware only handles the redirect for missing sessions.
 */
export async function requireUser(opts: RequireOptions = {}): Promise<{ user: AuthUser; redirectTo: string }> {
  const session = await getCurrentUser();
  if (!session) redirect(`/login${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ''}`);
  const { user } = session;
  if (opts.roles && !opts.roles.some((r) => user.roles.includes(r))) redirect('/unauthorized');
  if (opts.requireApprovedAgency && user.agency?.verificationStatus !== 'APPROVED') redirect('/pending-verification');
  return session;
}
