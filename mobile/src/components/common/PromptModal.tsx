import { useState } from 'react';
import { Modal, Text, TextInput, View } from 'react-native';
import { Banner, Button } from '@/components/ui';
import { parseApiError } from '@/services/api';
import { pageStyles as s } from '@/theme';

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
