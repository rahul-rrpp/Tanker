import { Stack, useRouter, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { homeRouteFor, useAuth } from '@/features/auth/context/AuthContext';
import { experienceOf } from '@/features/auth/utils/experience';
import { AnimatedSplash } from '@/features/splash/components/AnimatedSplash';
import { AppProviders } from '@/providers/AppProviders';
import { colors, FONT_ASSETS } from '@/theme';
import { ROUTES } from './routes';
// Registers the background location task before any screen mounts (required by expo-task-manager).
import '@/features/driver/services/locationTracking';

void SplashScreen.preventAutoHideAsync();

/**
 * Auth gate: signed-out users can only see (auth) screens; signed-in users are routed to the landing
 * screen the backend's roles/statuses imply. Runs on every state change (login, logout, expiry).
 */
function Gate() {
  const { status, user } = useAuth();
  // Bundled fonts load in a few ms behind the splash; if one ever fails, the app still opens with the system font.
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const fontsReady = fontsLoaded || Boolean(fontError);
  const segments = useSegments();
  const router = useRouter();

  // The animated splash hides the native one on its first frame; this is only a safety net so the app can never
  // stay stuck behind the native splash.
  useEffect(() => {
    const t = setTimeout(() => void SplashScreen.hideAsync().catch(() => undefined), 5000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (status === 'loading' || status === 'offline') return;
    const group = segments[0];
    if (status === 'signedOut' && group !== '(auth)') router.replace(ROUTES.welcome);
    // Each signed-in user may only be inside their own experience (plus the shared (app) screens).
    if (status === 'signedIn' && user && group !== '(app)' && group !== experienceOf(user)) router.replace(homeRouteFor(user));
  }, [status, user, segments, router]);

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }} />
      <AnimatedSplash ready={status !== 'loading' && fontsReady} />
    </>
  );
}

/** Root layout (app/_layout.tsx): providers, splash handling and the auth gate. */
export default function RootNavigator() {
  return (
    <AppProviders>
      <Gate />
    </AppProviders>
  );
}
