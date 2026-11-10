import { useState } from 'react';
import { Chips } from '@/components/ui';
import { Page } from '@/components/layout';
import { QueryState } from '@/components/common';
import { CompanyOfferCard, type CompanyOffer } from '@/features/company/components/CompanyOfferCard';
import { useQuery } from '@/hooks';
import { ENDPOINTS } from '@/services/api';

export default function CompanyOffersScreen() {
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open');
  const q = useQuery<{ offers: CompanyOffer[] }>(ENDPOINTS.company.offers(status), { pollMs: 30_000 });
  return (
    <Page title="Transporter offers" refreshing={q.refreshing} onRefresh={q.refresh}>
      <Chips value={status} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' }]} onChange={setStatus} />
      <QueryState loading={q.loading} error={q.error} empty={q.data?.offers.length === 0} emptyText="No offers here" onRetry={q.reload} />
      {q.data?.offers.map((o) => <CompanyOfferCard key={o.id} o={o} showBooking onChanged={q.reload} />)}
    </Page>
  );
}
