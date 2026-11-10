import { api, deviceInfo, ENDPOINTS } from '@/services/api';
import type { AuthUser, MobileAuthData } from '@/types';

/**
 * Auth API calls. Each returns the axios response unchanged, so callers keep reading `data.data`
 * exactly as before. `deviceInfo` is added where the screens sent it.
 */
export const authService = {
  login: (values: { identifier: string; password: string }) => api.post<{ data: MobileAuthData }>(ENDPOINTS.auth.login, { ...values, deviceInfo }),
  sendLoginCode: (phone: string) => api.post(ENDPOINTS.auth.loginOtpSend, { phone }),
  verifyLoginCode: (phone: string, code: string) => api.post<{ data: MobileAuthData }>(ENDPOINTS.auth.loginOtpVerify, { phone, code, deviceInfo }),

  sendRegistrationCode: (phone: string) => api.post(ENDPOINTS.auth.otpSend, { channel: 'SMS', destination: phone, purpose: 'REGISTRATION' }),
  verifyRegistrationCode: (phone: string, code: string) => api.post(ENDPOINTS.auth.otpVerify, { channel: 'SMS', destination: phone, purpose: 'REGISTRATION', code }),
  register: (endpoint: string, payload: Record<string, unknown>) => api.post<{ data: MobileAuthData }>(endpoint, { ...payload, deviceInfo }),

  forgotPassword: (identifier: string) => api.post(ENDPOINTS.auth.forgotPassword, { identifier }),
  resetPassword: (body: { identifier: string; code: string; password: string; confirmPassword: string }) => api.post(ENDPOINTS.auth.resetPassword, body),

  me: () => api.get<{ data: { user: AuthUser } }>(ENDPOINTS.auth.me),
  logout: (refreshToken?: string) => api.post(ENDPOINTS.auth.logout, { refreshToken }),
  logoutAll: () => api.post(ENDPOINTS.auth.logoutAll),

  sessions: () => api.get(ENDPOINTS.auth.sessions),
  revokeSession: (id: string) => api.delete(ENDPOINTS.auth.session(id)),
};
