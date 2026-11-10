import type { NotificationChannel, NotificationType } from '@prisma/client';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { emitToUser } from '../../lib/realtime';

/**
 * In-app notifications plus a pluggable outbound-channel architecture.
 *
 * Every event is stored in `notifications` (in-app). For each additional channel the user has enabled,
 * the matching ChannelAdapter is invoked and the attempt is recorded in `notification_deliveries`.
 * SMS / WhatsApp / email adapters are not connected in Phase 1: they record a SKIPPED delivery so the
 * pipeline is exercised end-to-end and real providers (e.g. MSG91 / Gupshup / Meta Cloud API) can be
 * dropped in later without touching business code.
 */

export const NOTIFICATION_CATEGORIES = {
  account: ['REGISTRATION_SUCCESSFUL', 'COMPANY_VERIFICATION_UPDATE'],
  bookings: ['BOOKING_CREATED', 'BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'NEW_BOOKING_AVAILABLE', 'BOOKING_EXPIRING'],
  offers: ['OFFER_RECEIVED', 'COUNTER_OFFER_RECEIVED', 'COUNTER_OFFER_ACCEPTED', 'OFFER_EXPIRED', 'OFFER_ACCEPTED', 'OFFER_SUBMITTED', 'OFFER_REJECTED'],
  trips: ['VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'LOADING_STARTED', 'TRIP_STARTED', 'LOADING_COMPLETED', 'DELIVERY_COMPLETED', 'TRIP_ASSIGNED', 'TRIP_COMPLETED'],
  payments: ['PAYMENT_RECEIVED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'SETTLEMENT_PROCESSED'],
  support: ['SUPPORT_UPDATE'],
} as const satisfies Record<string, readonly NotificationType[]>;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;
export interface ChannelPrefs {
  inApp: boolean;
  sms: boolean;
  whatsapp: boolean;
  email: boolean;
}
export type NotificationPreferences = Record<NotificationCategory, ChannelPrefs>;

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  account: { inApp: true, sms: true, whatsapp: false, email: true },
  bookings: { inApp: true, sms: true, whatsapp: true, email: true },
  offers: { inApp: true, sms: false, whatsapp: true, email: false },
  trips: { inApp: true, sms: true, whatsapp: true, email: false },
  payments: { inApp: true, sms: true, whatsapp: false, email: true },
  support: { inApp: true, sms: false, whatsapp: false, email: true },
};

/** Account notices (registration, verification) are always delivered in-app. */
const MANDATORY_IN_APP: NotificationCategory[] = ['account'];

export function categoryOf(type: NotificationType): NotificationCategory {
  for (const [cat, types] of Object.entries(NOTIFICATION_CATEGORIES) as [NotificationCategory, readonly NotificationType[]][]) {
    if (types.includes(type)) return cat;
  }
  return 'account';
}

export function mergePreferences(stored: unknown): NotificationPreferences {
  const out = structuredClone(DEFAULT_PREFERENCES);
  if (stored && typeof stored === 'object') {
    for (const cat of Object.keys(out) as NotificationCategory[]) {
      const v = (stored as Record<string, Partial<ChannelPrefs>>)[cat];
      if (v && typeof v === 'object') {
        for (const ch of ['inApp', 'sms', 'whatsapp', 'email'] as const) if (typeof v[ch] === 'boolean') out[cat][ch] = v[ch]!;
      }
    }
  }
  for (const cat of MANDATORY_IN_APP) out[cat].inApp = true;
  return out;
}

// ---- Outbound channel adapters -----------------------------------------------------------

export interface OutboundMessage {
  userId: string;
  phone: string;
  email: string | null;
  title: string;
  message: string;
}

export interface ChannelAdapter {
  channel: Exclude<NotificationChannel, 'IN_APP'>;
  /** Returns a provider reference when sent; `null` when the channel is not configured. */
  send(msg: OutboundMessage): Promise<string | null>;
}

class NotConfiguredAdapter implements ChannelAdapter {
  constructor(readonly channel: Exclude<NotificationChannel, 'IN_APP'>) {}
  async send(): Promise<string | null> {
    return null;
  }
}

/** Replace entries with real adapters (MSG91 SMS, WhatsApp Business API, SMTP) when integrating. */
const adapters: ChannelAdapter[] = [new NotConfiguredAdapter('SMS'), new NotConfiguredAdapter('WHATSAPP'), new NotConfiguredAdapter('EMAIL')];

const PREF_KEY: Record<Exclude<NotificationChannel, 'IN_APP'>, keyof ChannelPrefs> = { SMS: 'sms', WHATSAPP: 'whatsapp', EMAIL: 'email' };

export interface NotifyInput {
  companyId: string;
  /** Defaults to every active member of the company. */
  userIds?: string[];
  type: NotificationType;
  title: string;
  message: string;
  bookingId?: string | null;
  link?: string | null;
}

/** Fan-out to company members. Failures are logged, never thrown, so business flows are not affected. */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const members = await prisma.companyMember.findMany({
      where: { companyId: input.companyId, isActive: true, ...(input.userIds ? { userId: { in: input.userIds } } : {}) },
      select: { user: { select: recipientSelect } },
    });
    await deliver(members.map((m) => m.user), input, input.link ?? (input.bookingId ? `/company/bookings/${input.bookingId}` : null), input.companyId);
  } catch (err) {
    logger.error({ err, type: input.type }, 'Failed to create notification');
  }
}

type PortalNotice = Omit<NotifyInput, 'companyId' | 'userIds'>;

/** Fan-out to every active member of a transporter. Never throws. */
export async function notifyTransporter(transporterId: string, input: PortalNotice): Promise<void> {
  try {
    const members = await prisma.agencyMember.findMany({ where: { agencyId: transporterId, status: 'ACTIVE', role: { not: 'DRIVER' } }, select: { user: { select: recipientSelect } } });
    await deliver(members.map((m) => m.user), input, input.link ?? null, null);
  } catch (err) {
    logger.error({ err, type: input.type }, 'Failed to create transporter notification');
  }
}

/** Notifies one user directly (employee workflows). Never throws. */
export async function notifyUser(userId: string, input: PortalNotice): Promise<void> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: recipientSelect });
    if (u) await deliver([u], input, input.link ?? null, null);
  } catch (err) {
    logger.error({ err, type: input.type }, 'Failed to create user notification');
  }
}

/** Notifies one driver. Never throws. */
export async function notifyDriver(driverId: string, input: PortalNotice): Promise<void> {
  try {
    const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { user: { select: recipientSelect } } });
    if (d) await deliver([d.user], input, input.link ?? null, null);
  } catch (err) {
    logger.error({ err, type: input.type }, 'Failed to create driver notification');
  }
}

const recipientSelect = { id: true, phone: true, email: true, notificationPreference: { select: { preferences: true } } } as const;
type Recipient = { id: string; phone: string; email: string | null; notificationPreference: { preferences: unknown } | null };

async function deliver(recipients: Recipient[], input: PortalNotice, link: string | null, companyId: string | null) {
    const category = categoryOf(input.type);
    for (const user of recipients) {
      const prefs = mergePreferences(user.notificationPreference?.preferences)[category];
      const notification = await prisma.notification.create({
        data: {
          userId: user.id,
          companyId,
          type: input.type,
          title: input.title.slice(0, 160),
          message: input.message.slice(0, 500),
          bookingId: input.bookingId ?? null,
          link,
          // Users who switched off in-app for a category still get the record (history) but pre-read.
          readAt: prefs.inApp ? null : new Date(),
        },
      });
      emitToUser(user.id, 'notification', { id: notification.id, type: input.type, title: notification.title });
      for (const adapter of adapters) {
        if (!prefs[PREF_KEY[adapter.channel]]) continue;
        let status: 'SENT' | 'SKIPPED' | 'FAILED' = 'SKIPPED';
        let providerRef: string | null = null;
        let error: string | null = null;
        try {
          providerRef = await adapter.send({ userId: user.id, phone: user.phone, email: user.email, title: input.title, message: input.message });
          status = providerRef ? 'SENT' : 'SKIPPED';
          if (!providerRef) error = 'Channel not configured (Phase 1)';
        } catch (e) {
          status = 'FAILED';
          error = (e as Error).message.slice(0, 300);
        }
        await prisma.notificationDelivery.create({ data: { notificationId: notification.id, channel: adapter.channel, status, providerRef, error } });
      }
    }
}
