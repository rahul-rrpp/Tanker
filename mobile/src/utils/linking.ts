import { Linking } from 'react-native';

/** Opens the phone dialler. */
export function callPhone(phone: string | null | undefined) {
  if (phone) void Linking.openURL(`tel:${phone}`);
}

/** Opens Google Maps (or the browser) with driving directions to a point. */
export function openMaps(lat: number, lng: number) {
  void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`);
}
