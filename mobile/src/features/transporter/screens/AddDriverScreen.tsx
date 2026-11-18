import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { parseApiError } from '@/services/api';
import { Banner, Button, Card, ChoiceChips, Field, IconBadge } from '@/components/ui';
import { colors, formStyles } from '@/theme';
import { ROUTES } from '@/navigation/routes';
import { transporterService } from '../services/transporterService';

const LICENCE_TYPES = ['LMV', 'HMV', 'HGMV', 'HTV', 'TRANS'] as const;
const HAZMAT = [
  { value: 'NOT_PROVIDED', label: 'Not provided' },
  { value: 'VALID', label: 'Valid' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'NOT_REQUIRED', label: 'Not required' },
] as const;
type Hazmat = (typeof HAZMAT)[number]['value'];

type Form = {
  fullName: string; phone: string; email: string; licenceNumber: string; licenceType?: (typeof LICENCE_TYPES)[number];
  licenceExpiry: string; hazardousTraining: Hazmat; address: string; emergencyContactName: string; emergencyContactPhone: string;
};
const EMPTY: Form = { fullName: '', phone: '', email: '', licenceNumber: '', licenceExpiry: '', hazardousTraining: 'NOT_PROVIDED', address: '', emergencyContactName: '', emergencyContactPhone: '' };

const digits = (s: string) => s.replace(/\D/g, '').slice(-10);

/** Quick client checks; the backend validates everything again and owns the transporter link. */
function validate(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  if (f.fullName.trim().length < 2) e.fullName = 'Enter the driver’s full name';
  if (!/^[6-9]\d{9}$/.test(digits(f.phone))) e.phone = 'Enter a valid 10-digit mobile number';
  if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = 'Enter a valid email or leave it blank';
  if (f.licenceNumber.trim().length < 6) e.licenceNumber = 'Enter the driving licence number';
  if (!f.licenceType) e.licenceType = 'Choose the licence type';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.licenceExpiry.trim())) e.licenceExpiry = 'Use YYYY-MM-DD, e.g. 2028-03-31';
  if (f.address.trim().length < 5) e.address = 'Enter the driver’s address';
  if (f.emergencyContactName.trim().length < 2) e.emergencyContactName = 'Enter an emergency contact name';
  if (!/^[6-9]\d{9}$/.test(digits(f.emergencyContactPhone))) e.emergencyContactPhone = 'Enter a valid 10-digit mobile number';
  return e;
}

/**
 * Transporter adds a driver: creates the driver's own login (no password; they sign in with an OTP to
 * their mobile), then optionally sends the login code straight away. Documents stay on the web portal.
 */
export default function AddDriverScreen() {
  const router = useRouter();
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState<{ id: string; fullName: string; phone: string } | null>(null);
  const [invite, setInvite] = useState<{ busy: boolean; sent?: boolean; devCode?: string; error?: string }>({ busy: false });

  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const submit = async () => {
    setError(null);
    const e = validate(f);
    setErrors(e);
    if (Object.keys(e).length) return setError('Please fix the highlighted fields.');
    setSaving(true);
    try {
      const { data } = await transporterService.createDriver({
        fullName: f.fullName.trim(),
        phone: digits(f.phone),
        email: f.email.trim() || undefined,
        licenceNumber: f.licenceNumber.trim().toUpperCase(),
        licenceType: f.licenceType,
        licenceExpiry: f.licenceExpiry.trim(),
        hazardousTraining: f.hazardousTraining,
        address: f.address.trim(),
        emergencyContactName: f.emergencyContactName.trim(),
        emergencyContactPhone: digits(f.emergencyContactPhone),
        employmentStatus: 'ACTIVE',
      });
      setAdded(data.data.driver);
    } catch (err) {
      const p = parseApiError(err);
      setErrors(Object.fromEntries(p.fields.map((x) => [x.field, x.message])));
      setError(p.message);
    } finally {
      setSaving(false);
    }
  };

  const sendInvite = async () => {
    if (!added) return;
    setInvite({ busy: true });
    try {
      const { data } = await transporterService.inviteDriver(added.id);
      setInvite({ busy: false, sent: true, devCode: data.data?.devCode });
    } catch (err) {
      setInvite({ busy: false, error: parseApiError(err).message });
    }
  };

  if (added) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Stack.Screen options={{ title: 'Driver added' }} />
        <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
          <IconBadge icon="checkmark-circle" tone="success" size={56} />
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.ink }}>{added.fullName} added</Text>
          <Text style={{ color: colors.muted, textAlign: 'center' }}>
            Their login uses mobile {added.phone}. They sign in with a one-time code — there is no password to share.
          </Text>
        </Card>
        {invite.sent ? (
          <Banner tone="success">
            {`Login code sent to ${added.phone}.${invite.devCode ? ` Development code: ${invite.devCode}` : ''} The driver opens the app, chooses “One-time code” and signs in.`}
          </Banner>
        ) : null}
        {invite.error ? <Banner>{invite.error}</Banner> : null}
        {!invite.sent ? <Button title="Send login code to driver" icon="paper-plane-outline" loading={invite.busy} onPress={() => void sendInvite()} /> : null}
        <Banner tone="info">Upload the driver’s licence and ID on the web portal (Drivers → driver → Documents) so the driver can be verified.</Banner>
        <Button title="Add another driver" variant="secondary" icon="person-add-outline" onPress={() => { setF(EMPTY); setAdded(null); setInvite({ busy: false }); }} />
        <Button title="Done" variant="secondary" onPress={() => router.replace(ROUTES.transporter.account)} />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: 'Add driver' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 12 }} keyboardShouldPersistTaps="handled">
        <Banner tone="info">The driver gets their own login with this mobile number and signs in with a one-time code.</Banner>
        {error ? <Banner>{error}</Banner> : null}
        <Card>
          <Text style={sectionTitle}>Driver</Text>
          <Field label="Full name" required value={f.fullName} onChangeText={set('fullName')} error={errors.fullName} autoComplete="name" />
          <Field label="Mobile number" required prefix="+91" keyboardType="phone-pad" maxLength={14} value={f.phone} onChangeText={set('phone')} error={errors.phone} />
          <Field label="Email" hint="Optional" keyboardType="email-address" autoCapitalize="none" value={f.email} onChangeText={set('email')} error={errors.email} />
          <Field label="Address" required multiline value={f.address} onChangeText={set('address')} error={errors.address} style={{ paddingTop: 14 }} />
        </Card>
        <Card>
          <Text style={sectionTitle}>Licence</Text>
          <Field label="Licence number" required autoCapitalize="characters" maxLength={20} value={f.licenceNumber} onChangeText={set('licenceNumber')} error={errors.licenceNumber} />
          <ChoiceChips label="Licence type *" options={LICENCE_TYPES.map((t) => ({ value: t, label: t }))} value={f.licenceType} onChange={set('licenceType')} error={errors.licenceType} />
          <Field label="Licence expiry" required placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} value={f.licenceExpiry} onChangeText={set('licenceExpiry')} error={errors.licenceExpiry} />
          <ChoiceChips label="Hazardous goods training" options={HAZMAT.map((h) => ({ value: h.value, label: h.label }))} value={f.hazardousTraining} onChange={set('hazardousTraining')} />
        </Card>
        <Card>
          <Text style={sectionTitle}>Emergency contact</Text>
          <Field label="Name" required value={f.emergencyContactName} onChangeText={set('emergencyContactName')} error={errors.emergencyContactName} />
          <Field label="Mobile number" required prefix="+91" keyboardType="phone-pad" maxLength={14} value={f.emergencyContactPhone} onChangeText={set('emergencyContactPhone')} error={errors.emergencyContactPhone} />
        </Card>
      </ScrollView>
      <View style={formStyles.footer}>
        <Button title="Add driver" icon="person-add-outline" loading={saving} onPress={() => void submit()} />
      </View>
    </KeyboardAvoidingView>
  );
}

const sectionTitle = { fontSize: 15, fontWeight: '800' as const, color: colors.ink, marginBottom: 12 };
