'use client';

import clsx from 'clsx';
import {
  BadgeIndianRupee, BarChart3, Bell, BookCheck, CalendarRange, ChevronDown, ChevronsLeft, ChevronsRight, CircleUser, ClipboardList, Crown, FileText, FlaskConical, Handshake, History, LayoutDashboard, LifeBuoy, LogOut, MapPinned, Menu,
  Navigation, Percent, Search, Settings, ShieldAlert, Truck, Users, X, type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { mutate } from 'swr';
import { api } from '@/lib/api';
import type { Catalog } from '@/lib/company-types';
import { useRealtime } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';
import { LogoMark } from '../ui/Logo';
import { ToastProvider } from '../ui/kit';

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[] };

async function logout() {
  try {
    await api.post('/auth/logout', {});
  } finally {
    window.location.assign('/login?reason=logout');
  }
}

const GROUPS: NavGroup[] = [
  { label: 'Overview', items: [{ href: '/transporter/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  { label: 'Freight', items: [
    { href: '/transporter/marketplace', label: 'Available Bookings', icon: Search },
    { href: '/transporter/offers', label: 'My Offers & Negotiations', icon: Handshake },
    { href: '/transporter/bookings', label: 'Confirmed Bookings', icon: BookCheck },
  ] },
  { label: 'Operations', items: [
    { href: '/transporter/trips', label: 'Active Trips', icon: Navigation },
    { href: '/transporter/tracking', label: 'Live GPS Tracking', icon: MapPinned },
    { href: '/transporter/history', label: 'Trip History', icon: History },
  ] },
  { label: 'Fleet', items: [
    { href: '/transporter/fleet', label: 'My Fleet', icon: Truck },
    { href: '/transporter/drivers', label: 'Driver Management', icon: Users },
    { href: '/transporter/availability', label: 'Tanker Availability', icon: CalendarRange },
  ] },
  { label: 'Finance', items: [
    { href: '/transporter/earnings', label: 'Earnings & Payments', icon: BadgeIndianRupee },
    { href: '/transporter/settlements', label: 'Commission & Settlements', icon: Percent },
    { href: '/transporter/documents', label: 'Invoices & Documents', icon: FileText },
    { href: '/transporter/reports', label: 'Reports & Analytics', icon: BarChart3 },
  ] },
  { label: 'Account', items: [
    { href: '/transporter/notifications', label: 'Notifications', icon: Bell },
    { href: '/transporter/support', label: 'Support & Complaints', icon: LifeBuoy },
    { href: '/transporter/profile', label: 'Transporter Profile', icon: CircleUser },
    { href: '/transporter/subscription', label: 'Subscription & Services', icon: Crown },
    { href: '/transporter/settings', label: 'Settings', icon: Settings },
  ] },
];

const isActive = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

function Sidebar({ collapsed, unread, onNavigate }: { collapsed: boolean; unread: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-3" aria-label="Transporter portal">
      {GROUPS.map((g) => {
        const open = collapsed || !closed[g.label] || g.items.some((i) => isActive(pathname, i.href));
        return (
          <div key={g.label}>
            {!collapsed && g.label !== 'Overview' && (
              <button onClick={() => setClosed((c) => ({ ...c, [g.label]: !c[g.label] }))} aria-expanded={open} className="flex w-full items-center justify-between px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-white">
                {g.label}
                <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} aria-hidden />
              </button>
            )}
            {open &&
              g.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link key={href} href={href} onClick={onNavigate} title={collapsed ? label : undefined} aria-current={active ? 'page' : undefined} className={clsx('relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors', active ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-300 hover:bg-white/5 hover:text-white', collapsed && 'justify-center px-0')}>
                    <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    {!collapsed && <span className="truncate">{label}</span>}
                    {href.endsWith('/notifications') && unread > 0 && <span className={clsx('rounded-full bg-orange-500 px-1.5 text-[10px] font-bold text-white', collapsed ? 'absolute right-1.5 top-1' : 'ml-auto')}>{unread > 99 ? '99+' : unread}</span>}
                  </Link>
                );
              })}
          </div>
        );
      })}
      <button onClick={() => void logout()} title={collapsed ? 'Logout' : undefined} className={clsx('mt-2 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white', collapsed && 'justify-center px-0')}>
        <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden />
        {!collapsed && 'Logout'}
      </button>
    </nav>
  );
}

function Brand({ collapsed, subtitle, href }: { collapsed: boolean; subtitle: string; href: string }) {
  return (
    <Link href={href} className={clsx('flex items-center gap-2.5 px-5 py-4', collapsed && 'justify-center px-0')} aria-label="TankerLink home">
      <LogoMark className="h-9 w-9" />
      {!collapsed && (
        <span className="leading-tight">
          <span className="block text-base font-bold tracking-tight text-white">TankerLink</span>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-brand-300">{subtitle}</span>
        </span>
      )}
    </Link>
  );
}

function DemoRibbon() {
  const { data } = useApi<Catalog>('/catalog', { revalidateOnFocus: false, shouldRetryOnError: false });
  if (!data?.demoMode) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-fuchsia-700 px-4 py-1.5 text-center text-xs font-medium text-white">
      <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden /> Demo environment. Records marked DEMO are simulated, not real transactions.
    </div>
  );
}

/** Refreshes the unread badge and any open list when something happens elsewhere. */
function useLiveUnread() {
  const { data, mutate: refresh } = useApi<{ unread: number }>('/notifications/unread-count', { refreshInterval: 60_000 });
  useRealtime(['notification'], () => {
    void refresh();
    void mutate((k) => typeof k === 'string' && k.startsWith('/notifications'));
  });
  return data?.unread ?? 0;
}

export interface ShellUser {
  fullName: string;
  agency?: { companyName: string; verificationStatus: string; memberRole: string } | null;
}

export function TransporterShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const pathname = usePathname();
  const unread = useLiveUnread();
  useEffect(() => setMobile(false), [pathname]);
  const status = user.agency?.verificationStatus;
  const initials = useMemo(() => user.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase(), [user.fullName]);
  return (
    <ToastProvider>
      <div className="min-h-dvh">
        <aside className={clsx('fixed inset-y-0 left-0 z-40 hidden flex-col bg-brand-950 transition-[width] duration-200 lg:flex', collapsed ? 'w-[76px]' : 'w-64')}>
          <Brand collapsed={collapsed} subtitle="Transporter Portal" href="/transporter/dashboard" />
          <Sidebar collapsed={collapsed} unread={unread} />
          <button onClick={() => setCollapsed((c) => !c)} className="m-3 flex items-center justify-center gap-2 rounded-xl border border-white/10 py-2 text-xs font-medium text-slate-300 hover:bg-white/5 hover:text-white" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
          </button>
        </aside>
        {mobile && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobile(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-brand-950">
              <div className="flex items-center justify-between pr-3">
                <Brand collapsed={false} subtitle="Transporter Portal" href="/transporter/dashboard" />
                <button onClick={() => setMobile(false)} className="rounded-lg p-2 text-slate-300 hover:bg-white/10" aria-label="Close menu"><X className="h-5 w-5" /></button>
              </div>
              <Sidebar collapsed={false} unread={unread} onNavigate={() => setMobile(false)} />
            </aside>
          </div>
        )}
        <div className={clsx('transition-[padding] duration-200', collapsed ? 'lg:pl-[76px]' : 'lg:pl-64')}>
          <DemoRibbon />
          <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
            <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
              <button onClick={() => setMobile(true)} className="rounded-lg p-2 text-ink hover:bg-canvas lg:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{user.agency?.companyName ?? 'Transporter'}</p>
                <p className="truncate text-xs text-muted">{user.agency?.memberRole?.replace(/_/g, ' ').toLowerCase()}</p>
              </div>
              <Link href="/transporter/marketplace" className="hidden items-center gap-2 rounded-[var(--radius-field)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 sm:inline-flex"><Search className="h-4 w-4" aria-hidden /> Find Bookings</Link>
              <Link href="/transporter/notifications" className="relative rounded-lg p-2 text-ink hover:bg-canvas" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
                <Bell className="h-5 w-5" />
                {unread > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-white" />}
              </Link>
              <Link href="/transporter/settings" className="flex items-center gap-2 rounded-lg p-1 hover:bg-canvas" aria-label="Account settings">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{initials}</span>
                <span className="hidden text-sm font-semibold text-ink md:block">{user.fullName}</span>
              </Link>
            </div>
          </header>
          {status && status !== 'APPROVED' && (
            <div className={clsx('border-b px-4 py-2.5 text-sm sm:px-6', status === 'REJECTED' ? 'border-red-200 bg-red-50 text-red-800' : 'border-orange-200 bg-orange-50 text-orange-800')}>
              <ShieldAlert className="mr-1.5 inline h-4 w-4" aria-hidden />
              <strong>{status === 'REJECTED' ? 'Verification rejected.' : 'Verification pending.'}</strong> Complete your profile, documents and fleet. Live freight bidding opens once{' '}
              <Link href="/transporter/profile" className="font-semibold underline">your account</Link> is verified.
            </div>
          )}
          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}

const DRIVER_NAV: NavItem[] = [
  { href: '/driver/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/driver/trips', label: 'My Assigned Trips', icon: ClipboardList },
  { href: '/driver/notifications', label: 'Notifications', icon: Bell },
  { href: '/driver/profile', label: 'My Profile', icon: CircleUser },
];

/** Mobile-first: a bottom tab bar, with big touch targets, and no finance or fleet navigation at all. */
export function DriverShell({ name, children }: { name: string; children: ReactNode }) {
  const pathname = usePathname();
  const unread = useLiveUnread();
  return (
    <ToastProvider>
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-canvas">
        <DemoRibbon />
        <header className="sticky top-0 z-30 flex items-center gap-2 bg-brand-950 px-4 py-3 text-white">
          <LogoMark className="h-8 w-8" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="text-[11px] uppercase tracking-wider text-brand-300">Driver</p>
          </div>
          <button onClick={() => void logout()} className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-slate-200 hover:bg-white/10"><LogOut className="h-4 w-4" aria-hidden /> Logout</button>
        </header>
        <main className="flex-1 px-4 pb-24 pt-4">{children}</main>
        <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-xl border-t border-line bg-white" aria-label="Driver">
          {DRIVER_NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={clsx('relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium', active ? 'text-brand-700' : 'text-muted')}>
                <Icon className="h-5 w-5" aria-hidden />
                <span className="truncate px-1">{label.replace('My Assigned ', '').replace('My ', '')}</span>
                {href.endsWith('/notifications') && unread > 0 && <span className="absolute right-[28%] top-1.5 h-2.5 w-2.5 rounded-full bg-orange-500" />}
              </Link>
            );
          })}
        </nav>
      </div>
    </ToastProvider>
  );
}
