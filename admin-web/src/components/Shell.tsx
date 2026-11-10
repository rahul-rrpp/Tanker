'use client';

import clsx from 'clsx';
import {
  BadgeIndianRupee, Bell, BookCheck, Building2, CircleUser, ClipboardList, Gauge, Handshake, Headphones, History, IdCard, LayoutDashboard, LogOut, Menu,
  Navigation, Package, Percent, Radar, ShieldCheck, Truck, UserCog, UserPlus, Users, X, type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, parseApiError, useApi } from '@/lib/api';
import { Loading, ToastProvider } from './ui';

type Me = { user: { fullName: string; roles: string[]; email: string | null; phone: string }; isSuper: boolean; permissions: string[] };

const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx);
/** `can('companies.edit')` → true for the Super Admin or an employee holding adm.companies.edit. */
export function useCan() {
  const me = useMe();
  return (perm: string) => Boolean(me && (me.isSuper || me.permissions.includes(`adm.${perm}`)));
}

type NavItem = { href: string; label: string; icon: LucideIcon; module: string };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: '', items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, module: 'dashboard' }] },
  {
    group: 'Partners',
    items: [
      { href: '/companies', label: 'Companies', icon: Building2, module: 'companies' },
      { href: '/transporters', label: 'Transporters', icon: Truck, module: 'transporters' },
      { href: '/drivers', label: 'Drivers', icon: IdCard, module: 'drivers' },
      { href: '/tankers', label: 'Tankers', icon: Package, module: 'tankers' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { href: '/bookings', label: 'Bookings', icon: BookCheck, module: 'bookings' },
      { href: '/offers', label: 'Offers & negotiation', icon: Handshake, module: 'offers' },
      { href: '/trips', label: 'Trips', icon: Navigation, module: 'trips' },
      { href: '/tracking', label: 'Live tracking', icon: Radar, module: 'tracking' },
      { href: '/support', label: 'Support tickets', icon: Headphones, module: 'complaints' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { href: '/payments', label: 'Payments', icon: BadgeIndianRupee, module: 'payments' },
      { href: '/commissions', label: 'Commissions & settlements', icon: Percent, module: 'commissions' },
      { href: '/subscriptions', label: 'Subscriptions', icon: Bell, module: 'subscriptions' },
      { href: '/services', label: 'Value-added services', icon: ClipboardList, module: 'services' },
    ],
  },
  {
    group: 'Team',
    items: [
      { href: '/leads', label: 'Leads', icon: UserPlus, module: 'leads' },
      { href: '/tasks', label: 'Tasks & follow-ups', icon: ClipboardList, module: 'tasks' },
      { href: '/employees', label: 'Employees', icon: Users, module: 'employees' },
      { href: '/roles', label: 'Roles & permissions', icon: ShieldCheck, module: 'roles' },
      { href: '/hr', label: 'HR settings', icon: UserCog, module: 'settings' },
      { href: '/activity', label: 'Employee activity', icon: History, module: 'audit' },
    ],
  },
];

async function logout() {
  try {
    await api.post('/auth/logout', {});
  } finally {
    window.location.assign('/login?reason=logout');
  }
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data: me, error } = useApi<Me>('/admin/auth/me', { revalidateOnFocus: false });
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!error) return;
    const p = parseApiError(error);
    if (p.status === 401 || p.status === 403) router.replace(`/login?next=${encodeURIComponent(pathname)}${p.status === 403 ? '&reason=forbidden' : ''}`);
  }, [error, router, pathname]);

  if (!me) return <div className="flex min-h-dvh items-center justify-center">{error ? <p className="text-sm text-muted">{parseApiError(error).message}</p> : <Loading label="Opening the admin console…" />}</div>;

  const visible = (m: string) => me.isSuper || me.permissions.some((p) => p.startsWith(`adm.${m}.view`));
  const nav = (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-3" aria-label="Admin">
      {NAV.map((g) => {
        const items = g.items.filter((i) => visible(i.module));
        if (!items.length) return null;
        return (
          <div key={g.group || 'main'}>
            {g.group && <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.group}</p>}
            <div className="space-y-0.5">
              {items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium', active ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white')}>
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate">{label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
  const brand = (
    <div className="flex items-center gap-2.5 px-5 py-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white">TL</span>
      <span className="leading-tight"><span className="block text-base font-bold text-white">TankerLink</span><span className="block text-[11px] font-medium uppercase tracking-wider text-brand-300">Admin Console</span></span>
    </div>
  );
  const footer = (
    <div className="border-t border-white/10 p-3">
      <div className="flex items-center gap-2 px-2 pb-2 text-xs text-slate-400"><CircleUser className="h-4 w-4" /><span className="truncate">{me.user.fullName} · {me.isSuper ? 'Super Admin' : 'Employee'}</span></div>
      <button onClick={() => void logout()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white"><LogOut className="h-4 w-4" />Sign out</button>
    </div>
  );

  return (
    <MeCtx.Provider value={me}>
      <ToastProvider>
        <div className="min-h-dvh">
          <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-brand-950 lg:flex">{brand}{nav}{footer}</aside>
          {open && (
            <div className="fixed inset-0 z-50 lg:hidden">
              <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
              <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-brand-950"><div className="flex items-center justify-between pr-3">{brand}<button onClick={() => setOpen(false)} className="p-2 text-slate-300" aria-label="Close menu"><X className="h-5 w-5" /></button></div>{nav}{footer}</aside>
            </div>
          )}
          <div className="lg:pl-64">
            <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur lg:hidden">
              <button onClick={() => setOpen(true)} className="rounded-lg p-2" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
              <span className="font-semibold text-ink">TankerLink Admin</span>
              <Gauge className="ml-auto h-5 w-5 text-muted" aria-hidden />
            </header>
            <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
          </div>
        </div>
      </ToastProvider>
    </MeCtx.Provider>
  );
}
