import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { api } from '../api/client';

/**
 * Background trip tracking. The OS keeps delivering positions while the phone is locked or the app is in
 * the background (Android shows a persistent notification; iOS shows the blue location indicator).
 * Points are queued on the device and sent in batches, so a dead zone on the highway loses nothing.
 * Needs a development or store build: Expo Go cannot run background location.
 */
export const LOCATION_TASK = 'tankerlink-trip-location';
const TRIP_KEY = 'tl.activeTrip';
const QUEUE_KEY = 'tl.locationQueue';
const MAX_QUEUE = 2000;

type Point = { latitude: number; longitude: number; speedKmph?: number; heading?: number; recordedAt: string };

async function readQueue(): Promise<Point[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]') as Point[];
  } catch {
    return [];
  }
}

let flushing: Promise<void> | null = null;

/** Sends queued points in batches of 200. A failed batch stays queued for the next attempt. */
export function flushLocations(): Promise<void> {
  flushing ??= (async () => {
    const tripId = await AsyncStorage.getItem(TRIP_KEY);
    let q = await readQueue();
    if (!tripId) return;
    while (q.length) {
      const batch = q.slice(0, 200);
      try {
        await api.post(`/driver/me/trips/${tripId}/location`, { points: batch });
      } catch (e) {
        // 409 = trip no longer trackable: stop and drop, so a finished trip cannot keep a stale queue.
        if ((e as { response?: { status?: number } }).response?.status === 409) {
          await stopTripTracking();
        }
        return;
      }
      q = q.slice(batch.length);
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const points: Point[] = data.locations.map((l) => ({
    latitude: l.coords.latitude,
    longitude: l.coords.longitude,
    ...(l.coords.speed !== null && l.coords.speed >= 0 ? { speedKmph: Math.min(250, l.coords.speed * 3.6) } : {}),
    ...(l.coords.heading !== null && l.coords.heading >= 0 ? { heading: Math.round(l.coords.heading) % 360 } : {}),
    recordedAt: new Date(l.timestamp).toISOString(),
  }));
  const q = [...(await readQueue()), ...points].slice(-MAX_QUEUE);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  await flushLocations();
});

export type Permission = 'granted' | 'foreground-only' | 'denied';

export async function trackingPermission(): Promise<Permission> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.status === 'granted' ? 'granted' : 'foreground-only';
}

/** Asks for permission with explicit consent, then starts OS-level tracking for this trip. */
export async function startTripTracking(tripId: string): Promise<Permission> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ status: 'denied' as const }));
  await AsyncStorage.setItem(TRIP_KEY, tripId);
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 30_000,
    distanceInterval: 50,
    deferredUpdatesInterval: 60_000,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    foregroundService: { notificationTitle: 'TankerLink trip tracking', notificationBody: 'Sharing your location with your transporter for this trip.', notificationColor: '#17559a' },
  });
  return bg.status === 'granted' ? 'granted' : 'foreground-only';
}

export async function stopTripTracking() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  await AsyncStorage.multiRemove([TRIP_KEY, QUEUE_KEY]);
}

export async function trackingState() {
  const [tripId, q, running] = await Promise.all([AsyncStorage.getItem(TRIP_KEY), readQueue(), Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)]);
  return { tripId, queued: q.length, running };
}

/** Current position for a status update, if permission allows; never blocks the update. */
export async function currentPoint(): Promise<{ latitude?: number; longitude?: number }> {
  try {
    if ((await Location.getForegroundPermissionsAsync()).status !== 'granted') return {};
    const p = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
    return p ? { latitude: p.coords.latitude, longitude: p.coords.longitude } : {};
  } catch {
    return {};
  }
}
