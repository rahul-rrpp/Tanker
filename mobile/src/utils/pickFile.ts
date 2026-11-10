import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import type { PickedFile } from '@/services/api';

/** Lets the user take a photo or choose a PDF/image, and returns it ready for a multipart upload. */
export function pickFile(): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    Alert.alert('Add document', 'Take a photo or choose a file', [
      {
        text: 'Take photo',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) return resolve(null);
          const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
          const a = r.canceled ? null : r.assets[0];
          resolve(a ? { uri: a.uri, name: a.fileName ?? 'photo.jpg', mimeType: a.mimeType ?? 'image/jpeg' } : null);
        },
      },
      {
        text: 'Choose file',
        onPress: async () => {
          const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true });
          const a = r.canceled ? null : r.assets[0];
          resolve(a ? { uri: a.uri, name: a.name, mimeType: a.mimeType ?? 'application/pdf' } : null);
        },
      },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}
