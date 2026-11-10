'use client';

import clsx from 'clsx';
import {
  BarChart3,
  Bell,
  BookOpenCheck,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  FileText,
  FlaskConical,
  Handshake,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  MapPin,
  Menu,
  Navigation,
  PlusCircle,
  Settings,
  Truck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { Catalog } from '@/lib/company-types';
import type { AuthUser } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { LogoMark } from '../ui/Logo';
import { ToastProvider } from '../ui/kit';
import { Breadcrumbs } from './Breadcrumbs';

type CompanyUser = AuthUser & { company?: { id: string; companyCode: string; name: string; status: string; statusReason: string | null; isDemo: boolean } | null };

const NAV = [
  { href: '/company/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/company/book', label: 'Book a Tanker', icon: PlusCircle },
  { href: '/company/bookings', label: 'My Bookings', icon: BookOpenCheck },
  { href: '/company/offers', label: 'Transporter Offers', icon: Handshake },
  { href: '/company/trips', label: 'Active Trips', icon: Truck },
  { href: '/company/tracking', label: 'Live Tracking', icon: Navigation },
  { href: '/company/payments', label: 'Payments', icon: CreditCard },
  { href: '/company/documents', label: 'Invoices & Documents', icon: FileText },
  { href: '/company/locations', label: 'Saved Locations', icon: MapPin },
  { href: '/company/reports', label: 'Reports & Analytics', icon: BarChart3 },
  { href: '/company/notifications', label: 'Notifications', icon: Bell },
  { href: '/company/support', label: 'Support & Complaints', icon: LifeBuoy },
  { href: '/company/profile', label: 'Company Profile', icon: Building2 },
  { href: '/company/settings', label: 'Settings', icon: Settings },
];

async function logout() {
  try {
    await api.post('/auth/logout', {});
  } finally {
    window.location.assign('/login?reason=logout');
  }
}

function NavList({ collapsed, unread, onNavigate }: { collapsed: boolean; unread: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4" aria-label="Company portal">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
              active ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-300 hover:bg-white/5 hover:text-white',
              collapsed && 'justify-center px-0',
            )}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
            {!collapsed && <span className="truncate">{label}</span>}
            {href === '/company/notifications' && unread > 0 && (
              <span className={clsx('rounded-full bg-orange-500 px-1.5 text-[10px] font-bold text-white', collapsed ? 'absolute right-1.5 top-1' : 'ml-auto')}>{unread > 99 ? '99+' : unread}</span>
            )}
          </Link>
        );
      })}
      <button
        onClick={() => {
          setLoggingOut(true);
          void logout();
        }}
        disabled={loggingOut}
        title={collapsed ? 'Logout' : undefined}
        className={clsx('mt-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white disabled:opacity-60', collapsed && 'justify-center px-0')}
      >
        <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden />
        {!collapsed && <span>{loggingOut ? 'Signing out…' : 'Logout'}</span>}
      </button>
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/company/dashboard" className={clsx('flex items-center gap-2.5 px-5 py-5', collapsed && 'justify-center px-0')} aria-label="TankerLink dashboard">
      <LogoMark className="h-9 w-9" />
      {!collapsed && (
        <span className="leading-tight">
          <span className="block text-base font-bold tracking-tight text-white">TankerLink</span>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-brand-300">Company Portal</span>
        </span>
      )}
    </Link>
  );
}

export function PortalShell({ user, children }: { user: CompanyUser; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const { data: unreadData } = useApi<{ unread: number }>('/notifications/unread-count', { refreshInterval: 30_000 });
  const { data: catalog } = useApi<Catalog>('/catalog', { revalidateOnFocus: false });
  const unread = unreadData?.unread ?? 0;

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('tl.sidebar') === 'collapsed');
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('tl.sidebar', c ? 'open' : 'collapsed');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  const company = user.company;
  const initials = user.fullName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <ToastProvider>
      <div className="min-h-dvh">
        {/* Desktop sidebar */}
        <aside className={clsx('fixed inset-y-0 left-0 z-40 hidden flex-col bg-brand-950 transition-[width] duration-200 lg:flex', collapsed ? 'w-[76px]' : 'w-64')}>
          <Brand collapsed={collapsed} />
          <NavList collapsed={collapsed} unread={unread} />
          <button onClick={toggle} className="m-3 flex items-center justify-center gap-2 rounded-xl border border-white/10 py-2 text-xs font-medium text-slate-300 hover:bg-white/5 hover:text-white" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
          </button>
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-brand-950">
              <div className="flex items-center justify-between pr-3">
                <Brand collapsed={false} />
                <button onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-slate-300 hover:bg-white/10" aria-label="Close menu">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <NavList collapsed={false} unread={unread} onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}

        <div className={clsx('transition-[padding] duration-200', collapsed ? 'lg:pl-[76px]' : 'lg:pl-64')}>
          {catalog?.demoMode && (
            <div className="flex items-center justify-center gap-2 bg-fuchsia-700 px-4 py-1.5 text-center text-xs font-medium text-white">
              <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Demo environment — transporter offers, tracking and payments marked DEMO are simulated, not real transactions.
            </div>
          )}
          <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
            <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
              <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-ink hover:bg-canvas lg:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{company?.name ?? 'Company'}</p>
                <p className="truncate text-xs text-muted">Company ID {company?.companyCode}</p>
              </div>
              <Link href="/company/book" className="hidden items-center gap-2 rounded-[var(--radius-field)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 sm:inline-flex">
                <PlusCircle className="h-4 w-4" aria-hidden />
                Book a Tanker
              </Link>
              <Link href="/company/notifications" className="relative rounded-lg p-2 text-ink hover:bg-canvas" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
                <Bell className="h-5 w-5" />
                {unread > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-white" />}
              </Link>
              <Link href="/company/settings" className="flex items-center gap-2 rounded-lg p-1 hover:bg-canvas" aria-label="Account settings">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{initials}</span>
                <span className="hidden text-left leading-tight md:block">
                  <span className="block text-sm font-semibold text-ink">{user.fullName}</span>
                  <span className="block text-xs text-muted">Company admin</span>
                </span>
              </Link>
            </div>
          </header>

          {company && company.status !== 'VERIFIED' && (
            <div className={clsx('border-b px-4 py-2.5 text-sm sm:px-6', company.status === 'PENDING_VERIFICATION' ? 'border-orange-200 bg-orange-50 text-orange-800' : 'border-red-200 bg-red-50 text-red-800')}>
              {company.status === 'PENDING_VERIFICATION' && (
                <>
                  <strong>Verification pending.</strong> Upload your GST certificate and PAN card in{' '}
                  <Link href="/company/profile" className="font-semibold underline">
                    Company Profile
                  </Link>{' '}
                  so our team can verify {company.name}.
                </>
              )}
              {company.status === 'REJECTED' && (
                <>
                  <strong>Verification rejected.</strong> {company.statusReason ?? 'Please update your documents.'} Bookings are paused until documents are re-submitted.
                </>
              )}
            </div>
          )}

          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
            <Breadcrumbs />
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
