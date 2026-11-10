/** Display helpers. Server timestamps are UTC; everything is shown in Asia/Kolkata. */

const TZ = 'Asia/Kolkata';

export function inr(value: number | string | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: opts.decimals ? 2 : 0, maximumFractionDigits: opts.decimals ? 2 : 0 })}`;
}

export function compactInr(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return inr(n);
}

export function dateIST(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d));
}

/** For DATE columns (stored as midnight UTC) — format without shifting the day. */
export function dayOnly(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d));
}

export function dateTimeIST(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(d));
}

export function timeAgo(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return dateIST(d);
}

export function duration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${m ? `${m} min` : ''}`.trim() : `${m} min`;
}

export const km = (n: number | string | null | undefined) => (n === null || n === undefined ? '—' : `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`);

export const kl = (n: number | string | null | undefined) => (n === null || n === undefined ? '—' : `${Number(n)} KL`);

export const monthLabel = (ym: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));

export const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

export const humanize = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
