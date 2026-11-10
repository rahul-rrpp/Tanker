/** Server timestamps are UTC; the app shows India time. DATE columns are midnight UTC and must not shift. */
const TZ = 'Asia/Kolkata';

export function inr(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—';
}

export const dateTime = (d: string | null | undefined) => (d ? new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(d)) : '—');
export const day = (d: string | null | undefined) => (d ? new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d)) : '—');
export const km = (v: number | string | null | undefined) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`);
export const humanize = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '—');
export const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
export const addDays = (ymd: string, n: number) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);

export function timeAgo(d: string | null | undefined): string {
  if (!d) return '—';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return dateTime(d);
}

export const city = (locations: { type: string; city: string | null }[] | undefined, type: 'PICKUP' | 'DELIVERY') => locations?.find((l) => l.type === type)?.city ?? '—';

export function duration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}
