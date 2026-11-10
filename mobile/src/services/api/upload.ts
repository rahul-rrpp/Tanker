import { api } from './client';

/** A file picked on the device, ready for a multipart upload. */
export type PickedFile = { uri: string; name: string; mimeType: string };

/** Multipart upload; the server re-checks the real file type. */
export async function upload(path: string, fields: Record<string, string>, file: PickedFile) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  return api.post(path, form, { headers: { 'Content-Type': 'multipart/form-data' } });
}
