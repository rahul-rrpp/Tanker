/**
 * "Manifest" palette. Warm paper, ink navy from the logo lettering, and the logo's orange used only as a
 * signal (the one primary action on a screen, live states). Status colours are muted so they read as
 * information, not decoration.
 *
 * The older token names (brand50…900, canvas, lineSoft…) are kept and remapped so every screen picks up
 * the new look; new code should prefer the semantic names at the top.
 */
const ink = '#0b1426';
const paper = '#f6f4ef';

export const colors = {
  // ---- Semantic ---------------------------------------------------------------------------------
  /** Page background: warm off-white, like manifest paper. */
  paper,
  /** Raised surfaces (sheets, inputs, the occasional card). */
  surface: '#ffffff',
  /** Primary text and the dark "ticket" surface. */
  ink,
  /** Secondary text. */
  muted: '#5b6474',
  /** Tertiary text: captions, placeholders, disabled. */
  faint: '#8a909b',
  /** Hairline rules between rows and around fields. */
  line: '#e2ded4',
  /** Even quieter rules (inside cards, skeleton bones). */
  lineSoft: '#ebe8e0',
  /** Signal orange (logo pin). One primary action per screen, live markers. */
  accent: '#fb6a0a',
  accentLight: '#fd8b2c',
  accentBg: '#fff1e6',
  /** Text and rules on the dark ink "ticket". */
  onInk: '#ffffff',
  onInkMuted: '#a9b1c0',
  inkLine: '#24304a',

  success: '#1f7a4d',
  successBg: '#e9f3ed',
  warning: '#a8670f',
  warningBg: '#faf1df',
  danger: '#b4372b',
  dangerBg: '#f9eae8',

  // ---- Compatibility names (remapped) -------------------------------------------------------------
  brand50: '#eef0f4',
  brand100: '#d9dee8',
  brand500: '#3a5687',
  brand600: '#1e3a68', // links, focus rings
  brand700: '#13284d',
  brand900: ink,
  canvas: paper,
  white: '#ffffff',
  brandTint: '#e4e8f0',
  placeholder: '#9aa0aa',
  neutralBg: '#eeebe4',
  backdrop: 'rgba(11,20,38,0.45)',
};
