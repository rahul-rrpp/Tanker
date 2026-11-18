import { Platform, type ViewStyle } from 'react-native';
import { colors } from './colors';

/**
 * Manifest uses hairlines, not drop shadows, for structure. Elevation is kept only for things that
 * genuinely float above the page: bottom sheets, the tab bar, the sticky action bar.
 */
const make = (y: number, blur: number, opacity: number, elevation: number): ViewStyle =>
  Platform.select<ViewStyle>({
    ios: { shadowColor: colors.ink, shadowOffset: { width: 0, height: y }, shadowRadius: blur, shadowOpacity: opacity },
    default: { elevation, shadowColor: colors.ink },
  }) ?? {};

export const shadows = {
  /** Cards sit flat on the paper; their border does the work. */
  card: {} as ViewStyle,
  /** Floating surfaces: bottom sheets, the tab bar, sticky action bars. */
  raised: make(-2, 16, 0.08, 10),
  /** Buttons are flat. */
  button: {} as ViewStyle,
};
