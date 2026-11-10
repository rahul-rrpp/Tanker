/** Display helpers shared by tables, detail views and the dashboard. */

export type Format = 'number' | 'currency' | 'percent' | 'text' | 'date' | 'datetime' | 'km';

const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export const inr = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : inrFmt.format(Number(v)));
export const num = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : numFmt.format(Number(v)));

export function date(v: unknown) {
  if (!v) return '—';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export function dateTime(v: unknown) {
  if (!v) return '—';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

/** "PENDING_VERIFICATION" → "Pending verification", "contactEmail" → "Contact email". */
export function humanize(s: string) {
  if (!s) return '';
  const spaced = s.includes('_') || s === s.toUpperCase() ? s.toLowerCase().replace(/_/g, ' ') : s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatValue(v: unknown, format: Format = 'text'): string {
  if (v === null || v === undefined || v === '') return '—';
  switch (format) {
    case 'currency': return inr(v);
    case 'number': return num(v);
    case 'percent': return `${num(v)}%`;
    case 'km': return `${num(v)} km`;
    case 'date': return date(v);
    case 'datetime': return dateTime(v);
    default:
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? labelOf(x) : String(x))).join(', ') || '—';
      if (typeof v === 'object') return labelOf(v);
      return String(v);
  }
}

/** A readable label for a nested object (name, companyName, code...). */
export function labelOf(o: unknown): string {
  if (!o || typeof o !== 'object') return o === null || o === undefined ? '—' : String(o);
  const r = o as Record<string, unknown>;
  for (const k of ['name', 'companyName', 'fullName', 'title', 'bookingCode', 'tripCode', 'registrationNumber', 'code', 'label']) {
    if (typeof r[k] === 'string' && r[k]) return r[k] as string;
  }
  if (r.user && typeof r.user === 'object') return labelOf(r.user);
  if (r.product && typeof r.product === 'object') return labelOf(r.product);
  return '…';
}

/** Guesses a display format from a field name, for endpoints that do not describe their columns. */
export function guessFormat(key: string, value: unknown): Format {
  const k = key.toLowerCase();
  if (typeof value === 'number') {
    if (/(amount|price|freight|revenue|value|payable|commission|paid|cost|fee|offer|total|gross|net|margin|settled|collected|invoiced|refund)/.test(k) && !/(count|rate|percent|days|limit|level|priority|weightage|version|minutes)/.test(k)) return 'currency';
    if (/(percent|rate)$/.test(k)) return 'percent';
    if (/km$/.test(k)) return 'km';
    return 'number';
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return /(expiry|date|from|to|on)$/.test(k) ? 'date' : 'datetime';
  return 'text';
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Colour for a status value. */
export function toneFor(status: string): Tone {
  const s = status.toUpperCase();
  if (/(REJECT|FAIL|CANCEL|SUSPEND|DISPUT|LOST|EXPIRED|OVERDUE|EMERGENCY|DENIED|TERMINATED|MISSING|LOCKED|DISABLED|NOT_INTERESTED)/.test(s)) return 'danger';
  if (/(PENDING|REVIEW|WAITING|AWAITING|DELAY|ON_HOLD|FOLLOW_UP|MAINTENANCE|NEGOTIATION|PARTIAL|INVESTIGATION|NOT_ACTIVATED|EXPIRING|OPEN|URGENT|HIGH)/.test(s)) return 'warning';
  if (/(APPROVED|VERIFIED|ACTIVE|COMPLETED|DELIVERED|PAID|SETTLED|RESOLVED|CLOSED|AVAILABLE|CONFIRMED|DONE|FULFILLED|ENABLED|CONVERTED|VALID|REGISTERED)/.test(s)) return 'success';
  if (/(SEARCHING|OFFERS|ASSIGNED|TRANSIT|LOADING|SCHEDULED|NEW|CONTACTED|IN_PROGRESS|REQUESTED|BOOKED|RESERVED)/.test(s)) return 'info';
  return 'neutral';
}

/** True for values that should render as a status badge. */
export const isStatusKey = (key: string) => /(status|verification|state$|stage|priority)$/i.test(key) && !/^(state)$/i.test(key);
