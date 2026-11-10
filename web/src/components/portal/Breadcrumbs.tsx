'use client';

import { ChevronRight, Home } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  book: 'Book a Tanker',
  bookings: 'My Bookings',
  offers: 'Transporter Offers',
  trips: 'Active Trips',
  tracking: 'Live Tracking',
  payments: 'Payments',
  documents: 'Invoices & Documents',
  locations: 'Saved Locations',
  reports: 'Reports & Analytics',
  notifications: 'Notifications',
  support: 'Support & Complaints',
  profile: 'Company Profile',
  settings: 'Settings',
  confirmation: 'Confirmation',
  new: 'New complaint',
};

const isId = (s: string) => /^[0-9a-f-]{20,}$/i.test(s);

/** Breadcrumbs for every internal page, derived from the URL (ids render as "Details"). */
export function Breadcrumbs() {
  const pathname = usePathname();
  const parts = pathname.split('/').filter(Boolean).slice(1); // drop "company"
  if (parts.length === 0 || (parts.length === 1 && parts[0] === 'dashboard')) return null;
  const crumbs = parts.map((p, i) => {
    const href = `/company/${parts.slice(0, i + 1).join('/')}`;
    const prev = parts[i - 1];
    const label = isId(p) ? (prev === 'bookings' ? 'Booking details' : prev === 'trips' ? 'Trip tracking' : prev === 'support' ? 'Complaint' : prev === 'reports' ? 'Report' : 'Details') : (LABELS[p] ?? p.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));
    return { href, label: p === 'offers' && prev && isId(prev) ? 'Offers' : label };
  });
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
        <li>
          <Link href="/company/dashboard" className="inline-flex items-center gap-1 hover:text-ink">
            <Home className="h-3.5 w-3.5" aria-hidden /> Dashboard
          </Link>
        </li>
        {crumbs.map((c, i) => (
          <li key={c.href} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            {i === crumbs.length - 1 ? (
              <span aria-current="page" className="font-medium text-ink">
                {c.label}
              </span>
            ) : (
              <Link href={c.href} className="hover:text-ink">
                {c.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
