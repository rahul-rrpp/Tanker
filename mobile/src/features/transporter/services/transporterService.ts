import { api, ENDPOINTS } from '@/services/api';

/** Transporter app writes. Reads go through `useQuery(ENDPOINTS.transporter.…)`. */
export const transporterService = {
  submitOffer: (bookingId: string, body: object) => api.post(ENDPOINTS.transporter.submitOffer(bookingId), body),
  createDriver: (body: object) => api.post(ENDPOINTS.transporter.createDriver, body),
  inviteDriver: (id: string) => api.post(ENDPOINTS.transporter.inviteDriver(id)),
  assign: (bookingId: string, kind: string, body: object) => api.post(ENDPOINTS.transporter.assign(bookingId, kind), body),
};
