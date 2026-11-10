import { api, ENDPOINTS, upload, type PickedFile } from '@/services/api';

/** Driver app writes. Reads go through `useQuery(ENDPOINTS.driver.…)`. */
export const driverService = {
  updateStatus: (tripId: string, body: object) => api.post(ENDPOINTS.driver.tripStatus(tripId), body),
  emergency: (tripId: string, body: object) => api.post(ENDPOINTS.driver.tripEmergency(tripId), body),
  uploadDocument: (tripId: string, type: string, file: PickedFile) => upload(ENDPOINTS.driver.tripDocuments(tripId), { type }, file),
  sendLocations: (tripId: string, points: object[]) => api.post(ENDPOINTS.driver.tripLocation(tripId), { points }),
};
