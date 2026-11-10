import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { ENDPOINTS } from '@/services/api';
import { ActionButton, PromptModal, QueryState } from '@/components/common';
import { Card, Pill, Row, SectionTitle, Banner, Button } from '@/components/ui';
import { callPhone, openMaps } from '@/utils/linking';
import { Page } from '@/components/layout';
import { toneFor } from '@/utils/status';
import { dateTime, day, humanize, km, timeAgo } from '@/utils/format';
import { colors } from '@/theme';
import { useQuery } from '@/hooks';
import { tripsService } from '@/services/domain/tripsService';

type D = { trip: { id: string; tripCode: string; status: string; exception: string | null; bookingCode: string; company: string; product: string; pickup: string; delivery: string; loadingDate: string; loadingTime: string; expectedDeliveryDate: string; tanker: { registrationNumber: string } | null; driver: { name: string; phone: string } | null }; alerts: { id: string; type: string; message: string; resolvedAt: string | null; detectedAt: string }[]; documents: { id: string; type: string; title: string; createdAt: string }[] };
type H = { history: { id: string; newStatus: string; at: string; updatedBy: string; remarks: string | null }[] };
type T = { tracking: { currentPosition: { lat: number; lng: number } | null; remainingDistanceKm: number; lastGpsAt: string | null; dataSource: string; dataSourceLabel: string } };

export default function TransporterTripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery<D>(ENDPOINTS.trips.detail(id), { pollMs: 30_000 });
  const h = useQuery<H>(ENDPOINTS.trips.history(id));
  const t = useQuery<T>(ENDPOINTS.trips.tracking(id), { pollMs: 30_000 });
  const [issue, setIssue] = useState<'DELAYED' | 'EMERGENCY' | null>(null);
  const reload = () => { void q.reload(); void h.reload(); void t.reload(); };
  const x = q.data?.trip;
  const g = t.data?.tracking;
  const open = q.data?.alerts.filter((a) => !a.resolvedAt) ?? [];
  return (
    <Page title={x ? `${x.pickup} → ${x.delivery}` : 'Trip'} subtitle={x ? `${x.tripCode} · ${x.company}` : undefined} refreshing={q.refreshing} onRefresh={reload}>
      <Stack.Screen options={{ title: x?.tripCode ?? 'Trip' }} />
      <QueryState loading={q.loading} error={q.error} onRetry={q.reload} />
      {x ? (
        <>
          <Pill label={humanize(x.status)} tone={toneFor(x.status)} />
          {open.map((a) => <Banner key={a.id}>{`${humanize(a.type)}: ${a.message} (${timeAgo(a.detectedAt)})`}</Banner>)}
          {g ? (
            <Card>
              {g.dataSource === 'SIMULATED' ? <Banner tone="warning">{g.dataSourceLabel}</Banner> : <Text style={{ fontWeight: '600' }}>{g.dataSourceLabel}</Text>}
              <Row label="Remaining" value={km(g.remainingDistanceKm)} />
              <Row label="Last update" value={timeAgo(g.lastGpsAt)} />
              {g.currentPosition ? <Button title="Show tanker on map" onPress={() => openMaps(g.currentPosition!.lat, g.currentPosition!.lng)} /> : null}
            </Card>
          ) : null}
          <Card>
            <Row label="Product" value={x.product} />
            <Row label="Loading" value={`${day(x.loadingDate)}, ${x.loadingTime}`} />
            <Row label="Delivery by" value={day(x.expectedDeliveryDate)} />
            <Row label="Tanker" value={x.tanker?.registrationNumber} />
            <Row label="Driver" value={x.driver?.name} />
          </Card>
          {x.driver ? <Button title="Call driver" variant="secondary" onPress={() => callPhone(x.driver!.phone)} /> : null}
          {x.status === 'DELIVERED' ? <ActionButton title="Close trip and release tanker" action={() => tripsService.complete(id)} success="Trip completed. The tanker is available at the delivery point." onDone={reload} confirm="Close this trip? The tanker becomes available where it was delivered." /> : null}
          {!['COMPLETED', 'CANCELLED'].includes(x.status) ? (
            <>
              <Button title="Report delay" variant="secondary" onPress={() => setIssue('DELAYED')} />
              <Button title="Report emergency" variant="danger" onPress={() => setIssue('EMERGENCY')} />
            </>
          ) : null}
          {q.data?.documents.length ? <SectionTitle>Documents</SectionTitle> : null}
          {q.data?.documents.map((d) => <Text key={d.id} style={{ color: colors.ink }}>{humanize(d.type)}: {d.title} · {dateTime(d.createdAt)}</Text>)}
          <SectionTitle>Timeline</SectionTitle>
          {h.data?.history.map((r) => <Text key={r.id} style={{ color: colors.ink }}>{humanize(r.newStatus)} <Text style={{ color: colors.muted }}>· {dateTime(r.at)} · {r.updatedBy}{r.remarks ? ` · ${r.remarks}` : ''}</Text></Text>)}
          <PromptModal visible={Boolean(issue)} title={issue === 'EMERGENCY' ? 'Report emergency' : 'Report delay'} label="Details" submit="Report" onClose={() => setIssue(null)} onSubmit={async (message) => { await tripsService.reportIssue(id, issue, message); reload(); }} />
        </>
      ) : null}
    </Page>
  );
}
