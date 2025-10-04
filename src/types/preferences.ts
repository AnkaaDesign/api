// packages/types/src/preferences.ts

import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse } from "./common";
import type { COLOR_SCHEMA, NOTIFICATION_CHANNEL, NOTIFICATION_IMPORTANCE, ORDER_BY_DIRECTION } from '@constants';
import type { User, UserIncludes, UserOrderBy } from "./user";

// =====================
// Notification Preferences Interface
// =====================

export interface NotificationPreference extends BaseEntity {
  notificationType: string; // ALERT_TYPE from enums
  enabled: boolean;
  channels: NOTIFICATION_CHANNEL[];
  importance: NOTIFICATION_IMPORTANCE;

  // Relations
  preferences?: Preferences[];
}

// =====================
// Main Preferences Interface
// =====================

export interface Preferences extends BaseEntity {
  userId: string;
  colorSchema: COLOR_SCHEMA;
  favorites?: string[]; // Array of FAVORITE_PAGES enum values

  // Relations
  user?: User;
  notifications?: NotificationPreference[];
}

// =====================
// Include Types
// =====================

export interface NotificationPreferenceIncludes {
  preferences?:
    | boolean
    | {
        include?: PreferencesIncludes;
      };
}

export interface PreferencesIncludes {
  user?:
    | boolean
    | {
        include?: UserIncludes;
      };
  notifications?:
    | boolean
    | {
        include?: NotificationPreferenceIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface NotificationPreferenceOrderBy {
  id?: ORDER_BY_DIRECTION;
  notificationType?: ORDER_BY_DIRECTION;
  enabled?: ORDER_BY_DIRECTION;
  importance?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface PreferencesOrderBy {
  id?: ORDER_BY_DIRECTION;
  userId?: ORDER_BY_DIRECTION;
  colorSchema?: ORDER_BY_DIRECTION;
  favorites?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  user?: UserOrderBy;
  notifications?: NotificationPreferenceOrderBy;
}

// =====================
// Response Interfaces
// =====================

// NotificationPreference responses
export interface NotificationPreferenceGetUniqueResponse extends BaseGetUniqueResponse<NotificationPreference> {}
export interface NotificationPreferenceGetManyResponse extends BaseGetManyResponse<NotificationPreference> {}
export interface NotificationPreferenceCreateResponse extends BaseCreateResponse<NotificationPreference> {}
export interface NotificationPreferenceUpdateResponse extends BaseUpdateResponse<NotificationPreference> {}
export interface NotificationPreferenceDeleteResponse extends BaseDeleteResponse {}

// Preferences responses
export interface PreferencesGetUniqueResponse extends BaseGetUniqueResponse<Preferences> {}
export interface PreferencesGetManyResponse extends BaseGetManyResponse<Preferences> {}
export interface PreferencesCreateResponse extends BaseCreateResponse<Preferences> {}
export interface PreferencesUpdateResponse extends BaseUpdateResponse<Preferences> {}
export interface PreferencesDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

// NotificationPreference batch operations
export interface NotificationPreferenceBatchCreateResponse<T> extends BaseBatchResponse<NotificationPreference, T> {}
export interface NotificationPreferenceBatchUpdateResponse<T> extends BaseBatchResponse<NotificationPreference, T & { id: string }> {}
export interface NotificationPreferenceBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

// Preferences batch operations
export interface PreferencesBatchCreateResponse<T> extends BaseBatchResponse<Preferences, T> {}
export interface PreferencesBatchUpdateResponse<T> extends BaseBatchResponse<Preferences, T & { id: string }> {}
export interface PreferencesBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
