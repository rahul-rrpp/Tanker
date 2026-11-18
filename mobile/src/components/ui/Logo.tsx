import { Image, View } from 'react-native';

/**
 * OnlyTanker brand artwork (src/assets/images), generated from brand/onlytanker-logo.png by
 * brand/build-brand-assets.py.
 */
/** The orange location pin with the tanker. The pin fills 96% of the image height and 77% of its width. */
export const LOGO_MARK = require('@/assets/images/logo-mark.png') as number;
/** "OnlyTanker" lettering: navy for light backgrounds, white for dark ones. */
export const WORDMARK = require('@/assets/images/wordmark.png') as number;
export const WORDMARK_LIGHT = require('@/assets/images/wordmark-light.png') as number;
/** Width ÷ height of the wordmark images. */
export const WORDMARK_RATIO = 1036 / 198;

/** Pin above the "OnlyTanker" wordmark. `size` is the pin height in dp. */
export function Logo({ inverted, size = 48 }: { inverted?: boolean; size?: number }) {
  const wordHeight = Math.max(28, size * 0.5);
  return (
    <View style={{ alignItems: 'center' }} accessibilityRole="image" accessibilityLabel="OnlyTanker logo">
      <Image source={LOGO_MARK} style={{ width: size, height: size }} resizeMode="contain" />
      <Image
        source={inverted ? WORDMARK_LIGHT : WORDMARK}
        style={{ marginTop: 14, height: wordHeight, width: wordHeight * WORDMARK_RATIO }}
        resizeMode="contain"
      />
    </View>
  );
}
