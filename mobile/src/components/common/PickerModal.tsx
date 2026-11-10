import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { colors, pageStyles as s } from '@/theme';

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
