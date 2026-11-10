import { Ionicons } from '@expo/vector-icons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, parseApiError } from '../api/client';
import { colors, radius } from '../lib/theme';
import { Banner, Button } from './ui';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Scrollable page with pull-to-refresh and a header title. */
export function Page({ title, subtitle, children, refreshing, onRefresh, right }: { title: string; subtitle?: string; children: ReactNode; refreshing?: boolean; onRefresh?: () => void; right?: ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }} refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} /> : undefined} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.title} accessibilityRole="header">{title}</Text>
            {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: ViewStyle }) {
  const body = <View style={[s.card, style]}>{children}</View>;
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{body}</Pressable> : body;
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value ?? '—'}</Text>
    </View>
  );
}

const TONES = { neutral: ['#eef1f5', colors.muted], info: [colors.brand50, colors.brand600], success: [colors.successBg, colors.success], warning: [colors.warningBg, colors.warning], danger: [colors.dangerBg, colors.danger] } as const;
export type Tone = keyof typeof TONES;

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const [bg, fg] = TONES[tone];
  return <Text style={[s.pill, { backgroundColor: bg, color: fg }]}>{label}</Text>;
}

/** Status → tone, for bookings, trips, offers and tickets. */
export function toneFor(status: string): Tone {
  if (/COMPLETED|DELIVERED|ACCEPTED|APPROVED|VERIFIED|SETTLED|RESOLVED|PAID/.test(status)) return 'success';
  if (/CANCELLED|REJECTED|SUSPENDED|FAILED|DISPUTED|EXPIRED/.test(status)) return 'danger';
  if (/PENDING|COUNTERED|SEARCHING|OFFERS|NEGOTIATION|OPEN|ON_HOLD/.test(status)) return 'warning';
  return 'info';
}

export function Stats({ items }: { items: { label: string; value: ReactNode; icon?: IconName }[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {items.map((i) => (
        <View key={i.label} style={s.stat}>
          {i.icon ? <Ionicons name={i.icon} size={18} color={colors.brand600} /> : null}
          <Text style={s.statValue} numberOfLines={1}>{i.value}</Text>
          <Text style={s.statLabel} numberOfLines={2}>{i.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={s.section}>{children}</Text>;
}

/** Loading, error and empty handling for any query. */
export function QueryState({ loading, error, empty, emptyText = 'Nothing here yet', onRetry }: { loading: boolean; error: string | null; empty?: boolean; emptyText?: string; onRetry?: () => void }) {
  if (loading) return <ActivityIndicator style={{ marginTop: 32 }} color={colors.brand600} accessibilityLabel="Loading" />;
  if (error) return <View style={{ gap: 8 }}><Banner>{error}</Banner>{onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}</View>;
  if (empty) return <Text style={s.empty}>{emptyText}</Text>;
  return null;
}

export function Chips<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[s.chip, on && s.chipOn]}>
            <Text style={[s.chipText, on && { color: '#fff' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * Runs one API call behind a button and reports the outcome. `confirm` asks first, which matters on a
 * phone where a mis-tap is easy.
 */
export function ActionButton({ title, action, success, onDone, confirm, variant = 'primary', disabled }: { title: string; action: () => Promise<unknown>; success: string; onDone?: () => void; confirm?: string; variant?: 'primary' | 'secondary' | 'danger'; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await action();
      Alert.alert('Done', success);
      onDone?.();
    } catch (e) {
      Alert.alert('Could not complete', parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return <Button title={title} variant={variant} loading={busy} disabled={disabled} onPress={() => (confirm ? Alert.alert('Please confirm', confirm, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: () => void run() }]) : void run())} />;
}

/** One-field prompt (amounts, reasons). Works the same on Android and iOS. */
export function PromptModal({ visible, title, label, keyboard = 'default', submit, onClose, onSubmit, hint }: { visible: boolean; title: string; label: string; keyboard?: 'default' | 'numeric'; submit: string; onClose: () => void; onSubmit: (v: string) => Promise<void>; hint?: string }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value.trim());
      setValue('');
      onClose();
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.sheetBackdrop}>
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>{title}</Text>
          {error ? <Banner>{error}</Banner> : null}
          <Text style={s.rowLabel}>{label}</Text>
          <TextInput style={s.input} value={value} onChangeText={setValue} keyboardType={keyboard === 'numeric' ? 'number-pad' : 'default'} multiline={keyboard !== 'numeric'} autoFocus accessibilityLabel={label} />
          {hint ? <Text style={[s.rowLabel, { marginTop: 4 }]}>{hint}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <View style={{ flex: 1 }}><Button title="Cancel" variant="secondary" onPress={onClose} /></View>
            <View style={{ flex: 1 }}><Button title={submit} loading={busy} disabled={!value.trim()} onPress={() => void go()} /></View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Choose one item from a list (tanker, driver, product...). */
export function PickerModal<T extends { id: string; label: string }>({ visible, title, items, onClose, onPick }: { visible: boolean; title: string; items: T[]; onClose: () => void; onPick: (item: T) => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.sheetBackdrop}>
        <View style={[s.sheet, { maxHeight: '75%' }]}>
          <Text style={s.sheetTitle}>{title}</Text>
          <ScrollView>
            {items.length === 0 ? <Text style={s.empty}>Nothing available</Text> : items.map((i) => (
              <Pressable key={i.id} onPress={() => { onPick(i); onClose(); }} style={s.pickRow} accessibilityRole="button">
                <Text style={{ color: colors.ink, fontSize: 15 }}>{i.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Button title="Cancel" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/** Opens a stored file (PDF or image) through the authenticated API by downloading it to a temporary URL. */
export function callPhone(phone: string | null | undefined) {
  if (phone) void Linking.openURL(`tel:${phone}`);
}

export function openMaps(lat: number, lng: number) {
  void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`);
}

export async function markRead(id: string) {
  try {
    await api.put(`/notifications/${id}/read`);
  } catch {
    /* best effort */
  }
}

export const s = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  rowLabel: { color: colors.muted, fontSize: 13 },
  rowValue: { color: colors.ink, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  pill: { alignSelf: 'flex-start', overflow: 'hidden', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, fontSize: 12, fontWeight: '600' },
  stat: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 2 },
  statValue: { fontSize: 20, fontWeight: '700', color: colors.ink },
  statLabel: { fontSize: 12, color: colors.muted },
  section: { fontSize: 16, fontWeight: '700', color: colors.ink, marginTop: 8 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
  chip: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  chipText: { color: colors.ink, fontWeight: '600', fontSize: 13 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 8 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.field, padding: 12, fontSize: 16, color: colors.ink, minHeight: 48 },
  pickRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
});
