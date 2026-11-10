/**
 * Every backend path the app calls, in one place. Paths are relative to API_BASE_URL (/api/v1).
 * Builders produce exactly the query strings the screens used before the refactor.
 */
const enc = encodeURIComponent;

export const ENDPOINTS = {
  auth: {
    login: '/auth/login',
    loginOtpSend: '/auth/login/otp/send',
    loginOtpVerify: '/auth/login/otp/verify',
    otpSend: '/auth/otp/send',
    otpVerify: '/auth/otp/verify',
    refresh: '/auth/refresh',
    me: '/auth/me',
    logout: '/auth/logout',
    logoutAll: '/auth/logout-all',
    forgotPassword: '/auth/forgot-password',
    resetPassword: '/auth/reset-password',
    registerAgency: '/auth/register/agency',
    registerDriver: '/auth/register/driver',
    sessions: '/auth/sessions',
    session: (id: string) => `/auth/sessions/${id}`,
  },
  notifications: {
    list: '/notifications?pageSize=50',
    readAll: '/notifications/read-all',
    read: (id: string) => `/notifications/${id}/read`,
  },
  maps: {
    places: (query: string) => `/maps/places?q=${enc(query)}`,
    placeDetails: (placeId: string) => `/maps/places/details?placeId=${enc(placeId)}`,
  },
  catalog: '/catalog',
  company: {
    dashboard: '/companies/dashboard',
    bookings: (tab: string) => `/bookings?tab=${tab}&pageSize=50`,
    booking: (id: string) => `/bookings/${id}`,
    bookingOffers: (id: string) => `/bookings/${id}/offers`,
    cancelBooking: (id: string) => `/bookings/${id}/cancel`,
    quote: '/bookings/quote',
    createBooking: '/bookings',
    offers: (status: string) => `/offers?status=${status}`,
    trips: (scope: string) => `/trips?scope=${scope}`,
  },
  offers: {
    detail: (id: string) => `/offers/${id}`,
    accept: (id: string) => `/offers/${id}/accept`,
    counter: (id: string) => `/offers/${id}/counter`,
    reject: (id: string) => `/offers/${id}/reject`,
    withdraw: (id: string) => `/offers/${id}/withdraw`,
  },
  trips: {
    detail: (id: string) => `/trips/${id}`,
    tracking: (id: string) => `/trips/${id}/tracking`,
    history: (id: string) => `/trips/${id}/history`,
    complete: (id: string) => `/trips/${id}/complete`,
    issue: (id: string) => `/trips/${id}/issue`,
  },
  transporter: {
    dashboard: '/transporters/dashboard',
    marketplace: '/marketplace/bookings?pageSize=50',
    marketBooking: (id: string) => `/marketplace/bookings/${id}`,
    submitOffer: (bookingId: string) => `/bookings/${bookingId}/offers`,
    offers: (tab: string) => `/transporters/me/offers?tab=${tab}&pageSize=50`,
    confirmedBookings: '/transporters/me/bookings?pageSize=50',
    trips: (scope: string) => `/transporters/me/trips?scope=${scope}&pageSize=50`,
    tankers: '/tankers?pageSize=100',
    drivers: '/transporters/me/drivers?pageSize=100',
    assign: (bookingId: string, kind: string) => `/bookings/${bookingId}/assign-${kind}`,
  },
  driver: {
    me: '/driver/me',
    trips: (scope: string) => `/driver/me/trips?scope=${scope}`,
    trip: (id: string) => `/driver/me/trips/${id}`,
    tripStatus: (id: string) => `/driver/me/trips/${id}/status`,
    tripDocuments: (id: string) => `/driver/me/trips/${id}/documents`,
    tripEmergency: (id: string) => `/driver/me/trips/${id}/emergency`,
    tripLocation: (id: string) => `/driver/me/trips/${id}/location`,
  },
} as const;
