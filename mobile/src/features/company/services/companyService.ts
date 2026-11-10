import { api, ENDPOINTS } from '@/services/api';

/** Company app writes and place search. Reads go through `useQuery(ENDPOINTS.company.…)`. */
export const companyService = {
  searchPlaces: (query: string) => api.get(ENDPOINTS.maps.places(query)),
  placeDetails: (placeId: string) => api.get(ENDPOINTS.maps.placeDetails(placeId)),
  quote: (body: object) => api.post(ENDPOINTS.company.quote, body),
  createBooking: (body: object) => api.post(ENDPOINTS.company.createBooking, body),
  cancelBooking: (id: string, reason: string) => api.post(ENDPOINTS.company.cancelBooking(id), { reason }),
};
