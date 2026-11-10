import { api, ENDPOINTS } from '@/services/api';

/** Trip actions shared by the transporter app (the company app only reads trips). */
export const tripsService = {
  complete: (id: string) => api.post(ENDPOINTS.trips.complete(id), {}),
  reportIssue: (id: string, type: string | null, message: string) => api.post(ENDPOINTS.trips.issue(id), { type, message }),
};
