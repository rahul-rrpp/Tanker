/** Shapes returned by the Company Portal API (money and coordinates arrive as numbers). */

export interface Place {
  placeId: string | null;
  address: string;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export interface LocationValue {
  address: string;
  placeId?: string;
  latitude: number;
  longitude: number;
  city?: string;
  state?: string;
  pincode?: string;
  savedLocationId?: string;
  label?: string;
}

export interface SavedLocation {
  id: string;
  name: string;
  type: string;
  contactPerson: string | null;
  contactPhone: string | null;
  address: string;
  placeId: string | null;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  pincode: string | null;
  isDefaultPickup: boolean;
  isDefaultDelivery: boolean;
}

export interface RouteOption {
  index: number;
  distanceKm: number;
  baseDurationMinutes: number;
  durationMinutes: number;
  polyline: string;
  summary: string;
}

export interface Catalog {
  products: { id: string; code: string; name: string; category: string; description: string | null; requiresSpecialApproval: boolean }[];
  tankerTypes: { id: string; code: string; name: string; description: string | null }[];
  capacities: number[];
  states: string[];
  settings: {
    offerMinPercentOfSuggested: number;
    offerMaxPercentOfSuggested: number;
    offerExpiryHours: number;
    maxTankersPerBooking: number;
    heavyVehicleEtaFactor: number;
    platformFeePercent: number;
    gstPercent: number;
    advancePercent: number;
  };
  demoMode: boolean;
  paymentProvider: 'mock' | 'razorpay';
  mapsProvider: string;
}

export interface Quote {
  provider: string;
  providerLabel: string;
  routes: RouteOption[];
  selectedRoute: RouteOption;
  estimate: {
    ruleName: string;
    ratePerKm: number;
    minimumFreight: number;
    perTankerFreight: number;
    distanceFreight: number;
    additionalChargePerTanker: number;
    additionalChargeLabel: string | null;
    suggestedFreight: number;
    offerMin: number;
    offerMax: number;
    disclaimer: string;
  };
}

export interface BookingLocation {
  id: string;
  type: 'PICKUP' | 'DELIVERY';
  address: string;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export interface Transporter {
  id: string;
  companyName: string;
  city: string;
  state: string;
  rating: number;
  completedTrips: number;
  verificationStatus: string;
  isDemo: boolean;
}

export interface NegotiationEntry {
  id: string;
  party: 'COMPANY' | 'TRANSPORTER' | 'SYSTEM';
  action: string;
  amount: number | null;
  message: string | null;
  createdAt: string;
  isDemo: boolean;
}

export interface Offer {
  id: string;
  bookingId: string;
  status: string;
  initialAmount: number;
  currentAmount: number;
  lastActionBy: string;
  round: number;
  tankersAvailable: number;
  tankerCapacityKl: number;
  estimatedAvailabilityAt: string;
  remarks: string | null;
  expiresAt: string;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  transporter: Transporter;
  history?: NegotiationEntry[];
  booking?: {
    id: string;
    bookingCode: string;
    status: string;
    customerOffer: number;
    suggestedFreight: number;
    isDemo?: boolean;
    product?: { name: string };
    locations?: { type: string; city: string | null; address: string }[];
    requirement?: { tankerCapacityKl: number; numberOfTankers: number };
    allocations?: { tankersAllocated: number }[];
  };
}

export interface BookingDetail {
  id: string;
  bookingCode: string;
  status: string;
  createdAt: string;
  isDemo: boolean;
  version: number;
  distanceKm: number;
  durationMinutes: number;
  routePolyline: string | null;
  routeSummary: string | null;
  routeProvider: string;
  ratePerKm: number;
  suggestedFreight: number;
  customerOffer: number;
  acceptedFreight: number | null;
  paymentStatus: string;
  loadingDate: string;
  loadingTime: string;
  loadingContactName: string;
  loadingContactPhone: string;
  loadingInstructions: string | null;
  expectedDeliveryDate: string;
  deliveryContactName: string;
  deliveryContactPhone: string;
  deliveryInstructions: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  offerExpiryHours: number;
  product: { id: string; code: string; name: string };
  pickup: BookingLocation | null;
  delivery: BookingLocation | null;
  requirement: {
    tankerCapacityKl: number;
    quantityKl: number;
    numberOfTankers: number;
    compartmentRequirement: string | null;
    productCompatibility: string;
    specialRequirements: string | null;
    tankerType: { id: string; name: string } | null;
  } | null;
  statusHistory: { id: string; fromStatus: string | null; toStatus: string; actorType: string; note: string | null; createdAt: string }[];
  allocations: { id: string; tankersAllocated: number; agreedFreight: number; status: string; transporter: Transporter }[];
  trips: {
    id: string;
    tripCode: string;
    allocationId: string;
    status: string;
    isSimulated: boolean;
    startedAt: string | null;
    deliveredAt: string | null;
    etaAt: string | null;
    tanker: { registrationNumber: string; capacityKl: number } | null;
    driver: { user: { fullName: string; phone: string } } | null;
  }[];
  invoices: { id: string; invoiceNumber: string; totalAmount: number; status: string; issuedAt: string }[];
  payments: { id: string; purpose: string; amount: number; status: string; receiptNumber: string | null; paidAt: string | null; createdAt: string; provider: string }[];
  offersCount: number;
  openOffersCount: number;
  bestOffer: number | null;
  tankersAllocated: number;
  canEdit: boolean;
  canCancel: boolean;
}

export interface BookingRow {
  id: string;
  bookingCode: string;
  createdAt: string;
  loadingDate: string;
  status: string;
  isDemo: boolean;
  product: string;
  pickup: { address: string; city: string | null; state: string | null } | null;
  delivery: { address: string; city: string | null; state: string | null } | null;
  tankerCapacityKl: number | null;
  numberOfTankers: number | null;
  quantityKl: number | null;
  tankersAllocated: number;
  distanceKm: number;
  customerOffer: number;
  suggestedFreight: number;
  acceptedFreight: number | null;
  bestOffer: number | null;
  offersCount: number;
  openOffersCount: number;
  canEdit: boolean;
  canCancel: boolean;
}

export interface Trip {
  id: string;
  tripCode: string;
  status: string;
  isSimulated: boolean;
  plannedDistanceKm: number;
  distanceTravelledKm: number;
  lastGpsAt: string | null;
  etaAt: string | null;
  startedAt: string | null;
  deliveredAt: string | null;
  trackingSource: 'SIMULATED' | 'GPS';
  booking: {
    id: string;
    bookingCode: string;
    status: string;
    distanceKm: number;
    durationMinutes: number;
    routePolyline: string | null;
    loadingDate: string;
    loadingTime: string;
    expectedDeliveryDate: string;
    isDemo: boolean;
    product: { name: string };
    requirement: { tankerCapacityKl: number } | null;
  };
  transporter: { id: string; companyName: string; rating: number; isDemo: boolean; contactPhone: string };
  tanker: { registrationNumber: string; capacityKl: number; compartments: number; tankerType: { name: string } } | null;
  driver: { id: string; isDemo: boolean; user: { fullName: string; phone: string } } | null;
  pickup: BookingLocation | null;
  delivery: BookingLocation | null;
}

export interface Tracking {
  tripId: string;
  tripCode: string;
  status: string;
  bookingId: string;
  bookingCode: string;
  plannedPolyline: string | null;
  pickup: BookingLocation | null;
  delivery: BookingLocation | null;
  currentPosition: { lat: number; lng: number; heading: number | null; speedKmph: number | null; recordedAt: string } | null;
  breadcrumb: { lat: number; lng: number; at: string }[];
  plannedDistanceKm: number;
  distanceTravelledKm: number;
  remainingDistanceKm: number;
  etaAt: string | null;
  lastGpsAt: string | null;
  dataSource: 'SIMULATED' | 'GPS' | 'NONE';
  dataSourceLabel: string;
}

export interface Payment {
  id: string;
  receiptNumber: string | null;
  bookingId: string;
  purpose: string;
  amount: number;
  status: string;
  provider: 'RAZORPAY' | 'MOCK';
  providerOrderId: string;
  providerPaymentId: string | null;
  method: string | null;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
  booking?: { id: string; bookingCode: string; isDemo: boolean };
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  bookingId: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
