import { useState } from 'react';
import { View } from 'react-native';
import { Chips } from '@/components/ui';
import { Page } from '@/components/layout';
import { QueryState } from '@/components/common';
import { CompanyOfferCard, type CompanyOffer } from '@/features/company/components/CompanyOfferCard';
import { useQuery } from '@/hooks';
import { ENDPOINTS } from '@/services/api';

/** All transporter quotes across bookings, as slips. Open quotes that wait on you come first. */
export default function CompanyOffersScreen() {
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open');
  const q = useQuery<{ offers: CompanyOffer[] }>(ENDPOINTS.company.offers(status), { pollMs: 30_000 });
  const offers = [...(q.data?.offers ?? [])].sort((a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING'));
  return (
    <Page title="Offers" subtitle="Quotes from transporters on your bookings" refreshing={q.refreshing} onRefresh={q.refresh}>
      <Chips value={status} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' }]} onChange={setStatus} />
      <QueryState loading={q.loading} error={q.error} skeleton="rows" empty={q.data?.offers.length === 0} emptyText={status === 'open' ? 'No open offers' : 'No offers here'} emptyIcon="pricetags-outline" onRetry={q.reload} />
      <View style={{ gap: 12 }}>
        {offers.map((o) => <CompanyOfferCard key={o.id} o={o} showBooking onChanged={q.reload} />)}
      </View>
    </Page>
  );
}
