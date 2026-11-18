import type { TextStyle } from 'react-native';
import { fonts } from './fonts';

/** Corner radii: restrained. Fields and buttons 10, cards 12, sheets 20. */
export const radius = { field: 10, card: 12, sheet: 20, pill: 999 };

/** 4-point spacing scale: space(4) === 16. */
export const space = (n: number) => n * 4;

/** Screen gutter and the vertical rhythm between sections. */
export const layout = { gutter: 20, section: 28, rowY: 14, touch: 48 };

const t = (s: TextStyle) => s;

/**
 * Type scale. Display sizes use Archivo with negative tracking; small caps-style eyebrows use Inter
 * with wide tracking; anything that is a code or a figure in a table uses JetBrains Mono.
 */
export const type = {
  display: t({ fontFamily: fonts.display, fontSize: 34, lineHeight: 38, letterSpacing: -1 }),
  title: t({ fontFamily: fonts.display, fontSize: 28, lineHeight: 32, letterSpacing: -0.8 }),
  heading: t({ fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 25, letterSpacing: -0.3 }),
  subheading: t({ fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 }),
  eyebrow: t({ fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 1.3, textTransform: 'uppercase' }),
  body: t({ fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 }),
  bodyStrong: t({ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 }),
  label: t({ fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 }),
  caption: t({ fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 }),
  button: t({ fontFamily: fonts.semibold, fontSize: 15, letterSpacing: 0.1 }),
  /** Codes, plates: TLB0000014, MH12 AB 1234. */
  code: t({ fontFamily: fonts.mono, fontSize: 12, lineHeight: 16, letterSpacing: 0.3 }),
  /** Table figures: ₹6,550 · 147 km. */
  figure: t({ fontFamily: fonts.mono, fontSize: 15, lineHeight: 20 }),
  /** Large figures (prices on a waybill, ETA). */
  bigFigure: t({ fontFamily: fonts.display, fontSize: 30, lineHeight: 34, letterSpacing: -0.6 }),
};

/** Legacy names used by older styles; mapped onto the new scale. */
export const typography = {
  screenTitle: type.title,
  pageTitle: type.title,
  sheetTitle: type.heading,
  section: type.eyebrow,
  body: type.body,
  label: { ...type.label, fontFamily: fonts.semibold },
  caption: type.caption,
  small: type.caption,
};
