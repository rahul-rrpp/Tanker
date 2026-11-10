export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export const BOOKING_STATUS: Record<string, { label: string; tone: Tone }> = {
  SEARCHING: { label: 'Searching', tone: 'warning' },
  OFFERS_RECEIVED: { label: 'Offers received', tone: 'warning' },
  NEGOTIATION: { label: 'Negotiation', tone: 'warning' },
  CONFIRMED: { label: 'Confirmed', tone: 'info' },
  VEHICLE_ASSIGNED: { label: 'Vehicle assigned', tone: 'info' },
  DRIVER_ASSIGNED: { label: 'Driver assigned', tone: 'info' },
  LOADING: { label: 'Loading', tone: 'info' },
  IN_TRANSIT: { label: 'In transit', tone: 'info' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  DISPUTED: { label: 'Disputed', tone: 'danger' },
};

/** Order used by the progress timeline. */
export const BOOKING_FLOW = ['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION', 'CONFIRMED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];

export const OFFER_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Awaiting your decision', tone: 'warning' },
  COUNTERED: { label: 'Awaiting transporter', tone: 'info' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
  UNSUCCESSFUL: { label: 'Closed', tone: 'neutral' },
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pending', tone: 'warning' },
  ADVANCE_PAID: { label: 'Advance paid', tone: 'info' },
  PARTIALLY_PAID: { label: 'Partially paid', tone: 'info' },
  PAID: { label: 'Paid', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  REFUND_PENDING: { label: 'Refund pending', tone: 'warning' },
  REFUNDED: { label: 'Refunded', tone: 'neutral' },
  CREATED: { label: 'Awaiting payment', tone: 'warning' },
};

export const TRIP_STATUS: Record<string, { label: string; tone: Tone }> = {
  SCHEDULED: { label: 'Scheduled', tone: 'neutral' },
  VEHICLE_ASSIGNED: { label: 'Vehicle assigned', tone: 'info' },
  DRIVER_ASSIGNED: { label: 'Driver assigned', tone: 'info' },
  DRIVER_ACCEPTED: { label: 'Driver accepted', tone: 'info' },
  REACHED_PICKUP: { label: 'Reached pickup', tone: 'info' },
  LOADING: { label: 'Loading', tone: 'info' },
  LOADING_COMPLETED: { label: 'Loading completed', tone: 'info' },
  IN_TRANSIT: { label: 'In transit', tone: 'info' },
  REACHED_DESTINATION: { label: 'Reached destination', tone: 'info' },
  UNLOADING_STARTED: { label: 'Unloading', tone: 'info' },
  UNLOADING_COMPLETED: { label: 'Unloading completed', tone: 'info' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  DISPUTED: { label: 'Disputed', tone: 'danger' },
};

export const TICKET_STATUS: Record<string, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'warning' },
  ASSIGNED: { label: 'Assigned', tone: 'info' },
  UNDER_INVESTIGATION: { label: 'Under investigation', tone: 'info' },
  AWAITING_RESPONSE: { label: 'Awaiting your response', tone: 'warning' },
  UNDER_REVIEW: { label: 'Under review', tone: 'info' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

export const COMPANY_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING_VERIFICATION: { label: 'Pending verification', tone: 'warning' },
  VERIFIED: { label: 'Verified', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  SUSPENDED: { label: 'Suspended', tone: 'danger' },
};

export const TICKET_CATEGORIES: Record<string, string> = {
  TRANSPORTER_ISSUE: 'Transporter issue',
  DRIVER_ISSUE: 'Driver issue',
  VEHICLE_DELAY: 'Vehicle delay',
  FREIGHT_DISPUTE: 'Freight dispute',
  LOADING_PROBLEM: 'Loading problem',
  DELIVERY_PROBLEM: 'Delivery problem',
  PAYMENT_PROBLEM: 'Payment problem',
  OTHER: 'Other',
};

export const PAYMENT_METHODS: Record<string, string> = {
  UPI: 'UPI',
  NETBANKING: 'Net Banking',
  DEBIT_CARD: 'Debit card',
  CREDIT_CARD: 'Credit card',
  CARD: 'Card',
  OTHER: 'Other',
};

export const LOCATION_TYPES: Record<string, string> = {
  FACTORY: 'Factory',
  OIL_DEPOT: 'Oil depot',
  WAREHOUSE: 'Warehouse',
  REFINERY: 'Refinery',
  PETROL_PUMP: 'Petrol pump',
  DELIVERY_POINT: 'Delivery point',
  OTHER: 'Other',
};

export const BUSINESS_TYPES: Record<string, string> = {
  MANUFACTURER: 'Manufacturer',
  TRADER: 'Trader',
  DISTRIBUTOR: 'Distributor',
  OIL_MARKETING_COMPANY: 'Oil marketing company',
  REFINERY: 'Refinery',
  PETROL_PUMP_DEALER: 'Petrol pump dealer',
  INDUSTRIAL_CONSUMER: 'Industrial consumer',
  LOGISTICS_PROVIDER: 'Logistics provider',
  OTHER: 'Other',
};

export const DOC_TYPES: Record<string, string> = {
  BOOKING_CONFIRMATION: 'Booking confirmation',
  BOOKING_SUMMARY: 'Booking summary',
  FREIGHT_INVOICE: 'Freight invoice',
  PAYMENT_RECEIPT: 'Payment receipt',
  TRIP_DOCUMENT: 'Transport document',
};

export const COMPANY_DOC_TYPES: Record<string, string> = {
  GST_CERTIFICATE: 'GST certificate',
  PAN_CARD: 'PAN card',
  REGISTRATION_CERTIFICATE: 'Company registration certificate',
  OTHER: 'Other supporting document',
};

export const PRODUCT_COMPATIBILITY: Record<string, string> = {
  ANY_COMPATIBLE: 'Any tanker certified for this product',
  DEDICATED: 'Dedicated tanker (this product only)',
  CLEANED_CERTIFIED: 'Tank cleaning certificate required',
};

export const COMPARTMENTS: Record<string, string> = { ANY: 'No preference', SINGLE: 'Single compartment', MULTI: 'Multi-compartment (2+)' };

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];
