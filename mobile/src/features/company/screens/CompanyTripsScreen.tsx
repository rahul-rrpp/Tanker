import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Chips, LedgerRow, Pill } from '@/components/ui';
import { ListPage } from '@/components/layout';
import { QueryState } from '@/components/common';
import { toneFor } from '@/utils/status';
import { dateTime, humanize } from '@/utils/format';
import { useQuery } from '@/hooks';
import type { CompanyTrip } from '../types';
import { ENDPOINTS } from '@/services/api';
import { ROUTES } from '@/navigation/routes';

/** Trips as a ledger: route, who is carrying it (tanker plate in mono), and the ETA. Moving trips glow orange. */
export default function CompanyTripsScreen() {
  const router = useRouter();
  const [scope, setScope] = useState<'active' | 'completed' | 'all'>('active');
  const q = useQuery<{ trips: CompanyTrip[] }>(ENDPOINTS.company.trips(scope), { pollMs: 60_000 });
  const items = q.data?.trips ?? [];
  return (
    <ListPage
      title="Trips"
      subtitle="Where your loads are"
      refreshing={q.refreshing}
      onRefresh={q.refresh}
      top={
        <>
          <Chips value={scope} options={[{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All' }]} onChange={setScope} />
          <QueryState loading={q.loading} error={q.error} empty={q.data?.trips.length === 0} emptyText={scope === 'active' ? 'Nothing on the road' : 'No trips here'} emptyIcon="navigate-outline" onRetry={q.reload} />
        </>
      }
      data={items}
      keyExtractor={(t) => t.id}
      renderItem={({ item: t, index }) => (
        <LedgerRow
          code={`${t.tripCode} · ${t.booking.bookingCode}`}
          status={<Pill label={humanize(t.status)} tone={toneFor(t.status)} live={t.status === 'IN_TRANSIT'} />}
          from={t.pickup?.city}
          to={t.delivery?.city}
          meta={[
            `${t.tanker?.registrationNumber ?? 'Tanker not assigned'} · ${t.driver?.user.fullName ?? 'driver not assigned'}`,
            t.etaAt ? `ETA ${dateTime(t.etaAt)} · ${t.transporter.companyName}` : t.transporter.companyName,
          ]}
          onPress={() => router.push(ROUTES.company.trip(t.id))}
          last={index === items.length - 1}
        />
      )}
    />
  );
}
