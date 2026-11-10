import type { IconName } from '@/types';

/**
 * Route paths and parameters in one place. Expo Router builds the actual routes from the files in
 * `app/`; these constants mirror them so screens do not hand-type paths. Deep links use the `ttms://`
 * scheme with the same paths (app.json → expo.scheme).
 */
export const ROUTES = {
  launch: '/',
  welcome: '/welcome',
  login: '/login',
  forgotPassword: '/forgot-password',
  verifyOtp: '/verify-otp',
  signup: '/signup',
  signupAgency: '/signup/agency',
  signupDriver: '/signup/driver',
  profile: '/profile',
  notifications: '/notifications',
  pendingVerification: '/pending-verification',
  company: {
    home: '/company',
    bookings: '/company/bookings',
    offers: '/company/offers',
    trips: '/company/trips',
    account: '/company/account',
    newBooking: '/company/new-booking',
    booking: (id: string) => `/company/booking/${id}` as const,
    trip: (id: string) => `/company/trip/${id}` as const,
  },
  transporter: {
    home: '/transporter',
    market: '/transporter/market',
    offers: '/transporter/offers',
    trips: '/transporter/trips',
    account: '/transporter/account',
    marketBooking: (id: string) => `/transporter/market/${id}` as const,
    offer: (id: string) => `/transporter/offer/${id}` as const,
    trip: (id: string) => `/transporter/trip/${id}` as const,
  },
  driver: {
    home: '/driver',
    trips: '/driver/trips',
    account: '/driver/account',
    trip: (id: string) => `/driver/trip/${id}` as const,
  },
} as const;

/** Route parameters of the dynamic screens (`useLocalSearchParams<RouteParams['…']>()`). */
export type RouteParams = {
  detail: { id: string };
  verifyOtp: { phone: string; cooldown?: string };
};

export type TabDef = { name: string; title: string; icon: IconName };

export const COMPANY_TABS: readonly TabDef[] = [
  { name: 'index', title: 'Home', icon: 'home-outline' },
  { name: 'bookings', title: 'Bookings', icon: 'document-text-outline' },
  { name: 'offers', title: 'Offers', icon: 'pricetags-outline' },
  { name: 'trips', title: 'Trips', icon: 'navigate-outline' },
  { name: 'account', title: 'Account', icon: 'person-outline' },
];

export const TRANSPORTER_TABS: readonly TabDef[] = [
  { name: 'index', title: 'Home', icon: 'home-outline' },
  { name: 'market', title: 'Bookings', icon: 'search-outline' },
  { name: 'offers', title: 'Offers', icon: 'pricetags-outline' },
  { name: 'trips', title: 'Trips', icon: 'navigate-outline' },
  { name: 'account', title: 'Account', icon: 'person-outline' },
];

export const DRIVER_TABS: readonly TabDef[] = [
  { name: 'index', title: 'Current trip', icon: 'navigate-outline' },
  { name: 'trips', title: 'My trips', icon: 'list-outline' },
  { name: 'account', title: 'Profile', icon: 'person-outline' },
];
