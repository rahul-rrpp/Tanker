import { StyleSheet } from 'react-native';
import { colors } from './colors';
import { radius, typography } from './metrics';

/**
 * Shared style sheets. `formStyles` serves the auth/form screens (full-screen layout, fields, buttons);
 * `pageStyles` serves the signed-in role apps (pages, cards, rows, chips, bottom sheets).
 */
export const formStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 20, paddingBottom: 32 },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
  title: { ...typography.screenTitle, color: colors.ink },
  subtitle: { marginTop: 6, fontSize: 15, lineHeight: 22, color: colors.muted },
  button: { height: 50, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  label: { ...typography.label, color: colors.ink, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.field,
    backgroundColor: colors.white,
  },
  inputFocused: { borderColor: colors.brand500, borderWidth: 2 },
  inputError: { borderColor: colors.danger },
  prefix: { paddingHorizontal: 12, color: colors.muted, fontSize: 16, borderRightWidth: 1, borderRightColor: colors.line, lineHeight: 48 },
  input: { flex: 1, height: '100%', paddingHorizontal: 14, fontSize: 16, color: colors.ink },
  error: { marginTop: 6, fontSize: 13, color: colors.danger, fontWeight: '500' },
  hint: { marginTop: 6, fontSize: 13, color: colors.muted },
  eye: { position: 'absolute', right: 14, top: 40 },
  banner: { borderRadius: radius.field, padding: 12, marginBottom: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  chipSelected: { borderColor: colors.brand500, backgroundColor: colors.brand50 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, padding: 16 },
});

export const pageStyles = StyleSheet.create({
  title: { ...typography.pageTitle, color: colors.ink },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  rowLabel: { color: colors.muted, fontSize: 13 },
  rowValue: { color: colors.ink, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  pill: { alignSelf: 'flex-start', overflow: 'hidden', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, fontSize: 12, fontWeight: '600' },
  stat: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 2 },
  statValue: { fontSize: 20, fontWeight: '700', color: colors.ink },
  statLabel: { fontSize: 12, color: colors.muted },
  section: { ...typography.section, color: colors.ink, marginTop: 8 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
  chip: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  chipText: { color: colors.ink, fontWeight: '600', fontSize: 13 },
  sheetBackdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: 20, gap: 8 },
  sheetTitle: { ...typography.sheetTitle, color: colors.ink, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.field, padding: 12, fontSize: 16, color: colors.ink, minHeight: 48 },
  pickRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
});
