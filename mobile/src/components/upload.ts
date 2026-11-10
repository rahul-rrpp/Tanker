import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { api } from '../api/client';

type Picked = { uri: string; name: string; mimeType: string };

/** Lets the user take a photo or choose a PDF/image, and returns it ready for a multipart upload. */
export function pickFile(): Promise<Picked | null> {
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

/** Multipart upload; the server re-checks the real file type. */
export async function upload(path: string, fields: Record<string, string>, file: Picked) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  return api.post(path, form, { headers: { 'Content-Type': 'multipart/form-data' } });
}
