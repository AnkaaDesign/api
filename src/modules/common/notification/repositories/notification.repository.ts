import { Notification, SeenNotification } from '../../../../types';
import {
  NotificationCreateFormData,
  NotificationUpdateFormData,
  NotificationInclude,
  NotificationWhere,
  NotificationOrderBy,
  SeenNotificationCreateFormData,
  SeenNotificationUpdateFormData,
  SeenNotificationInclude,
  SeenNotificationWhere,
  SeenNotificationOrderBy,
} from '../../../../schemas';
import { BaseStringRepository } from '../../base/base-string.repository';

export type { PrismaTransaction } from '../../base/base.repository';

export abstract class NotificationRepository extends BaseStringRepository<
  Notification,
  NotificationCreateFormData,
  NotificationUpdateFormData,
  NotificationInclude,
  NotificationOrderBy,
  NotificationWhere
> {}

export abstract class SeenNotificationRepository extends BaseStringRepository<
  SeenNotification,
  SeenNotificationCreateFormData,
  SeenNotificationUpdateFormData,
  SeenNotificationInclude,
  SeenNotificationOrderBy,
  SeenNotificationWhere
> {}
