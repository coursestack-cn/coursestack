export const notificationUpdates = $state({ revision: 0, viewer: "", unreadCount: 0 });
let countRequest = 0;
export function beginNotificationCount() { return ++countRequest; }
export function publishNotificationCount(viewer: string, unreadCount: number, request = beginNotificationCount()) {
    if (request !== countRequest) return;
    notificationUpdates.viewer = viewer;
    notificationUpdates.unreadCount = unreadCount;
}
export function refreshNotifications() { notificationUpdates.revision++; }