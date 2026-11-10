import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, homeRouteFor, useAuth } from '@/auth/AuthContext';
import { colors } from '@/lib/theme';
import { experienceOf } from '@/lib/types';
// Registers the background location task before any screen mounts (required by expo-task-manager).
import '@/driver/location';

void SplashScreen.preventAutoHideAsync();

/**
 * Auth gate: signed-out users can only see (auth) screens; signed-in users are routed to the landing
 * screen the backend's roles/statuses imply. Runs on every state change (login, logout, expiry).
 */
function Gate() {
  const { status, user } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  useEffect(() => {
    if (status === 'loading' || status === 'offline') return;
    const group = segments[0];
    if (status === 'signedOut' && group !== '(auth)') router.replace('/welcome');
    // Each signed-in user may only be inside their own experience (plus the shared (app) screens).
    if (status === 'signedIn' && user && group !== '(app)' && group !== experienceOf(user)) router.replace(homeRouteFor(user));
  }, [status, user, segments, router]);

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
