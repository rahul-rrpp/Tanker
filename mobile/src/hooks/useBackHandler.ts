import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { BackHandler } from 'react-native';

/**
 * Android hardware back button. Return true from the handler to consume the event.
 * Active only while the screen is focused.
 */
export function useBackHandler(handler: () => boolean) {
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', handler);
      return () => sub.remove();
    }, [handler]),
  );
}

/** On root screens of the signed-in area, back exits the app instead of returning to auth screens. */
export function useExitOnBack() {
  useBackHandler(
    useCallback(() => {
      BackHandler.exitApp();
      return true;
    }, []),
  );
}
