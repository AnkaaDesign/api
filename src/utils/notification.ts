import type { Notification, SeenNotification } from '@types';
import {
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_ACTION_TYPE,
} from '@constants';
import {
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_IMPORTANCE_LABELS,
  NOTIFICATION_CHANNEL_LABELS,
} from '@constants';
import { dateUtils } from './date';
import type {
  NotificationType,
  NotificationImportance,
  NotificationChannel,
  NotificationActionType,
} from '@prisma/client';

/**
 * Map NOTIFICATION_TYPE enum to Prisma NotificationType enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapNotificationTypeToPrisma(type: NOTIFICATION_TYPE | string): NotificationType {
  return type as NotificationType;
}

/**
 * Map NOTIFICATION_IMPORTANCE enum to Prisma NotificationImportance enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapNotificationImportanceToPrisma(
  importance: NOTIFICATION_IMPORTANCE | string,
): NotificationImportance {
  return importance as NotificationImportance;
}

/**
 * Map NOTIFICATION_ACTION_TYPE enum to Prisma NotificationActionType enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapNotificationActionTypeToPrisma(
  actionType: NOTIFICATION_ACTION_TYPE | string,
): NotificationActionType {
  return actionType as NotificationActionType;
}

/**
 * Map NOTIFICATION_CHANNEL array to Prisma NotificationChannel enum array
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapNotificationChannelArrayToPrisma(
  channels: NOTIFICATION_CHANNEL[] | string[],
): NotificationChannel[] {
  return channels.map(channel => channel as NotificationChannel);
}

export function getNotificationTypeLabel(type: NOTIFICATION_TYPE): string {
  return NOTIFICATION_TYPE_LABELS[type] || type;
}

export function getNotificationImportanceLabel(importance: NOTIFICATION_IMPORTANCE): string {
  return NOTIFICATION_IMPORTANCE_LABELS[importance] || importance;
}

export function getNotificationChannelLabel(channel: NOTIFICATION_CHANNEL): string {
  return NOTIFICATION_CHANNEL_LABELS[channel] || channel;
}

/**
 * Get notification importance color
 */
export function getNotificationImportanceColor(importance: NOTIFICATION_IMPORTANCE): string {
  const colors: Record<NOTIFICATION_IMPORTANCE, string> = {
    [NOTIFICATION_IMPORTANCE.LOW]: 'gray',
    [NOTIFICATION_IMPORTANCE.NORMAL]: 'blue',
    [NOTIFICATION_IMPORTANCE.HIGH]: 'yellow',
    [NOTIFICATION_IMPORTANCE.URGENT]: 'red',
  };
  return colors[importance] || 'default';
}

/**
 * Check if notification is read by a specific user
 */
export function isNotificationReadByUser(notification: Notification, userId: string): boolean {
  if (!notification.seenBy) return false;
  return notification.seenBy.some(seen => seen.userId === userId);
}

/**
 * Check if notification is unread (not seen by anyone)
 */
export function isNotificationUnread(notification: Notification): boolean {
  return !notification.seenBy || notification.seenBy.length === 0;
}

/**
 * Check if notification is scheduled
 */
export function isNotificationScheduled(notification: Notification): boolean {
  return notification.scheduledAt !== null && notification.sentAt === null;
}

/**
 * Check if notification is sent
 */
export function isNotificationSent(notification: Notification): boolean {
  return notification.sentAt !== null;
}

/**
 * Check if notification is recent (within last 24 hours)
 */
export function isNotificationRecent(notification: Notification): boolean {
  const hoursAgo = dateUtils.getHoursAgo(notification.createdAt);
  return hoursAgo <= 24;
}

/**
 * Get notification status
 */
export function getNotificationStatus(notification: Notification): 'scheduled' | 'sent' | 'draft' {
  if (isNotificationSent(notification)) return 'sent';
  if (isNotificationScheduled(notification)) return 'scheduled';
  return 'draft';
}

/**
 * Format notification channels
 */
export function formatNotificationChannels(channels: NOTIFICATION_CHANNEL[]): string {
  if (!channels || channels.length === 0) return 'Sem canais';

  const labels: Record<NOTIFICATION_CHANNEL, string> = {
    [NOTIFICATION_CHANNEL.EMAIL]: 'E-mail',
    [NOTIFICATION_CHANNEL.SMS]: 'SMS',
    [NOTIFICATION_CHANNEL.PUSH]: 'Push',
    [NOTIFICATION_CHANNEL.IN_APP]: 'No App',
  };

  return channels.map(channel => labels[channel] || channel).join(', ');
}

/**
 * Format notification date
 */
export function formatNotificationDate(notification: Notification): string {
  const hoursAgo = dateUtils.getHoursAgo(notification.createdAt);

  if (hoursAgo < 1) {
    const minutesAgo = Math.floor(hoursAgo * 60);
    return `${minutesAgo} ${minutesAgo === 1 ? 'minuto' : 'minutos'} atrás`;
  }

  if (hoursAgo < 24) {
    const hours = Math.floor(hoursAgo);
    return `${hours} ${hours === 1 ? 'hora' : 'horas'} atrás`;
  }

  const daysAgo = dateUtils.getDaysAgo(notification.createdAt);
  if (daysAgo < 7) {
    return `${daysAgo} ${daysAgo === 1 ? 'dia' : 'dias'} atrás`;
  }

  return dateUtils.formatDate(notification.createdAt, 'dd/MM/yyyy');
}

/**
 * Group notifications by date
 */
export function groupNotificationsByDate(
  notifications: Notification[],
): Record<string, Notification[]> {
  const groups: Record<string, Notification[]> = {
    Hoje: [],
    Ontem: [],
    'Esta semana': [],
    'Este mês': [],
    'Mais antigas': [],
  };

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today);
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  notifications.forEach(notification => {
    const notificationDate = new Date(notification.createdAt);

    if (dateUtils.isSameDay(notificationDate, today)) {
      groups['Hoje'].push(notification);
    } else if (dateUtils.isSameDay(notificationDate, yesterday)) {
      groups['Ontem'].push(notification);
    } else if (notificationDate > weekAgo) {
      groups['Esta semana'].push(notification);
    } else if (notificationDate > monthAgo) {
      groups['Este mês'].push(notification);
    } else {
      groups['Mais antigas'].push(notification);
    }
  });

  // Remove empty groups
  Object.keys(groups).forEach(key => {
    if (groups[key].length === 0) {
      delete groups[key];
    }
  });

  return groups;
}

/**
 * Group notifications by type
 */
export function groupNotificationsByType(
  notifications: Notification[],
): Record<NOTIFICATION_TYPE, Notification[]> {
  const groups = {} as Record<NOTIFICATION_TYPE, Notification[]>;

  // Initialize all types
  Object.values(NOTIFICATION_TYPE).forEach(type => {
    groups[type as NOTIFICATION_TYPE] = [];
  });

  // Group notifications
  notifications.forEach(notification => {
    groups[notification.type].push(notification);
  });

  return groups;
}

/**
 * Filter unread notifications
 */
export function filterUnreadNotifications(notifications: Notification[]): Notification[] {
  return notifications.filter(isNotificationUnread);
}

/**
 * Filter notifications by user (that haven't been seen by the user)
 */
export function filterUnseenNotificationsByUser(
  notifications: Notification[],
  userId: string,
): Notification[] {
  return notifications.filter(notification => !isNotificationReadByUser(notification, userId));
}

/**
 * Sort notifications by date
 */
export function sortNotificationsByDate(
  notifications: Notification[],
  order: 'asc' | 'desc' = 'desc',
): Notification[] {
  return [...notifications].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime();
    const dateB = new Date(b.createdAt).getTime();
    return order === 'asc' ? dateA - dateB : dateB - dateA;
  });
}

/**
 * Sort notifications by importance
 */
export function sortNotificationsByImportance(notifications: Notification[]): Notification[] {
  return [...notifications].sort((a, b) => {
    // Use importanceOrder for accurate sorting
    const orderA = a.importanceOrder || 999;
    const orderB = b.importanceOrder || 999;
    return orderA - orderB;
  });
}

/**
 * Calculate notification statistics
 */
export function calculateNotificationStats(notifications: Notification[]) {
  const total = notifications.length;
  const unread = notifications.filter(isNotificationUnread).length;
  const read = total - unread;
  const sent = notifications.filter(isNotificationSent).length;
  const scheduled = notifications.filter(isNotificationScheduled).length;

  const byType = notifications.reduce(
    (acc, notification) => {
      const type = notification.type;
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    },
    {} as Record<NOTIFICATION_TYPE, number>,
  );

  const byImportance = notifications.reduce(
    (acc, notification) => {
      const importance = notification.importance;
      acc[importance] = (acc[importance] || 0) + 1;
      return acc;
    },
    {} as Record<NOTIFICATION_IMPORTANCE, number>,
  );

  const byChannel = notifications.reduce(
    (acc, notification) => {
      notification.channel.forEach(ch => {
        acc[ch] = (acc[ch] || 0) + 1;
      });
      return acc;
    },
    {} as Record<NOTIFICATION_CHANNEL, number>,
  );

  return {
    total,
    unread,
    read,
    sent,
    scheduled,
    byType,
    byImportance,
    byChannel,
  };
}

/**
 * Format seen notification info
 */
export function formatSeenNotificationInfo(seen: SeenNotification): string {
  const userName = seen.user?.name || 'Usuário desconhecido';
  const seenDate = dateUtils.formatDate(seen.seenAt, 'dd/MM/yyyy HH:mm');
  return `Visto por ${userName} em ${seenDate}`;
}
