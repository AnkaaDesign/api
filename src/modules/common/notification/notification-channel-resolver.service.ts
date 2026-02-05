import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, UserNotificationPreference } from '../../../types';
import {
  NOTIFICATION_CHANNEL,
  SECTOR_PRIVILEGES,
  NOTIFICATION_TYPE,
} from '../../../constants';
import {
  NotificationChannel,
  NotificationType,
  SectorPrivileges,
  NotificationImportance,
} from '@prisma/client';

/**
 * Represents a resolved channel with its configuration
 */
export interface ResolvedChannel {
  /** The notification channel */
  channel: NotificationChannel;
  /** Whether this channel is mandatory (cannot be disabled by user) */
  mandatory: boolean;
  /** Whether this channel came from a sector override */
  fromOverride: boolean;
}

/**
 * Channel configuration from NotificationChannelConfig model
 */
export interface ChannelConfig {
  channel: NotificationChannel;
  enabled: boolean;
  mandatory: boolean;
  defaultOn: boolean;
  minImportance?: NotificationImportance | null;
}

/**
 * Sector override configuration from NotificationSectorOverride model
 */
export interface SectorOverride {
  sector: SectorPrivileges;
  channelOverrides?: ChannelOverrideConfig | null;
  importanceOverride?: NotificationImportance | null;
}

/**
 * Channel override configuration stored in JSON
 */
export interface ChannelOverrideConfig {
  [key: string]: {
    enabled?: boolean;
    mandatory?: boolean;
    defaultOn?: boolean;
  };
}

/**
 * Notification configuration from NotificationConfiguration model
 */
export interface NotificationConfiguration {
  id: string;
  key: string;
  notificationType: NotificationType;
  eventType: string;
  description?: string | null;
  enabled: boolean;
  importance: NotificationImportance;
  channelConfigs?: ChannelConfig[];
  sectorOverrides?: SectorOverride[];
}

/**
 * Service responsible for determining which notification channels to use for each recipient.
 *
 * The resolution process follows this priority order:
 * 1. Base channel configs from NotificationConfiguration
 * 2. Sector overrides (if user's sector has an override defined)
 * 3. User preferences (UserNotificationPreference)
 *
 * Mandatory channels are always included regardless of user preferences.
 */
@Injectable()
export class NotificationChannelResolverService {
  private readonly logger = new Logger(NotificationChannelResolverService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves which channels should be used for a specific user based on configuration,
   * sector overrides, and user preferences.
   *
   * @param config - The notification configuration
   * @param user - The user to resolve channels for
   * @returns Array of resolved channels with their flags
   */
  async resolveChannelsForUser(
    config: NotificationConfiguration,
    user: User,
  ): Promise<ResolvedChannel[]> {
    this.logger.debug(
      `Resolving channels for user ${user.id} with config ${config.key}`,
    );

    // 1. Get base channel configs from configuration
    let channelConfigs = config.channelConfigs || [];

    if (channelConfigs.length === 0) {
      this.logger.warn(
        `No channel configs found for configuration ${config.key}`,
      );
      return [];
    }

    // 2. Apply sector overrides if user's sector has override
    const sectorPrivilege = this.getUserSectorPrivilege(user);
    let fromOverride = false;

    if (sectorPrivilege) {
      const sectorOverride = this.getSectorOverride(config, sectorPrivilege);

      if (sectorOverride) {
        channelConfigs = this.applySectorOverride(
          channelConfigs,
          sectorOverride,
        );
        fromOverride = true;
        this.logger.debug(
          `Applied sector override for ${sectorPrivilege} on config ${config.key}`,
        );
      }
    }

    // 3. Apply user preferences
    const userPrefs = await this.getUserPreferences(user.id, config.key);
    const finalConfigs = this.applyUserPreferences(channelConfigs, userPrefs);

    // 4. Build final list of resolved channels
    const resolvedChannels: ResolvedChannel[] = [];

    for (const channelConfig of finalConfigs) {
      if (this.shouldIncludeChannel(channelConfig, this.getUserPrefForChannel(userPrefs, channelConfig.channel))) {
        resolvedChannels.push({
          channel: channelConfig.channel,
          mandatory: channelConfig.mandatory,
          fromOverride,
        });
      }
    }

    this.logger.debug(
      `Resolved ${resolvedChannels.length} channels for user ${user.id}: ${resolvedChannels.map(c => c.channel).join(', ')}`,
    );

    return resolvedChannels;
  }

  /**
   * Applies user preferences to channel configurations.
   *
   * Rules:
   * - If channel is mandatory, always include it
   * - If user has explicit preference, respect it
   * - If no preference, use defaultOn value
   *
   * @param channelConfigs - Base channel configurations
   * @param userPrefs - User notification preference (can be null)
   * @returns Modified channel configurations
   */
  applyUserPreferences(
    channelConfigs: ChannelConfig[],
    userPrefs: UserNotificationPreference | null,
  ): ChannelConfig[] {
    if (!userPrefs) {
      // No user preferences, return configs as-is
      return channelConfigs;
    }

    return channelConfigs.map(config => {
      // Mandatory channels cannot be changed
      if (config.mandatory) {
        return { ...config, enabled: true };
      }

      // Check if user has this channel in their enabled list
      const userHasChannel = userPrefs.channels.includes(
        config.channel as unknown as NOTIFICATION_CHANNEL,
      );

      // Check if this channel is mandatory for the user
      const isMandatoryForUser = userPrefs.mandatoryChannels.includes(
        config.channel as unknown as NOTIFICATION_CHANNEL,
      );

      if (isMandatoryForUser) {
        return { ...config, enabled: true, mandatory: true };
      }

      // User preference takes precedence over defaultOn
      return {
        ...config,
        enabled: userPrefs.enabled ? userHasChannel : false,
      };
    });
  }

  /**
   * Gets the sector override for a specific sector from the configuration.
   *
   * @param config - The notification configuration
   * @param sector - The sector privilege to find override for
   * @returns The sector override if found, null otherwise
   */
  getSectorOverride(
    config: NotificationConfiguration,
    sector: SectorPrivileges,
  ): SectorOverride | null {
    if (!config.sectorOverrides || config.sectorOverrides.length === 0) {
      return null;
    }

    const override = config.sectorOverrides.find(o => o.sector === sector);
    return override || null;
  }

  /**
   * Gets user notification preferences for a specific configuration key.
   *
   * @param userId - The user ID
   * @param configKey - The notification configuration key (e.g., "TASK.created")
   * @returns User preference if found, null otherwise
   */
  async getUserPreferences(
    userId: string,
    configKey: string,
  ): Promise<UserNotificationPreference | null> {
    try {
      // Parse config key to extract type and event
      const [typeStr, eventType] = configKey.split('.');
      const notificationType = typeStr as NotificationType;

      const preference = await this.prisma.userNotificationPreference.findUnique({
        where: {
          userId_notificationType_eventType: {
            userId,
            notificationType,
            eventType: eventType || null,
          },
        },
      });

      if (!preference) {
        return null;
      }

      return preference as unknown as UserNotificationPreference;
    } catch (error) {
      this.logger.error(
        `Failed to get user preferences for user ${userId}, config ${configKey}`,
        error,
      );
      return null;
    }
  }

  /**
   * Determines if a channel should be included based on its config and user preference.
   *
   * Logic:
   * - If !enabled -> false
   * - If mandatory -> true
   * - If userPref !== null -> userPref
   * - Else -> defaultOn
   *
   * @param channelConfig - The channel configuration
   * @param userPref - User preference for this channel (null if not set)
   * @returns true if channel should be included
   */
  shouldIncludeChannel(
    channelConfig: ChannelConfig,
    userPref: boolean | null,
  ): boolean {
    // Channel disabled in config -> never include
    if (!channelConfig.enabled) {
      return false;
    }

    // Mandatory channels are always included
    if (channelConfig.mandatory) {
      return true;
    }

    // If user has explicit preference, use it
    if (userPref !== null) {
      return userPref;
    }

    // Default to defaultOn value
    return channelConfig.defaultOn;
  }

  /**
   * Applies sector override to channel configurations.
   *
   * @param channelConfigs - Base channel configurations
   * @param sectorOverride - Sector override to apply
   * @returns Modified channel configurations
   */
  private applySectorOverride(
    channelConfigs: ChannelConfig[],
    sectorOverride: SectorOverride,
  ): ChannelConfig[] {
    if (!sectorOverride.channelOverrides) {
      return channelConfigs;
    }

    const overrides = sectorOverride.channelOverrides;

    return channelConfigs.map(config => {
      const channelKey = config.channel as string;
      const override = overrides[channelKey];

      if (!override) {
        return config;
      }

      return {
        ...config,
        enabled: override.enabled ?? config.enabled,
        mandatory: override.mandatory ?? config.mandatory,
        defaultOn: override.defaultOn ?? config.defaultOn,
      };
    });
  }

  /**
   * Gets the sector privilege for a user.
   *
   * @param user - The user
   * @returns Sector privilege or null if user has no sector
   */
  private getUserSectorPrivilege(user: User): SectorPrivileges | null {
    if (!user.sector?.privileges) {
      return null;
    }

    return user.sector.privileges as unknown as SectorPrivileges;
  }

  /**
   * Gets user preference value for a specific channel.
   *
   * @param userPrefs - User notification preferences
   * @param channel - The channel to check
   * @returns true if user wants channel, false if not, null if no preference
   */
  private getUserPrefForChannel(
    userPrefs: UserNotificationPreference | null,
    channel: NotificationChannel,
  ): boolean | null {
    if (!userPrefs) {
      return null;
    }

    // If user disabled all notifications, return false
    if (!userPrefs.enabled) {
      return false;
    }

    // Check if channel is in user's enabled channels
    const channelAsEnum = channel as unknown as NOTIFICATION_CHANNEL;
    return userPrefs.channels.includes(channelAsEnum);
  }

  /**
   * Loads a notification configuration from the database by key.
   *
   * @param key - The configuration key
   * @returns The notification configuration with channel configs and sector overrides
   */
  async loadConfigurationByKey(
    key: string,
  ): Promise<NotificationConfiguration | null> {
    try {
      // Use type assertion for Prisma model that may be newly added
      const prismaClient = this.prisma as any;
      const config = await prismaClient.notificationConfiguration.findUnique({
        where: { key },
        include: {
          channelConfigs: true,
          sectorOverrides: true,
        },
      });

      if (!config) {
        return null;
      }

      return {
        id: config.id,
        key: config.key,
        notificationType: config.notificationType,
        eventType: config.eventType,
        description: config.description,
        enabled: config.enabled,
        importance: config.importance,
        channelConfigs: config.channelConfigs.map(cc => ({
          channel: cc.channel,
          enabled: cc.enabled,
          mandatory: cc.mandatory,
          defaultOn: cc.defaultOn,
          minImportance: cc.minImportance,
        })),
        sectorOverrides: config.sectorOverrides.map(so => ({
          sector: so.sector,
          channelOverrides: so.channelOverrides as ChannelOverrideConfig | null,
          importanceOverride: so.importanceOverride,
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to load configuration for key ${key}`, error);
      return null;
    }
  }

  /**
   * Resolves channels for multiple users efficiently.
   *
   * @param config - The notification configuration
   * @param users - Array of users to resolve channels for
   * @returns Map of user ID to resolved channels
   */
  async resolveChannelsForUsers(
    config: NotificationConfiguration,
    users: User[],
  ): Promise<Map<string, ResolvedChannel[]>> {
    const result = new Map<string, ResolvedChannel[]>();

    // Batch load user preferences
    const userIds = users.map(u => u.id);
    const [typeStr, eventType] = config.key.split('.');
    const notificationType = typeStr as NotificationType;

    const preferences = await this.prisma.userNotificationPreference.findMany({
      where: {
        userId: { in: userIds },
        notificationType,
        eventType: eventType || null,
      },
    });

    const prefsMap = new Map(
      preferences.map(p => [p.userId, p as unknown as UserNotificationPreference]),
    );

    // Resolve channels for each user
    for (const user of users) {
      let channelConfigs = config.channelConfigs || [];
      let fromOverride = false;

      // Apply sector overrides
      const sectorPrivilege = this.getUserSectorPrivilege(user);
      if (sectorPrivilege) {
        const sectorOverride = this.getSectorOverride(config, sectorPrivilege);
        if (sectorOverride) {
          channelConfigs = this.applySectorOverride(channelConfigs, sectorOverride);
          fromOverride = true;
        }
      }

      // Apply user preferences
      const userPrefs = prefsMap.get(user.id) || null;
      const finalConfigs = this.applyUserPreferences(channelConfigs, userPrefs);

      // Build resolved channels
      const resolvedChannels: ResolvedChannel[] = [];
      for (const channelConfig of finalConfigs) {
        if (this.shouldIncludeChannel(channelConfig, this.getUserPrefForChannel(userPrefs, channelConfig.channel))) {
          resolvedChannels.push({
            channel: channelConfig.channel,
            mandatory: channelConfig.mandatory,
            fromOverride,
          });
        }
      }

      result.set(user.id, resolvedChannels);
    }

    return result;
  }

  /**
   * Gets all enabled channels for a configuration (ignoring user preferences).
   * Useful for determining which channels are potentially available.
   *
   * @param config - The notification configuration
   * @returns Array of enabled channel configurations
   */
  getEnabledChannels(config: NotificationConfiguration): ChannelConfig[] {
    return (config.channelConfigs || []).filter(cc => cc.enabled);
  }

  /**
   * Gets all mandatory channels for a configuration.
   *
   * @param config - The notification configuration
   * @returns Array of mandatory channel types
   */
  getMandatoryChannels(config: NotificationConfiguration): NotificationChannel[] {
    return (config.channelConfigs || [])
      .filter(cc => cc.mandatory && cc.enabled)
      .map(cc => cc.channel);
  }
}
