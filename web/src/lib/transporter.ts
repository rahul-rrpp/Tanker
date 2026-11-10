'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from './api';
import type { Tone } from './status';

export const VERIFICATION: Record<string, { label: string; tone: Tone }> = {
  PENDING_VERIFICATION: { label: 'Pending', tone: 'warning' },
  UNDER_REVIEW: { label: 'Under review', tone: 'info' },
  APPROVED: { label: 'Verified', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  SUSPENDED: { label: 'Suspended', tone: 'danger' },
};
export const DOC_REVIEW: Record<string, { label: string; tone: Tone }> = { UPLOADED: { label: 'Awaiting review', tone: 'warning' }, VERIFIED: { label: 'Verified', tone: 'success' }, REJECTED: { label: 'Rejected', tone: 'danger' } };

/** Offer statuses as the TRANSPORTER reads them (the company portal's wording is the reverse). */
export const MY_OFFER_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Awaiting company', tone: 'warning' },
  COUNTERED: { label: 'Counter-offer received', tone: 'warning' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
  UNSUCCESSFUL: { label: 'Not selected', tone: 'neutral' },
};
export const TANKER_STATUS: Record<string, { label: string; tone: Tone }> = {
  AVAILABLE: { label: 'Available', tone: 'success' }, RESERVED: { label: 'Reserved', tone: 'info' }, BOOKED: { label: 'Booked', tone: 'info' }, LOADING: { label: 'Loading', tone: 'info' }, IN_TRANSIT: { label: 'In transit', tone: 'info' }, UNLOADING: { label: 'Unloading', tone: 'info' }, ON_TRIP: { label: 'On trip', tone: 'info' },
  MAINTENANCE: { label: 'Maintenance', tone: 'warning' }, UNAVAILABLE: { label: 'Unavailable', tone: 'neutral' }, SUSPENDED: { label: 'Suspended', tone: 'danger' }, INACTIVE: { label: 'Inactive', tone: 'neutral' },
};
export const SETTLEMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pending', tone: 'warning' }, PROCESSING: { label: 'Processing', tone: 'info' }, PARTIAL: { label: 'Partially settled', tone: 'info' }, SETTLED: { label: 'Settled', tone: 'success' }, FAILED: { label: 'Failed', tone: 'danger' }, ON_HOLD: { label: 'On hold until delivery', tone: 'neutral' },
};
export const ACCOUNT_STATUS: Record<string, { label: string; tone: Tone }> = { PENDING_VERIFICATION: { label: 'Login not activated', tone: 'warning' }, ACTIVE: { label: 'Login active', tone: 'success' }, SUSPENDED: { label: 'Suspended', tone: 'danger' }, DEACTIVATED: { label: 'Deactivated', tone: 'neutral' } };

export const TICKET_CATEGORY_OPTIONS: Record<string, string> = { BOOKING_ISSUE: 'Booking issue', FREIGHT_NEGOTIATION: 'Freight negotiation', COMPANY_DISPUTE: 'Company dispute', DRIVER_ISSUE: 'Driver issue', GPS_ISSUE: 'GPS issue', PAYMENT_PROBLEM: 'Payment issue', SETTLEMENT_ISSUE: 'Settlement issue', DOCUMENT_VERIFICATION: 'Document verification', TECHNICAL_SUPPORT: 'Technical support' };
export const TANKER_DOCS: Record<string, string> = { REGISTRATION_CERTIFICATE: 'Registration certificate', INSURANCE: 'Insurance', FITNESS_CERTIFICATE: 'Fitness certificate', PUC: 'PUC', PERMIT: 'Permit', PESO: 'PESO / petroleum documentation', OTHER: 'Other' };
export const DRIVER_DOCS: Record<string, string> = { DRIVING_LICENCE: 'Driving licence', IDENTITY_PROOF: 'Identity proof', ADDRESS_PROOF: 'Address proof', HAZMAT_TRAINING: 'Hazardous goods training certificate', OTHER: 'Other' };
export const BUSINESS_DOCS: Record<string, string> = { BUSINESS_REGISTRATION: 'Business registration', GST_CERTIFICATE: 'GST certificate', PAN_DOCUMENT: 'PAN document', TRANSPORT_PERMIT: 'Transport permit', OTHER: 'Other' };
export const TRIP_DOCS: Record<string, string> = { DELIVERY_PROOF: 'Delivery proof', LOADING_SLIP: 'Loading slip', LORRY_RECEIPT: 'Lorry receipt', E_WAY_BILL: 'E-way bill', OTHER: 'Other' };
export const DRIVER_ACTION_LABEL: Record<string, string> = { CONFIRM_ASSIGNMENT: 'Confirm assignment', REACHED_PICKUP: 'Reached pickup', START_LOADING: 'Start loading', COMPLETE_LOADING: 'Complete loading', START_TRIP: 'Start trip', REACHED_DELIVERY: 'Reached delivery', START_UNLOADING: 'Start unloading', COMPLETE_UNLOADING: 'Complete unloading', SUBMIT_COMPLETION: 'Submit trip completion' };

export const TRIP_FLOW = ['SCHEDULED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'REACHED_PICKUP', 'LOADING', 'LOADING_COMPLETED', 'IN_TRANSIT', 'REACHED_DESTINATION', 'UNLOADING_STARTED', 'UNLOADING_COMPLETED', 'DELIVERED', 'COMPLETED'];

/** One shared socket per tab; it re-authenticates with a fresh short-lived ticket on every (re)connect. */
let socket: Socket | null = null;
function getSocket(): Socket {
  socket ??= io(process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000', {
    path: '/realtime',
    auth: (cb) => {
      api.get<{ data: { ticket: string } }>('/realtime/ticket').then((r) => cb({ ticket: r.data.data.ticket })).catch(() => cb({}));
    },
  });
  return socket;
}

/** Calls the latest handler on each event. Realtime is an enhancement: pages also poll or refresh via SWR. */
export function useRealtime(events: string[], handler: (event: string, payload: unknown) => void, watchTripIds: string[] = []) {
  const latest = useRef(handler);
  latest.current = handler;
  const key = events.join('|');
  const tripKey = watchTripIds.join('|');
  useEffect(() => {
    const s = getSocket();
    const off = key.split('|').filter(Boolean).map((e) => {
      const fn = (payload: unknown) => latest.current(e, payload);
      s.on(e, fn);
      return () => s.off(e, fn);
    });
    const trips = tripKey.split('|').filter(Boolean);
    const watch = () => trips.forEach((id) => s.emit('trip:watch', id));
    if (s.connected) watch();
    s.on('connect', watch);
    return () => {
      off.forEach((f) => f());
      s.off('connect', watch);
      trips.forEach((id) => s.emit('trip:unwatch', id));
    };
  }, [key, tripKey]);
}

export type Paged<T> = { total: number; page: number; pageSize: number; items: T[] };
