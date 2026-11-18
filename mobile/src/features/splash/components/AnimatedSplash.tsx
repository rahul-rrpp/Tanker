import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { LOGO_MARK, WORDMARK_LIGHT, WORDMARK_RATIO } from '@/components/ui/Logo';
import { colors } from '@/theme';

/**
 * Premium launch sequence, played once per app start on top of the navigator.
 *
 * Hand-off: the native splash (expo-splash-screen) shows `splash-icon.png` at 288 dp, centred on brand900.
 * This overlay first renders that exact image at the exact size and position, hides the native splash,
 * then crossfades to the sharper in-app pin while it tilts, grows and settles, so there is no visible
 * jump between the two. Meanwhile the auth gate underneath restores the session and routes as usual;
 * the overlay fades out once the animation has played AND auth is no longer loading (or after a safety
 * timeout), so it never blocks the app and never deadlocks.
 */

const NATIVE_ICON_DP = 288; // AndroidX SplashScreen icon size; iOS uses app.json imageWidth (also 288)
const PIN_H = NATIVE_ICON_DP * 0.5; // splash-icon.png draws the pin at 50% of the canvas height, centred
const PIN_W = PIN_H * 0.8; // the pin is 0.8 as wide as it is tall; its round head is PIN_W across
const LOGO_IMAGE = PIN_H / 0.961; // logo-mark.png: the pin fills 96.1% of the image height, centred
const SETTLED_SCALE = 1.16;
const LIFT = -56; // the logo rises to make room for the wordmark
const MIN_SHOW_MS = 1500;
const MAX_WAIT_MS = 6000;
const TAGLINE = 'Every tanker. Every trip.';
const WORD_H = 40;
const GLOW_RINGS = [600, 520, 450, 390, 335, 285, 240, 200, 165];

let playedThisLaunch = false;

function AnimatedSplashImpl({ ready }: { ready: boolean }) {
  const [visible, setVisible] = useState(!playedThisLaunch);
  const [reduceMotion, setReduceMotion] = useState(false);
  const started = useRef(false);
  const exiting = useRef(false);
  const shownAt = useRef(0);

  const native = useRef(new Animated.Value(1)).current; // native-identical image → 3D logo crossfade
  const scale = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const tilt = useRef(new Animated.Value(0)).current; // 0 → 1 → 0 drives the rotateY swing
  const glow = useRef(new Animated.Value(0)).current;
  const sheen = useRef(new Animated.Value(0)).current;
  const words = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;

  // Every derived animated node is created exactly once. Re-creating them on re-render (the parent re-renders on
  // auth/route changes) would detach the running native animations and snap the view back to stale values.
  const fx = useMemo(
    () => ({
      rotateY: tilt.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-16deg'] }),
      rotateX: tilt.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '7deg'] }),
      logo3dOpacity: native.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      exitScale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }),
      rootOpacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      glowScale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
      sheenX: sheen.interpolate({ inputRange: [0, 1], outputRange: [-PIN_W * 1.2, PIN_W * 1.2] }),
      sheenOpacity: sheen.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.32, 0.32, 0] }),
      wordsY: words.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }),
    }),
    [exit, glow, native, sheen, tilt, words],
  );

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
  }, []);

  const finish = useCallback(() => {
    if (exiting.current) return;
    exiting.current = true;
    Animated.timing(exit, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => {
      playedThisLaunch = true;
      setVisible(false);
    });
  }, [exit]);

  const play = useCallback(() => {
    if (started.current) return;
    started.current = true;
    shownAt.current = Date.now();
    const ease = Easing.bezier(0.22, 1, 0.36, 1); // smooth "ease-out-quint"
    Animated.parallel([
      Animated.timing(native, { toValue: 0, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 1, duration: 900, easing: ease, useNativeDriver: true }),
      Animated.spring(scale, { toValue: SETTLED_SCALE, damping: 14, stiffness: 120, mass: 1, useNativeDriver: true }),
      Animated.timing(lift, { toValue: LIFT, duration: 800, delay: 150, easing: ease, useNativeDriver: true }),
      reduceMotion
        ? Animated.delay(0)
        : Animated.sequence([
            Animated.timing(tilt, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(tilt, { toValue: 0, duration: 520, easing: ease, useNativeDriver: true }),
          ]),
      Animated.timing(words, { toValue: 1, duration: 620, delay: 450, easing: ease, useNativeDriver: true }),
      reduceMotion ? Animated.delay(0) : Animated.timing(sheen, { toValue: 1, duration: 750, delay: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [glow, lift, native, reduceMotion, scale, sheen, tilt, words]);

  // First layout = the overlay now looks exactly like the native splash, so hide the native one and play.
  const onLayout = useCallback(() => {
    SplashScreen.hideAsync()
      .catch(() => undefined)
      .finally(play);
  }, [play]);

  // Leave once the animation has had its moment and the app knows where to go; never wait forever.
  useEffect(() => {
    if (!visible) return;
    const safety = setTimeout(finish, MAX_WAIT_MS);
    if (ready) {
      const wait = Math.max(0, MIN_SHOW_MS - (shownAt.current ? Date.now() - shownAt.current : 0));
      const t = setTimeout(finish, shownAt.current ? wait : MIN_SHOW_MS);
      return () => { clearTimeout(t); clearTimeout(safety); };
    }
    return () => clearTimeout(safety);
  }, [ready, visible, finish]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, { opacity: fx.rootOpacity }]}
      onLayout={onLayout}
      accessible
      accessibilityLabel="OnlyTanker is starting"
      pointerEvents={exiting.current ? 'none' : 'auto'}
    >
      <StatusBar style="light" />

      {/* Ambient glow: soft concentric light behind the mark. */}
      <Animated.View style={[styles.center, { opacity: glow, transform: [{ translateY: lift }, { scale: fx.glowScale }] }]} pointerEvents="none">
        {GLOW_RINGS.map((d) => (
          <View key={d} style={[styles.glow, { width: d, height: d, borderRadius: d / 2 }]} />
        ))}
      </Animated.View>

      {/* The mark: native-identical image crossfading into the in-app pin, tilting in perspective. */}
      {/* Outer layer: position and exit zoom. Inner layer: entrance scale and perspective tilt. Kept as separate
          transforms (rather than combining animated values) so every value drives its own native node. */}
      <Animated.View style={[styles.center, { transform: [{ translateY: lift }, { scale: fx.exitScale }] }]} pointerEvents="none">
      <Animated.View style={[styles.center, styles.origin, { transform: [{ perspective: 900 }, { scale }, { rotateX: fx.rotateX }, { rotateY: fx.rotateY }] }]} pointerEvents="none">
        <Animated.Image source={require('@/assets/images/splash-icon.png')} style={[styles.abs, { width: NATIVE_ICON_DP, height: NATIVE_ICON_DP, opacity: native }]} resizeMode="contain" />
        <Animated.Image source={LOGO_MARK} style={[styles.abs, { width: LOGO_IMAGE, height: LOGO_IMAGE, opacity: fx.logo3dOpacity }]} resizeMode="contain" />
        {/* Light sweep, clipped to the pin's round head. */}
        <View style={[styles.abs, styles.headMask]}>
          <Animated.View style={[styles.sheen, { opacity: fx.sheenOpacity, transform: [{ translateX: fx.sheenX }, { rotate: '18deg' }] }]} />
        </View>
      </Animated.View>
      </Animated.View>

      {/* Wordmark. */}
      <Animated.View
        style={[styles.words, { opacity: words, transform: [{ translateY: fx.wordsY }] }]}
        pointerEvents="none"
      >
        <Image source={WORDMARK_LIGHT} style={styles.name} resizeMode="contain" accessibilityRole="header" accessibilityLabel="OnlyTanker" />
        <Text style={styles.tagline}>{TAGLINE}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.brand900, zIndex: 1000, elevation: 1000 },
  center: { position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
  abs: { position: 'absolute' },
  // The inner layer sits at the outer layer's origin (both are zero-size anchors at the mark's centre).
  origin: { left: 0, top: 0 },
  // Many faint discs stack into a smooth radial falloff (no gradient library needed).
  glow: { position: 'absolute', backgroundColor: colors.brand500, opacity: 0.035 },
  // The pin's head is a circle PIN_W across, touching the top of the pin.
  headMask: { width: PIN_W, height: PIN_W, top: -PIN_H / 2, left: -PIN_W / 2, borderRadius: PIN_W / 2, overflow: 'hidden' },
  sheen: { position: 'absolute', top: -PIN_W * 0.4, left: PIN_W / 2 - 16, width: 32, height: PIN_W * 1.8, backgroundColor: colors.white },
  // Below the settled pin.
  words: { position: 'absolute', left: 0, right: 0, top: '50%', marginTop: LIFT + (PIN_H / 2) * SETTLED_SCALE + 26, alignItems: 'center' },
  name: { height: WORD_H, width: WORD_H * WORDMARK_RATIO },
  tagline: { marginTop: 8, color: colors.brand100, fontSize: 15, letterSpacing: 0.4 },
});

/** Memoised: the root gate re-renders often, but the splash only needs to know when `ready` changes. */
export const AnimatedSplash = memo(AnimatedSplashImpl);
