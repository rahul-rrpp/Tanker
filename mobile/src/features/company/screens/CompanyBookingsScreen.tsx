import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Chips, LedgerRow, Pill } from '@/components/ui';
import { ListPage } from '@/components/layout';
import { QueryState } from '@/components/common';
import { toneFor } from '@/utils/status';
import { humanize, inr } from '@/utils/format';
import { useQuery } from '@/hooks';
import { ENDPOINTS } from '@/services/api';
import { ROUTES } from '@/navigation/routes';

/** Shape of GET /bookings list items (backend booking.service list view). */
type Place = { address: string; city: string | null; state: string | null } | null;
type B = { id: string; bookingCode: string; status: string; customerOffer: number; acceptedFreight: number | null; loadingDate: string; pickup: Place; delivery: Place; product: string; quantityKl: number; openOffersCount: number; isDemo: boolean };
const TABS = [['all', 'All'], ['searching', 'Searching'], ['offers', 'Offers'], ['negotiation', 'Negotiation'], ['confirmed', 'Confirmed'], ['in_transit', 'In transit'], ['completed', 'Completed'], ['cancelled', 'Cancelled']] as const;
type Tab = (typeof TABS)[number][0];

/** Every booking as a ledger, newest first, filtered by stage. Rows with open offers are flagged. */
export default function CompanyBookingsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('all');
  const q = useQuery<{ items: B[]; total: number; tabCounts?: Partial<Record<Tab, number>> }>(ENDPOINTS.company.bookings(tab));
  // Keep the last counts on screen while another tab loads (the query clears its data on tab change).
  const counts = useRef<Partial<Record<Tab, number>>>(undefined);
  if (q.data?.tabCounts) counts.current = q.data.tabCounts;
  const items = q.data?.items ?? [];
  return (
    <ListPage
      title="Bookings"
      subtitle={q.data ? `${q.data.total} in this view` : undefined}
      refreshing={q.refreshing}
      onRefresh={q.refresh}
      top={
        <>
          <Chips value={tab} options={TABS.map(([value, label]) => ({ value, label }))} counts={counts.current} onChange={setTab} />
          <QueryState loading={q.loading} error={q.error} empty={q.data?.items.length === 0} emptyText="No bookings here" emptyIcon="document-text-outline" onRetry={q.reload} />
        </>
      }
      data={items}
      keyExtractor={(b) => b.id}
      renderItem={({ item: b, index }) => (
        <LedgerRow
          date={b.loadingDate}
          flag={b.openOffersCount > 0}
          code={`${b.bookingCode}${b.isDemo ? ' · DEMO' : ''}`}
          status={<Pill label={humanize(b.status)} tone={toneFor(b.status)} live={b.status === 'IN_TRANSIT'} />}
          from={b.pickup?.city}
          to={b.delivery?.city}
          amount={inr(b.acceptedFreight ?? b.customerOffer)}
          amountLabel={b.acceptedFreight ? 'agreed' : 'your offer'}
          meta={[`${b.product} · ${b.quantityKl} KL`, b.openOffersCount ? `${b.openOffersCount} open ${b.openOffersCount === 1 ? 'offer' : 'offers'}` : null]}
          onPress={() => router.push(ROUTES.company.booking(b.id))}
          last={index === items.length - 1}
        />
      )}
    />
  );
}
