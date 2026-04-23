/**
 * Lightweight notifications for the open PWA — fires the browser Notification
 * API when the tab/app is in the background (or screen is off on iOS PWA
 * home-screen install). For *server-initiated* push (closed app), see
 * `docs/PUSH.md` (future work — needs VAPID keys + server endpoint).
 */

let permissionAsked = false;

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export async function ensureNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  if (permissionAsked) return Notification.permission;
  permissionAsked = true;
  return Notification.requestPermission();
}

export function notify(title: string, body?: string): void {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  // Only show when the page isn't visible — otherwise the in-app sound/vibration is enough.
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
  try {
    new Notification(title, {
      body,
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      tag: 'home-pot-blind-up',
    });
  } catch { /* noop */ }
}
