import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { ENDPOINTS } from '@/services/api';
import { ActionButton, PromptModal, QueryState } from '@/components/common';
import { Banner, Button, Card, IconBadge, InfoCard, Pill, SectionTitle, SummaryCard, Timeline } from '@/components/ui';
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
    <Page title="Trip" subtitle={x ? `${x.company} · ${x.bookingCode}` : undefined} refreshing={q.refreshing} onRefresh={reload}>
      <Stack.Screen options={{ title: x?.tripCode ?? 'Trip' }} />
      <QueryState loading={q.loading} error={q.error} onRetry={q.reload} skeleton="detail" />
      {x ? (
        <>
          <SummaryCard code={x.tripCode} status={<Pill label={humanize(x.status)} tone={toneFor(x.status)} />} from={x.pickup} to={x.delivery} />
          {open.map((a) => <Banner key={a.id}>{`${humanize(a.type)}: ${a.message} (${timeAgo(a.detectedAt)})`}</Banner>)}
          {g ? (
            <Card style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconBadge icon="locate-outline" tone="brand" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: colors.ink }}>{km(g.remainingDistanceKm)} to go</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Last update {timeAgo(g.lastGpsAt)}</Text>
                </View>
              </View>
              {g.dataSource === 'SIMULATED' ? <Banner tone="warning">{g.dataSourceLabel}</Banner> : <Text style={{ color: colors.muted, fontSize: 12 }}>{g.dataSourceLabel}</Text>}
              {g.currentPosition ? <Button title="Show tanker on map" icon="map-outline" onPress={() => openMaps(g.currentPosition!.lat, g.currentPosition!.lng)} /> : null}
            </Card>
          ) : null}
          <InfoCard
            title="Load and crew"
            items={[
              { icon: 'flask-outline', label: 'Product', value: x.product },
              { icon: 'calendar-outline', label: 'Loading', value: `${day(x.loadingDate)}, ${x.loadingTime}` },
              { icon: 'flag-outline', label: 'Delivery by', value: day(x.expectedDeliveryDate) },
              { icon: 'bus-outline', label: 'Tanker', value: x.tanker?.registrationNumber },
              { icon: 'person-outline', label: 'Driver', value: x.driver?.name },
            ]}
            footer={x.driver ? <Button title="Call driver" icon="call-outline" variant="secondary" onPress={() => callPhone(x.driver!.phone)} /> : undefined}
          />
          {x.status === 'DELIVERED' ? <ActionButton title="Close trip and release tanker" icon="checkmark-done-outline" action={() => tripsService.complete(id)} success="Trip completed. The tanker is available at the delivery point." onDone={reload} confirm="Close this trip? The tanker becomes available where it was delivered." /> : null}
          {!['COMPLETED', 'CANCELLED'].includes(x.status) ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Button title="Report delay" icon="time-outline" variant="secondary" onPress={() => setIssue('DELAYED')} /></View>
              <View style={{ flex: 1 }}><Button title="Emergency" icon="warning-outline" variant="danger" onPress={() => setIssue('EMERGENCY')} /></View>
            </View>
          ) : null}
          {q.data?.documents.length ? (
            <>
              <SectionTitle>Documents</SectionTitle>
              <Card style={{ gap: 10 }}>
                {q.data.documents.map((d) => (
                  <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <IconBadge icon="document-attach-outline" tone="success" size={34} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700', color: colors.ink }}>{humanize(d.type)}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{d.title} · {dateTime(d.createdAt)}</Text>
                    </View>
                  </View>
                ))}
              </Card>
            </>
          ) : null}
          {h.data?.history.length ? (
            <>
              <SectionTitle>Timeline</SectionTitle>
              <Card>
                <Timeline items={h.data.history.map((r) => ({ key: r.id, title: humanize(r.newStatus), detail: `${dateTime(r.at)} · ${r.updatedBy}${r.remarks ? ` · ${r.remarks}` : ''}` }))} />
              </Card>
            </>
          ) : null}
          <PromptModal visible={Boolean(issue)} title={issue === 'EMERGENCY' ? 'Report emergency' : 'Report delay'} label="Details" submit="Report" onClose={() => setIssue(null)} onSubmit={async (message) => { await tripsService.reportIssue(id, issue, message); reload(); }} />
        </>
      ) : null}
    </Page>
  );
}
