// agenda-event.ts
// Agenda com avisos — eventos com notificação antecipada.

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { NOTIFICATION_CHANNEL, ORDER_BY_DIRECTION } from '@constants';
import type { User, UserIncludes } from './user';

// =====================
// Main Entity Interface
// =====================
export interface AgendaEvent extends BaseEntity {
  title: string;
  description: string | null;
  eventDate: Date;
  notifyDaysBefore: number[];
  notifyOnDay: boolean;
  channels: NOTIFICATION_CHANNEL[];
  targetSectorIds: string[];
  targetUserIds: string[];
  createdById: string;
  isActive: boolean;
  lastNotifiedAt: Date | null;

  // Relations (optional, populated based on query)
  createdBy?: User;
}

// =====================
// Include Types
// =====================
export interface AgendaEventIncludes {
  createdBy?: boolean | { include?: UserIncludes };
}

// =====================
// Order By Types
// =====================
export interface AgendaEventOrderBy {
  id?: ORDER_BY_DIRECTION;
  title?: ORDER_BY_DIRECTION;
  eventDate?: ORDER_BY_DIRECTION;
  notifyOnDay?: ORDER_BY_DIRECTION;
  isActive?: ORDER_BY_DIRECTION;
  createdById?: ORDER_BY_DIRECTION;
  lastNotifiedAt?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================
export interface AgendaEventGetUniqueResponse extends BaseGetUniqueResponse<AgendaEvent> {}
export interface AgendaEventGetManyResponse extends BaseGetManyResponse<AgendaEvent> {}
export interface AgendaEventCreateResponse extends BaseCreateResponse<AgendaEvent> {}
export interface AgendaEventUpdateResponse extends BaseUpdateResponse<AgendaEvent> {}
export interface AgendaEventDeleteResponse extends BaseDeleteResponse {}

export interface AgendaEventBatchCreateResponse<T> extends BaseBatchResponse<AgendaEvent, T> {}
export interface AgendaEventBatchUpdateResponse<T>
  extends BaseBatchResponse<AgendaEvent, T & { id: string }> {}
export interface AgendaEventBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
