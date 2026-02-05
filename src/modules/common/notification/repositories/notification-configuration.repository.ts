import {
  NOTIFICATION_TYPE,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_CHANNEL,
  SECTOR_PRIVILEGES,
} from '../../../../constants';

// =====================
// Entity Interfaces
// =====================

/**
 * Represents a notification configuration entity
 */
export interface NotificationConfiguration {
  id: string;
  key: string;
  notificationType: NOTIFICATION_TYPE;
  eventType: string | null;
  title: string;
  description: string | null;
  defaultImportance: NOTIFICATION_IMPORTANCE;
  defaultChannels: NOTIFICATION_CHANNEL[];
  enabled: boolean;
  allowUserOverride: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;

  // Relations
  channelConfigs?: ChannelConfiguration[];
  sectorOverrides?: SectorOverride[];
  targetRule?: TargetRule | null;
}

/**
 * Channel-specific configuration for a notification
 */
export interface ChannelConfiguration {
  id: string;
  configurationId: string;
  channel: NOTIFICATION_CHANNEL;
  enabled: boolean;
  templateId: string | null;
  settings: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Sector-specific override for a notification configuration
 */
export interface SectorOverride {
  id: string;
  configurationId: string;
  sector: SECTOR_PRIVILEGES;
  importance: NOTIFICATION_IMPORTANCE | null;
  channels: NOTIFICATION_CHANNEL[] | null;
  enabled: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Target rule for determining notification recipients
 */
export interface TargetRule {
  id: string;
  configurationId: string;
  targetType: 'USER' | 'SECTOR' | 'ROLE' | 'ALL' | 'CUSTOM';
  targetIds: string[] | null;
  targetSectors: SECTOR_PRIVILEGES[] | null;
  excludeIds: string[] | null;
  customQuery: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// =====================
// Filter Interface
// =====================

/**
 * Filters for querying notification configurations
 */
export interface ConfigurationFilters {
  /** Filter by notification type */
  notificationType?: NOTIFICATION_TYPE;
  /** Filter by enabled status */
  enabled?: boolean;
  /** Filter by importance level */
  importance?: NOTIFICATION_IMPORTANCE;
  /** Search in key and description fields */
  search?: string;
}

// =====================
// DTO Interfaces
// =====================

/**
 * Data transfer object for creating a notification configuration
 */
export interface CreateNotificationConfigurationDto {
  key: string;
  notificationType: NOTIFICATION_TYPE;
  eventType?: string | null;
  title: string;
  description?: string | null;
  defaultImportance: NOTIFICATION_IMPORTANCE;
  defaultChannels: NOTIFICATION_CHANNEL[];
  enabled?: boolean;
  allowUserOverride?: boolean;
  metadata?: Record<string, unknown> | null;
}

/**
 * Data transfer object for updating a notification configuration
 */
export interface UpdateNotificationConfigurationDto {
  key?: string;
  notificationType?: NOTIFICATION_TYPE;
  eventType?: string | null;
  title?: string;
  description?: string | null;
  defaultImportance?: NOTIFICATION_IMPORTANCE;
  defaultChannels?: NOTIFICATION_CHANNEL[];
  enabled?: boolean;
  allowUserOverride?: boolean;
  metadata?: Record<string, unknown> | null;
}

/**
 * Data transfer object for channel configuration
 */
export interface ChannelConfigDto {
  channel: NOTIFICATION_CHANNEL;
  enabled: boolean;
  templateId?: string | null;
  settings?: Record<string, unknown> | null;
}

/**
 * Data transfer object for sector override
 */
export interface SectorOverrideDto {
  sector: SECTOR_PRIVILEGES;
  importance?: NOTIFICATION_IMPORTANCE | null;
  channels?: NOTIFICATION_CHANNEL[] | null;
  enabled?: boolean | null;
}

/**
 * Data transfer object for target rule
 */
export interface TargetRuleDto {
  targetType: 'USER' | 'SECTOR' | 'ROLE' | 'ALL' | 'CUSTOM';
  targetIds?: string[] | null;
  targetSectors?: SECTOR_PRIVILEGES[] | null;
  excludeIds?: string[] | null;
  customQuery?: string | null;
}

// =====================
// Abstract Repository
// =====================

/**
 * Abstract repository for managing notification configurations.
 * Provides methods for CRUD operations and specialized queries for notification settings.
 */
export abstract class NotificationConfigurationRepository {
  /**
   * Find a notification configuration by its unique key
   * @param key - The unique configuration key
   * @returns The configuration if found, null otherwise
   */
  abstract findByKey(key: string): Promise<NotificationConfiguration | null>;

  /**
   * Find a notification configuration by type and optional event
   * @param type - The notification type
   * @param event - Optional event type within the notification type
   * @returns The configuration if found, null otherwise
   */
  abstract findByTypeAndEvent(
    type: NOTIFICATION_TYPE,
    event?: string,
  ): Promise<NotificationConfiguration | null>;

  /**
   * Find all notification configurations matching the given filters
   * @param filters - Optional filters to apply
   * @returns Array of matching configurations
   */
  abstract findAll(filters?: ConfigurationFilters): Promise<NotificationConfiguration[]>;

  /**
   * Find all enabled notification configurations
   * @returns Array of enabled configurations
   */
  abstract findEnabled(): Promise<NotificationConfiguration[]>;

  /**
   * Create a new notification configuration
   * @param data - The configuration data to create
   * @returns The created configuration
   */
  abstract create(data: CreateNotificationConfigurationDto): Promise<NotificationConfiguration>;

  /**
   * Update an existing notification configuration
   * @param id - The configuration ID to update
   * @param data - The data to update
   * @returns The updated configuration
   */
  abstract update(
    id: string,
    data: UpdateNotificationConfigurationDto,
  ): Promise<NotificationConfiguration>;

  /**
   * Delete a notification configuration
   * @param id - The configuration ID to delete
   */
  abstract delete(id: string): Promise<void>;

  /**
   * Find a notification configuration with all its channel configurations
   * @param id - The configuration ID
   * @returns The configuration with channel configs if found, null otherwise
   */
  abstract findWithChannelConfigs(id: string): Promise<NotificationConfiguration | null>;

  /**
   * Find all notification configurations applicable to a specific sector
   * @param sector - The sector privilege level
   * @returns Array of configurations for the sector
   */
  abstract findBySector(sector: SECTOR_PRIVILEGES): Promise<NotificationConfiguration[]>;

  /**
   * Create or update a channel configuration for a notification configuration
   * @param configId - The notification configuration ID
   * @param channelConfig - The channel configuration data
   */
  abstract upsertChannelConfig(configId: string, channelConfig: ChannelConfigDto): Promise<void>;

  /**
   * Create or update a sector override for a notification configuration
   * @param configId - The notification configuration ID
   * @param override - The sector override data
   */
  abstract upsertSectorOverride(configId: string, override: SectorOverrideDto): Promise<void>;

  /**
   * Update the target rule for a notification configuration
   * @param configId - The notification configuration ID
   * @param targetRule - The target rule data
   */
  abstract updateTargetRule(configId: string, targetRule: TargetRuleDto): Promise<void>;
}
