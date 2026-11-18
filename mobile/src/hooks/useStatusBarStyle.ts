import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StatusBar } from 'react-native';

/**
 * Sets the status bar icon colour while this screen is focused (light icons for dark headers).
 * Pushes onto React Native's status-bar stack so it wins over the app-wide <StatusBar style="dark" />
 * in RootNavigator, and pops on blur so tab screens that stay mounted restore the default.
 */
export function useStatusBarStyle(style: 'light' | 'dark') {
  useFocusEffect(
    useCallback(() => {
      const entry = StatusBar.pushStackEntry({ barStyle: style === 'light' ? 'light-content' : 'dark-content', animated: true });
      return () => StatusBar.popStackEntry(entry);
    }, [style]),
  );
}
