import { api, ENDPOINTS } from '@/services/api';

/**
 * Offer negotiation, used by both companies and transporters (the backend decides who may do what).
 * `body` is passed through untouched so each caller sends exactly what it sent before.
 */
export const offersService = {
  accept: (id: string, body?: object) => api.post(ENDPOINTS.offers.accept(id), body),
  reject: (id: string, body?: object) => api.post(ENDPOINTS.offers.reject(id), body),
  withdraw: (id: string, body?: object) => api.post(ENDPOINTS.offers.withdraw(id), body),
  counter: (id: string, amount: number) => api.post(ENDPOINTS.offers.counter(id), { amount }),
};
