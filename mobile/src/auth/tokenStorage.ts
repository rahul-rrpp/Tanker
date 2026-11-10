import * as SecureStore from 'expo-secure-store';

/**
 * Refresh-token persistence in the platform keystore (iOS Keychain / Android Keystore).
 * Tokens are never written to AsyncStorage. The access token lives only in memory.
 */
const REFRESH_KEY = 'ttms.refreshToken';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const tokenStorage = {
  getRefreshToken: () => SecureStore.getItemAsync(REFRESH_KEY, OPTIONS),
  setRefreshToken: (token: string) => SecureStore.setItemAsync(REFRESH_KEY, token, OPTIONS),
  clear: () => SecureStore.deleteItemAsync(REFRESH_KEY, OPTIONS),
};

let accessToken: string | null = null;
export const accessTokenStore = {
  get: () => accessToken,
  set: (token: string | null) => {
    accessToken = token;
  },
};
