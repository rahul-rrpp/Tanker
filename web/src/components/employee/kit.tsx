'use client';

import clsx from 'clsx';
import { Bell, BookCheck, CalendarCheck, CalendarDays, ChevronsLeft, ChevronsRight, CircleUser, ClipboardCheck, ClipboardList, FileBarChart, Gauge, Handshake, Headphones, IndianRupee, LayoutDashboard, LogOut, Menu, Navigation, Settings, ShieldCheck, Truck, UserPlus, Users, Building2, X, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { DataTable, type Column } from '@/components/transporter/ui';
import { LogoMark } from '@/components/ui/Logo';
import { EmptyState, ErrorBlock, LoadingBlock, Modal, PageHeader, Pagination, Spinner, Tabs, TextArea, ToastProvider, useToast } from '@/components/ui/kit';
import { Alert, Button, Card, SelectField, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import { useRealtime } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

export type Profile = { employee: { employeeCode: string; designation: string; department: string; joiningDate: string; employmentType: string | null; employmentStatus: string; branch: string | null; territory: string | null; role: { code: string; name: string; dataScope: string }; reportingManager: { employeeCode: string; user: { fullName: string } } | null; user: { fullName: string; phone: string; email: string | null; lastLoginAt: string | null } }; modules: string[]; permissions: string[] };

export const useProfile = () => useApi<Profile>('/employee/auth/profile', { revalidateOnFocus: false });
export const useCan = () => {
  const { data } = useProfile();
  return (key: string) => Boolean(data?.permissions.includes(`adm.${key}`));
};

type Nav = { href: string; label: string; icon: LucideIcon; module?: string };
const NAV: Nav[] = [
  { href: 'dashboard', label: 'My Dashboard', icon: LayoutDashboard },
  { href: 'my-leads', label: 'My Leads', icon: UserPlus, module: 'leads' },
  { href: 'leads', label: 'Lead Management', icon: Users, module: 'leads' },
  { href: 'companies', label: 'Company Management', icon: Building2, module: 'companies' },
  { href: 'transporters', label: 'Transporter Management', icon: Truck, module: 'transporters' },
  { href: 'drivers', label: 'Driver Onboarding', icon: CircleUser, module: 'drivers' },
  { href: 'verification', label: 'Fleet Verification', icon: ShieldCheck, module: 'fleet-verification' },
  { href: 'bookings', label: 'Booking Management', icon: BookCheck, module: 'bookings' },
  { href: 'negotiations', label: 'Negotiation Monitoring', icon: Handshake, module: 'negotiations' },
  { href: 'trips', label: 'Trip Operations', icon: Navigation, module: 'trips' },
  { href: 'support', label: 'Customer Support', icon: Headphones, module: 'support' },
  { href: 'payments', label: 'Payment Follow-ups', icon: IndianRupee, module: 'payments' },
  { href: 'tasks', label: 'Tasks & Follow-ups', icon: ClipboardList },
  { href: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { href: 'leave', label: 'Leave Management', icon: CalendarDays },
  { href: 'mis', label: 'Daily Reports', icon: FileBarChart },
  { href: 'performance', label: 'Performance Scorecard', icon: Gauge },
  { href: 'approvals', label: 'Team & Approvals', icon: ClipboardCheck },
  { href: 'notifications', label: 'Notifications', icon: Bell },
  { href: 'profile', label: 'My Profile', icon: CircleUser },
  { href: 'settings', label: 'Settings', icon: Settings },
];

async function logout() {
  try {
    await api.post('/employee/auth/logout', {});
  } finally {
    window.location.assign('/login/employee?reason=logout');
  }
}

export function EmployeeShell({ name, children }: { name: string; children: ReactNode }) {
  const pathname = usePathname();
  const { data: profile } = useProfile();
  const { data: unread, mutate } = useApi<{ unread: number }>('/notifications/unread-count', { refreshInterval: 60_000 });
  useRealtime(['notification'], () => void mutate());
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const items = NAV.filter((n) => !n.module || profile?.modules.includes(n.module));
  const list = (compact: boolean) => (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3" aria-label="Employee portal">
      {items.map(({ href, label, icon: Icon }) => {
        const to = `/employee/${href}`;
        const active = pathname === to || pathname.startsWith(`${to}/`);
        return (
          <Link key={href} href={to} title={compact ? label : undefined} aria-current={active ? 'page' : undefined} className={clsx('relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium', active ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white', compact && 'justify-center px-0')}>
            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
            {!compact && <span className="truncate">{label}</span>}
            {href === 'notifications' && (unread?.unread ?? 0) > 0 && <span className={clsx('rounded-full bg-orange-500 px-1.5 text-[10px] font-bold text-white', compact ? 'absolute right-1 top-0.5' : 'ml-auto')}>{unread!.unread}</span>}
          </Link>
        );
      })}
      <button onClick={() => void logout()} className={clsx('mt-2 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white', compact && 'justify-center px-0')}><LogOut className="h-[18px] w-[18px]" aria-hidden />{!compact && 'Logout'}</button>
    </nav>
  );
  const brand = (compact: boolean) => <div className={clsx('flex items-center gap-2.5 px-5 py-4', compact && 'justify-center px-0')}><LogoMark className="h-9 w-9" />{!compact && <span className="leading-tight"><span className="block text-base font-bold text-white">TankerLink</span><span className="block text-[11px] font-medium uppercase tracking-wider text-brand-300">Employee Portal</span></span>}</div>;
  return (
    <ToastProvider>
      <div className="min-h-dvh">
        <aside className={clsx('fixed inset-y-0 left-0 z-40 hidden flex-col bg-brand-950 lg:flex', collapsed ? 'w-[76px]' : 'w-64')}>
          {brand(collapsed)}
          {list(collapsed)}
          <button onClick={() => setCollapsed((c) => !c)} className="m-3 flex items-center justify-center gap-2 rounded-xl border border-white/10 py-2 text-xs text-slate-300 hover:bg-white/5" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}</button>
        </aside>
        {open && <div className="fixed inset-0 z-50 lg:hidden"><div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} /><aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-brand-950"><div className="flex items-center justify-between pr-3">{brand(false)}<button onClick={() => setOpen(false)} className="p-2 text-slate-300" aria-label="Close menu"><X className="h-5 w-5" /></button></div>{list(false)}</aside></div>}
        <div className={clsx(collapsed ? 'lg:pl-[76px]' : 'lg:pl-64')}>
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
            <button onClick={() => setOpen(true)} className="rounded-lg p-2 lg:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{name}</p><p className="truncate text-xs text-muted">{profile ? `${profile.employee.employeeCode} · ${profile.employee.role.name}` : ''}</p></div>
            <Link href="/employee/notifications" className="relative rounded-lg p-2 hover:bg-canvas" aria-label="Notifications"><Bell className="h-5 w-5" />{(unread?.unread ?? 0) > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-white" />}</Link>
          </header>
          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}

// ---- Generic list page ------------------------------------------------------------------------

type Listing<T> = { total: number; page: number; pageSize: number; items: T[]; counts?: Record<string, number> };

export function ListPage<T>({ title, subtitle, path, columns, rowKey, tabs, tabParam = 'tab', actions, exportable, refreshKey }: { title: string; subtitle?: string; path: string; columns: Column<T>[]; rowKey: (r: T) => string; tabs?: { value: string; label: string }[]; tabParam?: string; actions?: ReactNode; exportable?: boolean; refreshKey?: number }) {
  const [tab, setTab] = useState(tabs?.[0]?.value ?? '');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const sep = path.includes('?') ? '&' : '?';
  const url = `${path}${sep}page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}${tab ? `&${tabParam}=${tab}` : ''}${refreshKey ? `&_=${refreshKey}` : ''}`;
  const { data, error, mutate } = useApi<Listing<T>>(url);
  const exportHref = (f: string) => `/api/v1${path}${sep}format=${f}${q ? `&q=${encodeURIComponent(q)}` : ''}${tab ? `&${tabParam}=${tab}` : ''}`;
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={<>{exportable && <><a href={exportHref('xlsx')} download><Button size="sm" variant="secondary">Excel</Button></a><a href={exportHref('pdf')} download><Button size="sm" variant="secondary">PDF</Button></a></>}{actions}<div className="w-52"><TextField label="Search" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} /></div></>} />
      {tabs && <div className="mb-4"><Tabs tabs={tabs} value={tab} onChange={(v) => { setTab(v); setPage(1); }} counts={data?.counts} /></div>}
      {error ? <ErrorBlock error={error} onRetry={() => void mutate()} /> : !data ? <LoadingBlock /> : data.items.length === 0 ? <EmptyState title="Nothing here yet" /> : <DataTable rows={data.items} rowKey={rowKey} columns={columns} />}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </>
  );
}

// ---- Declarative form modal -------------------------------------------------------------------

export type Field = { name: string; label: string; type?: 'text' | 'number' | 'date' | 'datetime-local' | 'textarea' | 'select'; options?: { value: string; label: string }[]; required?: boolean; hint?: string; initial?: string };

const toOptions = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));
export const opts = toOptions;

export function FormModal({ open, onClose, title, fields, submit, onSubmit }: { open: boolean; onClose: () => void; title: string; fields: Field[]; submit: string; onSubmit: (values: Record<string, string>) => Promise<void> }) {
  const toast = useToast();
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [dups, setDups] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setV(Object.fromEntries(fields.filter((f) => f.initial !== undefined).map((f) => [f.name, f.initial as string])));
      setFail(null); setErrs({}); setDups([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const go = async () => {
    setBusy(true); setFail(null); setErrs({}); setDups([]);
    try {
      await onSubmit(v);
      toast.success('Saved');
      onClose();
    } catch (e) {
      const p = parseApiError(e);
      setFail(p.message);
      setErrs(Object.fromEntries(p.fields.map((x) => [x.field, x.message])));
      const d = p.details as { leads?: { leadCode: string; name: string; owner: string | null }[]; accounts?: string[] } | undefined;
      if (d && !Array.isArray(d)) setDups([...(d.leads ?? []).map((l) => `${l.leadCode}: ${l.name}${l.owner ? ` (${l.owner})` : ''}`), ...(d.accounts ?? [])]);
    } finally {
      setBusy(false);
    }
  };
  const missing = fields.some((f) => f.required && !v[f.name]?.trim());
  return (
    <Modal size="lg" open={open} onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || missing} onClick={() => void go()}>{busy && <Spinner />} {submit}</Button></>}>
      <div className="space-y-3">
        {fail && <Alert tone="error" title={fail}>{dups.length > 0 && <ul className="list-disc pl-4">{dups.map((d) => <li key={d}>{d}</li>)}</ul>}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => {
            const bind = { label: f.label, required: f.required, value: v[f.name] ?? '', error: errs[f.name], hint: f.hint };
            const set = (e: { target: { value: string } }) => setV((x) => ({ ...x, [f.name]: e.target.value }));
            if (f.type === 'textarea') return <div key={f.name} className="sm:col-span-2"><TextArea {...bind} onChange={set} /></div>;
            if (f.type === 'select') return <SelectField key={f.name} {...bind} onChange={set}><option value="">Select…</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</SelectField>;
            return <TextField key={f.name} {...bind} type={f.type ?? 'text'} onChange={set} />;
          })}
        </div>
      </div>
    </Modal>
  );
}

export const Section = ({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) => <Card className="p-5"><div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-base font-semibold text-ink">{title}</h2>{action}</div>{children}</Card>;

export const clean = (v: Record<string, string>) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== undefined));
export const iso = (local: string) => new Date(`${local}:00+05:30`).toISOString();
