import { api, ENDPOINTS } from '@/services/api';

/** Notification type as returned by the backend (only the caller's own notifications). */
export type AppNotification = { id: string; title: string; message: string; createdAt: string; readAt: string | null };

export const notificationsService = {
  markAllRead: () => api.put(ENDPOINTS.notifications.readAll),
};

/** Marks one notification read; best effort, never throws. */
export async function markRead(id: string) {
  try {
    await api.put(ENDPOINTS.notifications.read(id));
  } catch {
    /* best effort */
  }
}
