'use client';

import { Download, Eye, Filter, Handshake, MoreHorizontal, Pencil, PlusCircle, Repeat, Search, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { CancelBookingDialog, EditBookingDialog } from '@/components/portal/BookingActions';
import { BookingStatusBadge } from '@/components/portal/bits';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pagination, Tabs } from '@/components/ui/kit';
import { Button, Card, SelectField, TextField } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import type { BookingDetail, BookingRow, Catalog } from '@/lib/company-types';
import { dateIST, dayOnly, inr, kl } from '@/lib/format';
import { BOOKING_STATUS } from '@/lib/status';
import { useApi } from '@/lib/useApi';

const TABS = [
  { value: 'all', label: 'All Bookings' },
  { value: 'searching', label: 'Searching' },
  { value: 'offers', label: 'Offers Received' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'vehicle_assigned', label: 'Vehicle Assigned' },
  { value: 'loading', label: 'Loading' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'disputed', label: 'Disputed' },
] as const;
type Tab = (typeof TABS)[number]['value'];

interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  tabCounts: Record<Tab, number>;
  items: BookingRow[];
}

function RowMenu({ b, onEdit, onCancel }: { b: BookingRow; onEdit: () => void; onCancel: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-canvas';
  return (
    <div className="relative inline-block" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink" aria-label={`Actions for ${b.bookingCode}`} aria-expanded={open}>
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-line bg-white py-1 shadow-xl">
          <Link href={`/company/bookings/${b.id}`} className={item}>
            <Eye className="h-4 w-4" /> View booking
          </Link>
          {b.offersCount > 0 && (
            <Link href={`/company/bookings/${b.id}/offers`} className={item}>
              <Handshake className="h-4 w-4" /> View offers ({b.offersCount})
            </Link>
          )}
          {b.canEdit && (
            <button className={item} onClick={() => (setOpen(false), onEdit())}>
              <Pencil className="h-4 w-4" /> Edit booking
            </button>
          )}
          <button className={item} onClick={() => router.push(`/company/book?repeat=${b.id}`)}>
            <Repeat className="h-4 w-4" /> Repeat booking
          </button>
          {b.acceptedFreight ? (
            <a href={`/api/v1/bookings/${b.id}/confirmation.pdf`} className={item} download onClick={() => setOpen(false)}>
              <Download className="h-4 w-4" /> Download confirmation
            </a>
          ) : (
            <a href={`/api/v1/bookings/${b.id}/summary.pdf`} className={item} download onClick={() => setOpen(false)}>
              <Download className="h-4 w-4" /> Download summary
            </a>
          )}
          {b.canCancel && (
            <button className={`${item} text-danger`} onClick={() => (setOpen(false), onCancel())}>
              <XCircle className="h-4 w-4" /> Cancel booking
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BookingsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'all');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const EMPTY = { from: '', to: '', productId: '', capacity: '', pickupCity: '', deliveryCity: '', status: '' };
  const [filters, setFilters] = useState(EMPTY);
  const [cancelling, setCancelling] = useState<BookingRow | null>(null);
  const [editing, setEditing] = useState<BookingDetail | null>(null);
  const { data: catalog } = useApi<Catalog>('/catalog');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [tab, debouncedQ, filters]);

  const qs = new URLSearchParams({ tab, page: String(page), pageSize: '10' });
  if (debouncedQ) qs.set('q', debouncedQ);
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
  const { data, error, isLoading, mutate } = useApi<ListResponse>(`/bookings?${qs}`, { keepPreviousData: true });

  const activeFilters = Object.values(filters).filter(Boolean).length;

  async function openEdit(b: BookingRow) {
    const { data: res } = await api.get(`/bookings/${b.id}`);
    setEditing(res.data.booking);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Bookings"
        subtitle="Track every booking from search to delivery."
        actions={
          <Link href="/company/book" className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-field)] bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
            <PlusCircle className="h-4 w-4" /> New booking
          </Link>
        }
      />
      <Tabs
        tabs={TABS as unknown as { value: Tab; label: string }[]}
        value={tab}
        onChange={(t) => {
          setTab(t);
          router.replace(`/company/bookings${t === 'all' ? '' : `?tab=${t}`}`, { scroll: false });
        }}
        counts={data?.tabCounts}
      />
      <Card className="!p-0">
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search booking ID, city or address" aria-label="Search bookings" className="h-10 w-full rounded-[var(--radius-field)] border border-line pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100" />
          </div>
          <Button variant="secondary" size="sm" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
            <Filter className="h-4 w-4" /> Filters{activeFilters ? ` (${activeFilters})` : ''}
          </Button>
        </div>
        {showFilters && (
          <div className="grid gap-3 border-b border-line bg-canvas/50 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <TextField label="From date" type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
            <TextField label="To date" type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
            <SelectField label="Oil type" value={filters.productId} onChange={(e) => setFilters((f) => ({ ...f, productId: e.target.value }))} options={[{ value: '', label: 'All products' }, ...(catalog?.products.map((p) => ({ value: p.id, label: p.name })) ?? [])]} />
            <SelectField label="Tanker capacity" value={filters.capacity} onChange={(e) => setFilters((f) => ({ ...f, capacity: e.target.value }))} options={[{ value: '', label: 'Any capacity' }, ...(catalog?.capacities.map((c) => ({ value: String(c), label: `${c} KL` })) ?? [])]} />
            <TextField label="Pickup city" value={filters.pickupCity} onChange={(e) => setFilters((f) => ({ ...f, pickupCity: e.target.value }))} placeholder="e.g. Pune" />
            <TextField label="Delivery city" value={filters.deliveryCity} onChange={(e) => setFilters((f) => ({ ...f, deliveryCity: e.target.value }))} placeholder="e.g. Mumbai" />
            <SelectField
              label="Status"
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              options={[{ value: '', label: 'Any status' }, ...Object.entries(BOOKING_STATUS).map(([value, m]) => ({ value, label: m.label }))]}
            />
            <div className="flex items-end">
              <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY)} disabled={!activeFilters}>
                Clear filters
              </Button>
            </div>
          </div>
        )}

        {error ? (
          <div className="p-4">
            <ErrorBlock error={error} onRetry={() => mutate()} />
          </div>
        ) : isLoading && !data ? (
          <div className="p-4">
            <LoadingBlock />
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No bookings found" action={tab === 'all' && !debouncedQ && !activeFilters ? <Link href="/company/book" className="font-semibold text-brand-600">Book a tanker</Link> : undefined}>
              {debouncedQ || activeFilters ? 'Try a different search or clear the filters.' : 'Bookings in this stage will appear here.'}
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-medium">Booking ID</th>
                    <th className="px-3 py-3 font-medium">Date</th>
                    <th className="px-3 py-3 font-medium">Pickup</th>
                    <th className="px-3 py-3 font-medium">Delivery</th>
                    <th className="px-3 py-3 font-medium">Oil type</th>
                    <th className="px-3 py-3 font-medium">Capacity · Qty</th>
                    <th className="px-3 py-3 text-right font-medium">Customer offer</th>
                    <th className="px-3 py-3 text-right font-medium">Best offer</th>
                    <th className="px-3 py-3 text-right font-medium">Accepted price</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((b) => (
                    <tr key={b.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                      <td className="px-4 py-3">
                        <Link href={`/company/bookings/${b.id}`} className="font-semibold text-brand-700 hover:underline">
                          {b.bookingCode}
                        </Link>
                        {b.isDemo && (
                          <div className="mt-0.5">
                            <DemoBadge />
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted">
                        {dateIST(b.createdAt)}
                        <div className="text-xs">Load {dayOnly(b.loadingDate)}</div>
                      </td>
                      <td className="max-w-[180px] px-3 py-3">
                        <p className="font-medium">{b.pickup?.city ?? '—'}</p>
                        <p className="truncate text-xs text-muted" title={b.pickup?.address}>{b.pickup?.address}</p>
                      </td>
                      <td className="max-w-[180px] px-3 py-3">
                        <p className="font-medium">{b.delivery?.city ?? '—'}</p>
                        <p className="truncate text-xs text-muted" title={b.delivery?.address}>{b.delivery?.address}</p>
                      </td>
                      <td className="px-3 py-3">{b.product}</td>
                      <td className="px-3 py-3">
                        {kl(b.tankerCapacityKl)} × {b.numberOfTankers ?? 1}
                        <div className="text-xs text-muted">{kl(b.quantityKl)} total</div>
                        {b.numberOfTankers && b.numberOfTankers > 1 && b.tankersAllocated > 0 && b.tankersAllocated < b.numberOfTankers && (
                          <div className="text-xs font-medium text-orange-700">
                            {b.tankersAllocated}/{b.numberOfTankers} allocated
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{inr(b.customerOffer)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {b.bestOffer ? (
                          <Link href={`/company/bookings/${b.id}/offers`} className="font-semibold text-brand-700 hover:underline">
                            {inr(b.bestOffer)}
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                        {b.openOffersCount > 0 && <p className="text-xs text-muted">{b.openOffersCount} open</p>}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-green-700">{b.acceptedFreight ? inr(b.acceptedFreight) : <span className="font-normal text-muted">—</span>}</td>
                      <td className="px-3 py-3">
                        <BookingStatusBadge status={b.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {b.openOffersCount > 0 && (
                            <Link href={`/company/bookings/${b.id}/offers`} className="rounded-lg bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-100">
                              Offers
                            </Link>
                          )}
                          <RowMenu b={b} onEdit={() => void openEdit(b)} onCancel={() => setCancelling(b)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 pb-4">
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
            </div>
          </>
        )}
      </Card>
      <CancelBookingDialog open={Boolean(cancelling)} onClose={() => setCancelling(null)} booking={cancelling} onDone={() => mutate()} />
      <EditBookingDialog open={Boolean(editing)} onClose={() => setEditing(null)} booking={editing} onDone={() => mutate()} />
    </div>
  );
}

export default function BookingsPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <BookingsInner />
    </Suspense>
  );
}
