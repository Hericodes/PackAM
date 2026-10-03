export function notificationOwnerWhere(userId: string) {
  return { userId } as const;
}

export function stableNotificationKey(event: string, resourceId: string) {
  return `${event}:${resourceId}`;
}
