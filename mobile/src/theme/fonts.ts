import { Archivo_600SemiBold, Archivo_700Bold, Archivo_800ExtraBold } from '@expo-google-fonts/archivo';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';

/**
 * Three faces, three jobs:
 *   display — Archivo, tight tracking: headings and big figures (signage feel)
 *   sans    — Inter: body text, labels, buttons
 *   mono    — JetBrains Mono: booking codes, number plates, km and amounts in tables
 * Custom fonts carry their weight in the family name, so styles set `fontFamily` and never `fontWeight`
 * (Android falls back to the system font when both are set).
 */
export const FONT_ASSETS = {
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
};

export const fonts = {
  display: 'Archivo_800ExtraBold',
  displayBold: 'Archivo_700Bold',
  displaySemi: 'Archivo_600SemiBold',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  mono: 'JetBrainsMono_500Medium',
  monoRegular: 'JetBrainsMono_400Regular',
  monoBold: 'JetBrainsMono_700Bold',
} as const;
