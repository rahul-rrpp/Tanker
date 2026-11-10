import * as Device from 'expo-device';

/** Backend base URL from EXPO_PUBLIC_API_URL (see .env.example). No secrets live in the app. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000').replace(/\/$/, '');
export const API_BASE_URL = `${API_URL}/api/v1`;

/** Web app URL from EXPO_PUBLIC_WEB_URL, used for registration links that run on the web. */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? 'http://10.0.2.2:3000').replace(/\/$/, '');

export const REQUEST_TIMEOUT_MS = 20_000;

export const deviceInfo = [Device.manufacturer, Device.modelName, Device.osName && `${Device.osName} ${Device.osVersion ?? ''}`.trim()]
  .filter(Boolean)
  .join(' · ')
  .slice(0, 200) || 'Mobile app';

/** Same backend and endpoints as the web app; `X-Client-Type: mobile` returns tokens in the body. */
export const CLIENT_HEADERS = { 'X-Client-Type': 'mobile', 'X-Device-Info': deviceInfo };
