import { StyleSheet } from 'react-native';
import { colors } from './colors';
import { fonts } from './fonts';
import { layout, radius, type } from './metrics';
import { shadows } from './shadows';

/**
 * Shared style sheets. `formStyles` serves the auth/form screens (full-screen layout, fields, buttons);
 * `pageStyles` serves the signed-in role apps (pages, rows, chips, bottom sheets).
 * Custom fonts carry their weight in `fontFamily`; never add `fontWeight` next to them.
 */
export const formStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: layout.gutter, paddingTop: 20, paddingBottom: 32 },
  footer: { paddingHorizontal: layout.gutter, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.paper },
  title: { ...type.title, color: colors.ink },
  subtitle: { ...type.body, marginTop: 8, color: colors.muted },
  button: { height: 52, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  buttonText: { ...type.button },
  label: { ...type.label, color: colors.ink, marginBottom: 8 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.field,
    backgroundColor: colors.surface,
  },
  inputFocused: { borderColor: colors.ink, borderWidth: 1.5 },
  inputError: { borderColor: colors.danger },
  prefix: { paddingHorizontal: 14, color: colors.muted, fontSize: 15, fontFamily: fonts.mono, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.line, lineHeight: 48 },
  input: { flex: 1, height: '100%', paddingHorizontal: 14, fontSize: 16, fontFamily: fonts.regular, color: colors.ink },
  error: { ...type.caption, marginTop: 6, color: colors.danger, fontFamily: fonts.medium },
  hint: { ...type.caption, marginTop: 6, color: colors.muted },
  eye: { position: 'absolute', right: 16, top: 45 },
  banner: { borderRadius: radius.field, padding: 14, marginBottom: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.field, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  chipSelected: { borderColor: colors.ink, backgroundColor: colors.ink },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: 16, ...shadows.card },
});

export const pageStyles = StyleSheet.create({
  title: { ...type.title, color: colors.ink },
  subtitle: { ...type.body, color: colors.muted, marginTop: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: 16, gap: 6, ...shadows.card },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  rowLabel: { ...type.label, color: colors.muted },
  rowValue: { ...type.label, fontFamily: fonts.semibold, color: colors.ink, flexShrink: 1, textAlign: 'right' },
  pill: { ...type.label, alignSelf: 'flex-start' },
  stat: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: 14, gap: 4 },
  statValue: { ...type.heading, color: colors.ink },
  statLabel: { ...type.caption, color: colors.muted },
  section: { ...type.eyebrow, color: colors.muted, marginTop: 12 },
  empty: { ...type.body, color: colors.muted, textAlign: 'center', marginTop: 24 },
  chip: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, borderRadius: radius.field, paddingHorizontal: 14, paddingVertical: 9 },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { ...type.label, color: colors.ink },
  sheetBackdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.paper, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: layout.gutter, paddingBottom: 24, paddingTop: 10, gap: 8, ...shadows.raised },
  sheetHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: 10 },
  sheetTitle: { ...type.heading, color: colors.ink, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, borderRadius: radius.field, padding: 14, fontSize: 16, fontFamily: fonts.regular, color: colors.ink, minHeight: 52 },
  pickRow: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
});
