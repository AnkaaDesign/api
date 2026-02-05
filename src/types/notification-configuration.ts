// packages/interfaces/src/notification-configuration.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type {
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
  ORDER_BY_DIRECTION,
  SECTOR_PRIVILEGES,
} from '@constants';
import type { User, UserIncludes, UserOrderBy } from './user';
import type { Sector, SectorIncludes, SectorOrderBy } from './sector';

// =====================
// Predefined Filter Types Enum
// =====================

/**
 * Predefined recipient filter types for notification targeting
 * These filters determine who receives notifications based on their relationship to the entity
 */
export enum NOTIFICATION_RECIPIENT_FILTER {
  // Task-related filters
  TASK_ASSIGNEE = 'TASK_ASSIGNEE',
  TASK_CREATOR = 'TASK_CREATOR',
  TASK_SECTOR_MEMBERS = 'TASK_SECTOR_MEMBERS',

  // Sector-related filters
  SECTOR_MANAGER = 'SECTOR_MANAGER',
  SECTOR_MEMBERS = 'SECTOR_MEMBERS',

  // Order-related filters
  ORDER_REQUESTER = 'ORDER_REQUESTER',
  ORDER_APPROVER = 'ORDER_APPROVER',
  ORDER_SUPPLIER_CONTACT = 'ORDER_SUPPLIER_CONTACT',

  // Service order filters
  SERVICE_ORDER_ASSIGNEE = 'SERVICE_ORDER_ASSIGNEE',
  SERVICE_ORDER_CREATOR = 'SERVICE_ORDER_CREATOR',

  // PPE-related filters
  PPE_DELIVERY_RECIPIENT = 'PPE_DELIVERY_RECIPIENT',
  PPE_DELIVERY_APPROVER = 'PPE_DELIVERY_APPROVER',

  // Vacation-related filters
  VACATION_REQUESTER = 'VACATION_REQUESTER',
  VACATION_APPROVER = 'VACATION_APPROVER',

  // Warning-related filters
  WARNING_COLLABORATOR = 'WARNING_COLLABORATOR',
  WARNING_SUPERVISOR = 'WARNING_SUPERVISOR',
  WARNING_WITNESS = 'WARNING_WITNESS',

  // Maintenance filters
  MAINTENANCE_ASSIGNEE = 'MAINTENANCE_ASSIGNEE',
  MAINTENANCE_REQUESTER = 'MAINTENANCE_REQUESTER',

  // External withdrawal filters
  EXTERNAL_WITHDRAWAL_REQUESTER = 'EXTERNAL_WITHDRAWAL_REQUESTER',
  EXTERNAL_WITHDRAWAL_APPROVER = 'EXTERNAL_WITHDRAWAL_APPROVER',

  // Borrow filters
  BORROW_BORROWER = 'BORROW_BORROWER',
  BORROW_APPROVER = 'BORROW_APPROVER',

  // Role-based filters
  USERS_WITH_PRIVILEGE = 'USERS_WITH_PRIVILEGE',
  ALL_ACTIVE_USERS = 'ALL_ACTIVE_USERS',

  // Customer-related filters
  CUSTOMER_REPRESENTATIVES = 'CUSTOMER_REPRESENTATIVES',

  // Changed by filter (excludes the person who made the change)
  EXCLUDE_CHANGED_BY = 'EXCLUDE_CHANGED_BY',

  // Custom filter (uses custom query)
  CUSTOM = 'CUSTOM',
}

// =====================
// Channel Configuration Interface
// =====================

/**
 * Configuration for a specific notification channel
 */
export interface NotificationChannelConfig {
  /** The notification channel */
  channel: NOTIFICATION_CHANNEL;

  /** Whether this channel is enabled */
  enabled: boolean;

  /** Template for the notification title (supports variables) */
  titleTemplate: string;

  /** Template for the notification body (supports variables) */
  bodyTemplate: string;

  /** Optional action URL template */
  actionUrlTemplate?: string | null;

  /** Optional action type */
  actionType?: string | null;

  /** Channel-specific configuration (e.g., email subject, WhatsApp formatting) */
  channelConfig?: Record<string, unknown> | null;

  /** Delay before sending (in milliseconds) - useful for batching */
  delayMs?: number | null;

  /** Whether to respect user's quiet hours for this channel */
  respectQuietHours?: boolean;
}

// =====================
// Sector Override Interface
// =====================

/**
 * Sector-specific overrides for notification configuration
 * Allows customizing notifications for specific sectors
 */
export interface NotificationSectorOverride extends BaseEntity {
  /** Reference to the notification configuration */
  notificationConfigurationId: string;

  /** The sector this override applies to */
  sectorId: string;

  /** Override enabled status (null = use default) */
  enabled?: boolean | null;

  /** Override importance (null = use default) */
  importance?: NOTIFICATION_IMPORTANCE | null;

  /** Override channel configurations */
  channelOverrides?: Partial<NotificationChannelConfig>[] | null;

  /** Additional recipients for this sector */
  additionalRecipientFilters?: NOTIFICATION_RECIPIENT_FILTER[] | null;

  /** Recipients to exclude for this sector */
  excludeRecipientFilters?: NOTIFICATION_RECIPIENT_FILTER[] | null;

  // Relations
  notificationConfiguration?: NotificationConfiguration;
  sector?: Sector;
}

// =====================
// Target Rule Interface
// =====================

/**
 * Rules for determining notification recipients
 */
export interface NotificationTargetRule {
  /** Predefined filter type */
  filterType: NOTIFICATION_RECIPIENT_FILTER;

  /** Priority of this rule (lower = higher priority) */
  priority: number;

  /** Whether this rule includes or excludes recipients */
  mode: 'include' | 'exclude';

  /** Additional filter parameters */
  params?: {
    /** Required privilege for USERS_WITH_PRIVILEGE filter */
    privilege?: SECTOR_PRIVILEGES;

    /** Specific user IDs to include/exclude */
    userIds?: string[];

    /** Specific sector IDs to filter by */
    sectorIds?: string[];

    /** Custom query for CUSTOM filter type */
    customQuery?: string;
  } | null;
}

// =====================
// Notification Rule Interface
// =====================

/**
 * Business rules for when notifications should be sent
 */
export interface NotificationRule {
  /** Unique identifier for the rule */
  id: string;

  /** Human-readable name for the rule */
  name: string;

  /** Description of what this rule does */
  description?: string | null;

  /** Field that triggers the notification when changed */
  triggerField?: string | null;

  /** Specific values that trigger the notification (e.g., status transitions) */
  triggerValues?: {
    /** Previous value(s) that must match */
    from?: unknown[] | null;

    /** New value(s) that must match */
    to?: unknown[] | null;
  } | null;

  /** Condition expression (evaluated at runtime) */
  condition?: string | null;

  /** Whether this rule is enabled */
  enabled: boolean;

  /** Minimum time between notifications for the same entity (in milliseconds) */
  cooldownMs?: number | null;

  /** Whether to aggregate multiple changes into a single notification */
  aggregate?: boolean;

  /** Aggregation window in milliseconds */
  aggregationWindowMs?: number | null;
}

// =====================
// Main Configuration Interface
// =====================

/**
 * Full notification configuration entity
 * Defines how notifications are generated and sent for specific event types
 */
export interface NotificationConfiguration extends BaseEntity {
  /** Unique key for this configuration (e.g., "task.status.changed") */
  eventKey: string;

  /** Human-readable name for this notification type */
  name: string;

  /** Description of when this notification is sent */
  description?: string | null;

  /** The notification type category */
  type: NOTIFICATION_TYPE;

  /** Default importance level */
  importance: NOTIFICATION_IMPORTANCE;

  /** Whether this configuration is enabled */
  enabled: boolean;

  /** Whether users can disable this notification */
  userConfigurable: boolean;

  /** Whether this notification is mandatory (cannot be disabled by user) */
  isMandatory: boolean;

  /** Mandatory channels that always send regardless of user preferences */
  mandatoryChannels: NOTIFICATION_CHANNEL[];

  /** Channel configurations */
  channels: NotificationChannelConfig[];

  /** Recipient targeting rules */
  targetRules: NotificationTargetRule[];

  /** Business rules for when to send */
  rules: NotificationRule[];

  /** Metadata for additional configuration */
  metadata?: Record<string, unknown> | null;

  // Relations
  sectorOverrides?: NotificationSectorOverride[];
}

// =====================
// Channel Resolution Result
// =====================

/**
 * Result of resolving which channels to use for a specific user
 */
export interface ChannelResolutionResult {
  /** The user this result is for */
  userId: string;

  /** User object (when included) */
  user?: User;

  /** Channels to send to */
  channels: NOTIFICATION_CHANNEL[];

  /** Channels that were blocked by user preferences */
  blockedByPreference: NOTIFICATION_CHANNEL[];

  /** Channels that are mandatory and will always send */
  mandatoryChannels: NOTIFICATION_CHANNEL[];

  /** Whether the notification was completely blocked */
  blocked: boolean;

  /** Reason for blocking (if blocked) */
  blockReason?: string | null;

  /** Per-channel configuration after user preference merge */
  channelConfigs: Map<NOTIFICATION_CHANNEL, NotificationChannelConfig>;
}

// =====================
// Recipient Resolution Result
// =====================

/**
 * Result of determining all recipients for a notification
 */
export interface RecipientResolutionResult {
  /** Successfully resolved recipients */
  recipients: ChannelResolutionResult[];

  /** Total number of potential recipients before filtering */
  totalPotentialRecipients: number;

  /** Number of recipients that were filtered out */
  filteredCount: number;

  /** Reasons for filtering (aggregated) */
  filterReasons: {
    reason: string;
    count: number;
  }[];

  /** Whether the notification should be sent at all */
  shouldSend: boolean;

  /** If not sending, the reason why */
  skipReason?: string | null;

  /** Rules that were evaluated */
  evaluatedRules: {
    ruleId: string;
    ruleName: string;
    matched: boolean;
    reason?: string | null;
  }[];
}

// =====================
// Notification Context Interface
// =====================

/**
 * Context passed to notification dispatch
 * Contains all information needed to generate and send notifications
 */
export interface NotificationContext {
  /** The event key that triggered this notification */
  eventKey: string;

  /** The entity type being notified about */
  entityType: string;

  /** The entity ID being notified about */
  entityId: string;

  /** The name of the task/entity (for display) */
  taskName?: string | null;

  /** Old value (for change notifications) */
  oldValue?: unknown;

  /** New value (for change notifications) */
  newValue?: unknown;

  /** Field that changed */
  changedField?: string | null;

  /** User who made the change */
  changedBy?: User | null;

  /** ID of user who made the change */
  changedById?: string | null;

  /** Timestamp of the change */
  changedAt: Date;

  /** The full entity object (for template rendering) */
  entity?: Record<string, unknown> | null;

  /** Related entities (e.g., task.customer, task.sector) */
  relatedEntities?: {
    customer?: Record<string, unknown> | null;
    sector?: Sector | null;
    user?: User | null;
    order?: Record<string, unknown> | null;
    task?: Record<string, unknown> | null;
    [key: string]: unknown;
  } | null;

  /** Additional metadata */
  metadata?: Record<string, unknown> | null;

  /** Override configuration (for testing or special cases) */
  configOverrides?: Partial<NotificationConfiguration> | null;

  /** Force send even if rules don't match */
  forceSend?: boolean;

  /** Specific user IDs to send to (overrides target rules) */
  targetUserIds?: string[] | null;

  /** Request ID for tracing */
  requestId?: string | null;
}

// =====================
// Template Variables Interface
// =====================

/**
 * Available variables for template rendering
 */
export interface TemplateVariables {
  // Entity information
  entityId: string;
  entityType: string;
  entityName?: string | null;

  // Change information
  changedField?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  changedAt: string;

  // User who made the change
  changedBy?: {
    id: string;
    name: string;
    email?: string | null;
  } | null;

  // Recipient information
  recipient?: {
    id: string;
    name: string;
    email?: string | null;
  } | null;

  // Task-specific variables
  task?: {
    id: string;
    name: string;
    status?: string | null;
    serialNumber?: string | null;
    term?: string | null;
    forecastDate?: string | null;
  } | null;

  // Sector-specific variables
  sector?: {
    id: string;
    name: string;
  } | null;

  // Customer-specific variables
  customer?: {
    id: string;
    name: string;
    fantasyName?: string | null;
  } | null;

  // Order-specific variables
  order?: {
    id: string;
    number?: string | null;
    status?: string | null;
    total?: number | null;
  } | null;

  // Service order variables
  serviceOrder?: {
    id: string;
    description?: string | null;
    status?: string | null;
    type?: string | null;
  } | null;

  // URLs and links
  actionUrl?: string | null;
  webAppUrl?: string | null;
  detailsUrl?: string | null;

  // Date/time formatting helpers
  formattedDate?: string | null;
  formattedTime?: string | null;
  formattedDateTime?: string | null;

  // Localization
  locale?: string | null;
  timezone?: string | null;

  // Custom variables from metadata
  [key: string]: unknown;
}

// =====================
// Rendered Templates Interface
// =====================

/**
 * Rendered templates per channel
 */
export interface RenderedTemplates {
  /** The channel this template is for */
  channel: NOTIFICATION_CHANNEL;

  /** Rendered title */
  title: string;

  /** Rendered body */
  body: string;

  /** Rendered action URL (if applicable) */
  actionUrl?: string | null;

  /** Action type */
  actionType?: string | null;

  /** Channel-specific rendered content */
  channelSpecific?: {
    /** Email-specific: HTML body */
    htmlBody?: string | null;

    /** Email-specific: plain text body */
    plainTextBody?: string | null;

    /** Email-specific: subject line */
    subject?: string | null;

    /** WhatsApp-specific: formatted message */
    whatsappMessage?: string | null;

    /** Push notification: data payload */
    pushData?: Record<string, unknown> | null;

    /** Push notification: badge count */
    badge?: number | null;

    /** Push notification: sound */
    sound?: string | null;
  } | null;

  /** Whether this template was successfully rendered */
  success: boolean;

  /** Error message if rendering failed */
  error?: string | null;
}

// =====================
// Include Types
// =====================

export interface NotificationConfigurationIncludes {
  sectorOverrides?:
    | boolean
    | {
        include?: NotificationSectorOverrideIncludes;
      };
}

export interface NotificationSectorOverrideIncludes {
  notificationConfiguration?:
    | boolean
    | {
        include?: NotificationConfigurationIncludes;
      };
  sector?:
    | boolean
    | {
        include?: SectorIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface NotificationConfigurationOrderBy {
  id?: ORDER_BY_DIRECTION;
  eventKey?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  type?: ORDER_BY_DIRECTION;
  importance?: ORDER_BY_DIRECTION;
  enabled?: ORDER_BY_DIRECTION;
  userConfigurable?: ORDER_BY_DIRECTION;
  isMandatory?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface NotificationSectorOverrideOrderBy {
  id?: ORDER_BY_DIRECTION;
  enabled?: ORDER_BY_DIRECTION;
  importance?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  sector?: SectorOrderBy;
}

// =====================
// Response Interfaces
// =====================

// NotificationConfiguration responses
export interface NotificationConfigurationGetUniqueResponse extends BaseGetUniqueResponse<NotificationConfiguration> {}
export interface NotificationConfigurationGetManyResponse extends BaseGetManyResponse<NotificationConfiguration> {}
export interface NotificationConfigurationCreateResponse extends BaseCreateResponse<NotificationConfiguration> {}
export interface NotificationConfigurationUpdateResponse extends BaseUpdateResponse<NotificationConfiguration> {}
export interface NotificationConfigurationDeleteResponse extends BaseDeleteResponse {}

// NotificationSectorOverride responses
export interface NotificationSectorOverrideGetUniqueResponse extends BaseGetUniqueResponse<NotificationSectorOverride> {}
export interface NotificationSectorOverrideGetManyResponse extends BaseGetManyResponse<NotificationSectorOverride> {}
export interface NotificationSectorOverrideCreateResponse extends BaseCreateResponse<NotificationSectorOverride> {}
export interface NotificationSectorOverrideUpdateResponse extends BaseUpdateResponse<NotificationSectorOverride> {}
export interface NotificationSectorOverrideDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

// NotificationConfiguration batch operations
export interface NotificationConfigurationBatchCreateResponse<T> extends BaseBatchResponse<
  NotificationConfiguration,
  T
> {}
export interface NotificationConfigurationBatchUpdateResponse<T> extends BaseBatchResponse<
  NotificationConfiguration,
  T & { id: string }
> {}
export interface NotificationConfigurationBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}

// NotificationSectorOverride batch operations
export interface NotificationSectorOverrideBatchCreateResponse<T> extends BaseBatchResponse<
  NotificationSectorOverride,
  T
> {}
export interface NotificationSectorOverrideBatchUpdateResponse<T> extends BaseBatchResponse<
  NotificationSectorOverride,
  T & { id: string }
> {}
export interface NotificationSectorOverrideBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}

// =====================
// Dispatch Result Types
// =====================

/**
 * Result of a single notification dispatch attempt
 */
export interface NotificationDispatchResult {
  /** The user this notification was sent to */
  userId: string;

  /** The channel used */
  channel: NOTIFICATION_CHANNEL;

  /** Whether the dispatch was successful */
  success: boolean;

  /** Error message if dispatch failed */
  error?: string | null;

  /** The notification ID that was created */
  notificationId?: string | null;

  /** Timestamp of dispatch */
  dispatchedAt: Date;

  /** Delivery status (for async channels like email) */
  deliveryStatus?: 'pending' | 'sent' | 'delivered' | 'failed' | null;
}

/**
 * Aggregated result of dispatching notifications
 */
export interface NotificationDispatchSummary {
  /** The event key that triggered these notifications */
  eventKey: string;

  /** The entity ID */
  entityId: string;

  /** Total notifications attempted */
  totalAttempted: number;

  /** Successfully dispatched count */
  successCount: number;

  /** Failed dispatch count */
  failedCount: number;

  /** Skipped (e.g., user preferences) count */
  skippedCount: number;

  /** Individual dispatch results */
  results: NotificationDispatchResult[];

  /** Processing time in milliseconds */
  processingTimeMs: number;

  /** Request ID for tracing */
  requestId?: string | null;
}
