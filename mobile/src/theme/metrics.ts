/** Corner radii, spacing scale and type sizes used across the app. */
export const radius = { field: 10, card: 16, sheet: 20, pill: 999 };

/** 4-point spacing scale: space(4) === 16. */
export const space = (n: number) => n * 4;

export const typography = {
  screenTitle: { fontSize: 26, fontWeight: '700' as const, letterSpacing: -0.3 },
  pageTitle: { fontSize: 24, fontWeight: '700' as const },
  sheetTitle: { fontSize: 18, fontWeight: '700' as const },
  section: { fontSize: 16, fontWeight: '700' as const },
  body: { fontSize: 15 },
  label: { fontSize: 14, fontWeight: '600' as const },
  caption: { fontSize: 13 },
  small: { fontSize: 12 },
};
