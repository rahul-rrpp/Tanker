import { api, ENDPOINTS } from '@/services/api';

/** Transporter app writes. Reads go through `useQuery(ENDPOINTS.transporter.…)`. */
export const transporterService = {
  submitOffer: (bookingId: string, body: object) => api.post(ENDPOINTS.transporter.submitOffer(bookingId), body),
  assign: (bookingId: string, kind: string, body: object) => api.post(ENDPOINTS.transporter.assign(bookingId, kind), body),
};
