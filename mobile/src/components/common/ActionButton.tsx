import { useState } from 'react';
import { Alert } from 'react-native';
import { Button } from '@/components/ui';
import { parseApiError } from '@/services/api';

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
