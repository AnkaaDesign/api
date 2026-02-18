import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Handlebars from 'handlebars';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeLogService } from '../changelog/changelog.service';
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_TYPE,
  NOTIFICATION_IMPORTANCE,
  ENTITY_TYPE,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
} from '../../../constants';
import { logEntityChange, trackAndLogFieldChanges } from '../changelog/utils/changelog-helpers';
import { User, UserNotificationPreference } from '../../../types';
import { WorkScheduleService } from './work-schedule.service';

// =====================
// Interfaces
// =====================

/**
 * Configuration for a notification type
 */
export interface NotificationConfiguration {
  id: string;
  key: string;
  name: string;
  description: string | null;
  notificationType: NOTIFICATION_TYPE;
  eventType: string | null;
  defaultChannels: NOTIFICATION_CHANNEL[];
  mandatoryChannels: NOTIFICATION_CHANNEL[];
  importance: NOTIFICATION_IMPORTANCE;
  isEnabled: boolean;
  isMandatory: boolean;
  respectWorkHours: boolean;
  maxPerDay: number | null;
  deduplicationWindowMinutes: number | null;
  templates: NotificationTemplateConfig;
  metadata: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Template configuration for different channels
 */
export interface NotificationTemplateConfig {
  inApp?: {
    title: string;
    body: string;
  };
  email?: {
    subject: string;
    body: string;
    html?: string;
  };
  push?: {
    title: string;
    body: string;
  };
  whatsapp?: {
    body: string;
  };
}

/**
 * Rendered templates for all channels
 */
export interface RenderedTemplates {
  inApp?: {
    title: string;
    body: string;
  };
  email?: {
    subject: string;
    body: string;
    html?: string;
  };
  push?: {
    title: string;
    body: string;
  };
  whatsapp?: {
    body: string;
  };
}

/**
 * DTO for creating a notification configuration
 */
export interface CreateNotificationConfigurationDto {
  key: string;
  name: string;
  description?: string;
  notificationType: NOTIFICATION_TYPE;
  eventType?: string;
  defaultChannels: NOTIFICATION_CHANNEL[];
  mandatoryChannels?: NOTIFICATION_CHANNEL[];
  importance?: NOTIFICATION_IMPORTANCE;
  isEnabled?: boolean;
  isMandatory?: boolean;
  respectWorkHours?: boolean;
  maxPerDay?: number;
  deduplicationWindowMinutes?: number;
  templates?: NotificationTemplateConfig;
  metadata?: Record<string, any>;
}

/**
 * DTO for updating a notification configuration
 */
export interface UpdateNotificationConfigurationDto {
  name?: string;
  description?: string;
  defaultChannels?: NOTIFICATION_CHANNEL[];
  mandatoryChannels?: NOTIFICATION_CHANNEL[];
  importance?: NOTIFICATION_IMPORTANCE;
  isEnabled?: boolean;
  isMandatory?: boolean;
  respectWorkHours?: boolean;
  maxPerDay?: number;
  deduplicationWindowMinutes?: number;
  templates?: NotificationTemplateConfig;
  metadata?: Record<string, any>;
}

/**
 * Filters for listing configurations
 */
export interface ConfigurationFilters {
  notificationType?: NOTIFICATION_TYPE;
  eventType?: string;
  isEnabled?: boolean;
  isMandatory?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Context for resolving recipients and templates
 */
export interface NotificationContext {
  userId?: string;
  actorId?: string;
  entityId?: string;
  entityType?: string;
  sectorId?: string;
  targetUserIds?: string[];
  metadata?: Record<string, any>;
  [key: string]: any;
}

/**
 * Channel configuration from user preferences
 */
export interface ChannelConfig {
  channel: NOTIFICATION_CHANNEL;
  enabled: boolean;
  isMandatory: boolean;
}

/**
 * Business rules check result
 */
export interface BusinessRulesCheckResult {
  allowed: boolean;
  reason?: string;
  shouldReschedule?: boolean;
  rescheduleTime?: Date;
}

/**
 * Cache entry structure
 */
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

// =====================
// Service Implementation
// =====================

@Injectable()
export class NotificationConfigurationService {
  private readonly logger = new Logger(NotificationConfigurationService.name);

  // In-memory cache with TTL (5 minutes = 300000ms)
  private readonly cache = new Map<string, CacheEntry<NotificationConfiguration>>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // Tracking for frequency limits and deduplication
  private readonly frequencyTracker = new Map<string, Date[]>();
  private readonly deduplicationTracker = new Map<string, Date>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly eventEmitter: EventEmitter2,
    private readonly workScheduleService: WorkScheduleService,
  ) {}

  // =====================
  // CRUD Operations
  // =====================

  /**
   * Create a new notification configuration
   *
   * @param dto - Configuration data
   * @param userId - User creating the configuration
   * @returns Created configuration
   */
  async createConfiguration(
    dto: CreateNotificationConfigurationDto,
    userId: string,
  ): Promise<NotificationConfiguration> {
    this.logger.log('Creating notification configuration', { key: dto.key, userId });

    try {
      // Validate key uniqueness
      const existing = await this.prisma.notificationConfiguration.findUnique({
        where: { key: dto.key },
      });

      if (existing) {
        throw new BadRequestException(`Configuration with key "${dto.key}" already exists`);
      }

      // Validate channels
      this.validateChannels(dto.defaultChannels);
      if (dto.mandatoryChannels) {
        this.validateChannels(dto.mandatoryChannels);
      }

      const configuration = await this.prisma.$transaction(async tx => {
        // Create configuration with channel configs
        const created = await tx.notificationConfiguration.create({
          data: {
            key: dto.key,
            description: dto.description || null,
            notificationType: dto.notificationType as any,
            eventType: dto.eventType || '',
            importance: (dto.importance || NOTIFICATION_IMPORTANCE.NORMAL) as any,
            enabled: dto.isEnabled ?? true,
            workHoursOnly: dto.respectWorkHours ?? true,
            maxFrequencyPerDay: dto.maxPerDay || null,
            deduplicationWindow: dto.deduplicationWindowMinutes || null,
            templates: (dto.templates || {}) as any,
            metadata: (dto.metadata || {}) as any,
          },
          include: {
            channelConfigs: true,
          },
        });

        // Create channel configurations for default and mandatory channels
        const allChannels = [...new Set([...dto.defaultChannels, ...(dto.mandatoryChannels || [])])];
        for (const channel of allChannels) {
          await tx.notificationChannelConfig.create({
            data: {
              configurationId: created.id,
              channel: channel as any,
              enabled: true,
              mandatory: dto.mandatoryChannels?.includes(channel) ?? false,
              defaultOn: dto.defaultChannels.includes(channel),
            },
          });
        }

        // Refetch with channel configs
        const finalConfig = await tx.notificationConfiguration.findUnique({
          where: { id: created.id },
          include: { channelConfigs: true },
        });

        // Log the creation
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.NOTIFICATION_PREFERENCE,
          entityId: created.id,
          action: CHANGE_ACTION.CREATE,
          entity: finalConfig,
          reason: 'Configuração de notificação criada',
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return finalConfig;
      });

      const result = this.mapToConfiguration(configuration);

      // Invalidate cache
      this.invalidateCache(dto.key);

      // Emit event
      this.eventEmitter.emit('notification.configuration.created', {
        configurationId: result.id,
        key: result.key,
        userId,
        createdAt: new Date(),
      });

      this.logger.log('Notification configuration created successfully', {
        id: result.id,
        key: result.key,
      });

      return result;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error creating notification configuration', {
        error: error.message,
        stack: error.stack,
        key: dto.key,
      });
      throw new InternalServerErrorException(
        'Erro ao criar configuração de notificação. Tente novamente.',
      );
    }
  }

  /**
   * Update an existing notification configuration
   *
   * @param id - Configuration ID
   * @param dto - Update data
   * @param userId - User updating the configuration
   * @returns Updated configuration
   */
  async updateConfiguration(
    id: string,
    dto: UpdateNotificationConfigurationDto,
    userId: string,
  ): Promise<NotificationConfiguration> {
    this.logger.log('Updating notification configuration', { id, userId });

    try {
      const configuration = await this.prisma.$transaction(async tx => {
        // Check if exists
        const existing = await tx.notificationConfiguration.findUnique({
          where: { id },
          include: { channelConfigs: true },
        });

        if (!existing) {
          throw new NotFoundException(`Configuração de notificação não encontrada (ID: ${id})`);
        }

        // Validate channels if provided
        if (dto.defaultChannels) {
          this.validateChannels(dto.defaultChannels);
        }
        if (dto.mandatoryChannels) {
          this.validateChannels(dto.mandatoryChannels);
        }

        // Build update data for configuration
        const updateData: any = {};

        if (dto.description !== undefined) updateData.description = dto.description;
        if (dto.importance !== undefined) updateData.importance = dto.importance;
        if (dto.isEnabled !== undefined) updateData.enabled = dto.isEnabled;
        if (dto.respectWorkHours !== undefined) updateData.workHoursOnly = dto.respectWorkHours;
        if (dto.maxPerDay !== undefined) updateData.maxFrequencyPerDay = dto.maxPerDay;
        if (dto.deduplicationWindowMinutes !== undefined) {
          updateData.deduplicationWindow = dto.deduplicationWindowMinutes;
        }
        if (dto.templates !== undefined) updateData.templates = dto.templates;
        if (dto.metadata !== undefined) updateData.metadata = dto.metadata;

        // Update configuration
        const updated = await tx.notificationConfiguration.update({
          where: { id },
          data: updateData,
        });

        // Update channel configs if channels were provided
        if (dto.defaultChannels !== undefined || dto.mandatoryChannels !== undefined) {
          // Remove existing channel configs
          await tx.notificationChannelConfig.deleteMany({
            where: { configurationId: id },
          });

          // Create new channel configs
          const defaultChannels = dto.defaultChannels || this.getDefaultChannelsFromConfigs(existing.channelConfigs);
          const mandatoryChannels = dto.mandatoryChannels || this.getMandatoryChannelsFromConfigs(existing.channelConfigs);
          const allChannels = [...new Set([...defaultChannels, ...mandatoryChannels])];

          for (const channel of allChannels) {
            await tx.notificationChannelConfig.create({
              data: {
                configurationId: id,
                channel: channel as any,
                enabled: true,
                mandatory: mandatoryChannels.includes(channel),
                defaultOn: defaultChannels.includes(channel),
              },
            });
          }
        }

        // Refetch with channel configs
        const finalConfig = await tx.notificationConfiguration.findUnique({
          where: { id },
          include: { channelConfigs: true },
        });

        // Track field-level changes
        const fieldsToTrack = [
          'description',
          'importance',
          'enabled',
          'workHoursOnly',
          'maxFrequencyPerDay',
          'deduplicationWindow',
          'templates',
          'metadata',
        ];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.NOTIFICATION_PREFERENCE,
          entityId: id,
          oldEntity: existing,
          newEntity: finalConfig,
          fieldsToTrack,
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return finalConfig;
      });

      const result = this.mapToConfiguration(configuration);

      // Invalidate cache
      this.invalidateCache(result.key);

      // Emit event
      this.eventEmitter.emit('notification.configuration.updated', {
        configurationId: result.id,
        key: result.key,
        userId,
        updatedAt: new Date(),
      });

      this.logger.log('Notification configuration updated successfully', {
        id: result.id,
        key: result.key,
      });

      return result;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error updating notification configuration', {
        error: error.message,
        stack: error.stack,
        id,
      });
      throw new InternalServerErrorException(
        'Erro ao atualizar configuração de notificação. Tente novamente.',
      );
    }
  }

  /**
   * Delete a notification configuration (soft delete consideration)
   *
   * @param id - Configuration ID
   * @param userId - User deleting the configuration
   */
  async deleteConfiguration(id: string, userId: string): Promise<void> {
    this.logger.log('Deleting notification configuration', { id, userId });

    try {
      await this.prisma.$transaction(async tx => {
        // Check if exists
        const existing = await tx.notificationConfiguration.findUnique({
          where: { id },
        });

        if (!existing) {
          throw new NotFoundException(`Configuração de notificação não encontrada (ID: ${id})`);
        }

        // Check if configuration is in use by user preferences
        const userPreferencesCount = await tx.userNotificationPreference.count({
          where: {
            notificationType: existing.notificationType as any,
            eventType: existing.eventType,
          },
        });

        if (userPreferencesCount > 0) {
          // Soft delete - just disable instead of deleting
          this.logger.warn(
            `Configuration ${id} is in use by ${userPreferencesCount} user preferences, disabling instead of deleting`,
          );

          await tx.notificationConfiguration.update({
            where: { id },
            data: { enabled: false },
          });

          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.NOTIFICATION_PREFERENCE,
            entityId: id,
            action: CHANGE_ACTION.DEACTIVATE,
            reason: 'Configuração desativada (em uso por preferências de usuário)',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: userId,
            userId,
            transaction: tx,
          });
        } else {
          // Hard delete (cascade will delete channelConfigs)
          await tx.notificationConfiguration.delete({
            where: { id },
          });

          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.NOTIFICATION_PREFERENCE,
            entityId: id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: existing,
            reason: 'Configuração de notificação excluída',
            userId,
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            transaction: tx,
          });
        }

        // Invalidate cache
        this.invalidateCache(existing.key);
      });

      // Emit event
      this.eventEmitter.emit('notification.configuration.deleted', {
        configurationId: id,
        userId,
        deletedAt: new Date(),
      });

      this.logger.log('Notification configuration deleted successfully', { id });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error deleting notification configuration', {
        error: error.message,
        stack: error.stack,
        id,
      });
      throw new InternalServerErrorException(
        'Erro ao excluir configuração de notificação. Tente novamente.',
      );
    }
  }

  /**
   * Get a configuration by key (with caching)
   *
   * @param key - Configuration key
   * @returns Configuration or null if not found
   */
  async getConfiguration(key: string): Promise<NotificationConfiguration | null> {
    // Check cache first
    const cached = this.getFromCache(key);
    if (cached) {
      this.logger.debug(`Cache hit for configuration key: ${key}`);
      return cached;
    }

    this.logger.debug(`Cache miss for configuration key: ${key}, fetching from database`);

    try {
      const configuration = await this.prisma.notificationConfiguration.findUnique({
        where: { key },
        include: {
          channelConfigs: true,
          targetRule: true,
        },
      });

      if (!configuration) {
        return null;
      }

      const result = this.mapToConfiguration(configuration);

      // Store in cache
      this.setInCache(key, result);

      return result;
    } catch (error) {
      this.logger.error('Error fetching configuration by key', {
        error: error.message,
        key,
      });
      throw new InternalServerErrorException(
        'Erro ao buscar configuração de notificação. Tente novamente.',
      );
    }
  }

  /**
   * Get a configuration by ID
   *
   * @param id - Configuration ID
   * @returns Configuration
   */
  async getConfigurationById(id: string): Promise<NotificationConfiguration> {
    try {
      const configuration = await this.prisma.notificationConfiguration.findUnique({
        where: { id },
        include: {
          channelConfigs: true,
          targetRule: true,
        },
      });

      if (!configuration) {
        throw new NotFoundException(`Configuração de notificação não encontrada (ID: ${id})`);
      }

      return this.mapToConfiguration(configuration);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error fetching configuration by ID', {
        error: error.message,
        id,
      });
      throw new InternalServerErrorException(
        'Erro ao buscar configuração de notificação. Tente novamente.',
      );
    }
  }

  /**
   * List configurations with optional filters
   *
   * @param filters - Optional filters
   * @returns List of configurations with pagination info
   */
  async listConfigurations(filters: ConfigurationFilters = {}): Promise<{
    data: NotificationConfiguration[];
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    try {
      const page = filters.page || 1;
      const limit = filters.limit || 20;
      const skip = (page - 1) * limit;

      // Build where clause
      const where: any = {};

      if (filters.notificationType) {
        where.notificationType = filters.notificationType;
      }
      if (filters.eventType) {
        where.eventType = filters.eventType;
      }
      if (filters.isEnabled !== undefined) {
        where.enabled = filters.isEnabled;
      }
      // Note: isMandatory filter is handled post-query since it depends on channelConfigs
      if (filters.search) {
        where.OR = [
          { key: { contains: filters.search, mode: 'insensitive' } },
          { description: { contains: filters.search, mode: 'insensitive' } },
        ];
      }

      // Fetch configurations and count in parallel
      const [configurations, total] = await Promise.all([
        this.prisma.notificationConfiguration.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            channelConfigs: true,
            targetRule: true,
          },
        }),
        this.prisma.notificationConfiguration.count({ where }),
      ]);

      return {
        data: configurations.map(c => this.mapToConfiguration(c)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error('Error listing configurations', {
        error: error.message,
        filters,
      });
      throw new InternalServerErrorException(
        'Erro ao listar configurações de notificação. Tente novamente.',
      );
    }
  }

  // =====================
  // Resolution Methods
  // =====================

  /**
   * Resolve which channels should be used for a user based on config and preferences
   *
   * @param configKey - Configuration key
   * @param user - User to resolve channels for
   * @returns Array of channels to use
   */
  async resolveChannelsForUser(
    configKey: string,
    user: User,
  ): Promise<NOTIFICATION_CHANNEL[]> {
    this.logger.debug('Resolving channels for user', { configKey, userId: user.id });

    try {
      // Get configuration
      const config = await this.getConfiguration(configKey);
      if (!config || !config.isEnabled) {
        this.logger.debug(`Configuration ${configKey} not found or disabled`);
        return [];
      }

      // Get user preference for this notification type
      const userPreference = await this.prisma.userNotificationPreference.findFirst({
        where: {
          userId: user.id,
          notificationType: config.notificationType as any,
          eventType: config.eventType,
        },
      });

      // Start with mandatory channels (always included)
      const channels = new Set<NOTIFICATION_CHANNEL>(config.mandatoryChannels);

      if (userPreference) {
        // User has preferences
        if (!userPreference.enabled) {
          // User disabled notifications, but still include mandatory
          this.logger.debug(`User ${user.id} disabled notifications for ${configKey}, using mandatory only`);
          return Array.from(channels);
        }

        // Add user's preferred channels
        for (const channel of userPreference.channels as NOTIFICATION_CHANNEL[]) {
          channels.add(channel);
        }
      } else {
        // No user preference, use default channels
        for (const channel of config.defaultChannels) {
          channels.add(channel);
        }
      }

      // Filter out channels that user can't receive (no email, no phone, etc.)
      const validChannels = this.filterValidChannelsForUser(Array.from(channels), user);

      this.logger.debug(`Resolved channels for user ${user.id}: ${validChannels.join(', ')}`);
      return validChannels;
    } catch (error) {
      this.logger.error('Error resolving channels for user', {
        error: error.message,
        configKey,
        userId: user.id,
      });
      // Default to IN_APP on error
      return [NOTIFICATION_CHANNEL.IN_APP];
    }
  }

  /**
   * Resolve recipients for a notification based on context
   *
   * @param configKey - Configuration key
   * @param context - Notification context
   * @returns Array of user IDs to receive the notification
   */
  async resolveRecipients(
    configKey: string,
    context: NotificationContext,
  ): Promise<string[]> {
    this.logger.debug('Resolving recipients', { configKey, context });

    try {
      const config = await this.getConfiguration(configKey);
      if (!config || !config.isEnabled) {
        return [];
      }

      // If specific target users are provided, use them
      if (context.targetUserIds && context.targetUserIds.length > 0) {
        // Filter out the actor (users shouldn't receive notifications for their own actions)
        const recipients = context.targetUserIds.filter(id => id !== context.actorId);
        return recipients;
      }

      // If specific user is targeted
      if (context.userId && context.userId !== context.actorId) {
        return [context.userId];
      }

      // Resolve based on entity type and metadata
      let recipients: string[] = [];

      if (context.sectorId) {
        // Get users in the sector
        const sectorUsers = await this.prisma.user.findMany({
          where: {
            sectorId: context.sectorId,
            isActive: true,
          },
          select: { id: true },
        });
        recipients = sectorUsers.map(u => u.id);
      }

      // Filter out the actor
      if (context.actorId) {
        recipients = recipients.filter(id => id !== context.actorId);
      }

      this.logger.debug(`Resolved ${recipients.length} recipients for ${configKey}`);
      return recipients;
    } catch (error) {
      this.logger.error('Error resolving recipients', {
        error: error.message,
        configKey,
      });
      return [];
    }
  }

  /**
   * Determine if a notification should be sent to a specific channel based on config and user preference
   *
   * @param channelConfig - Channel configuration
   * @param userPreference - User's notification preference
   * @returns true if notification should be sent
   */
  shouldSendToChannel(
    channelConfig: ChannelConfig,
    userPreference: UserNotificationPreference | null,
  ): boolean {
    // If channel is mandatory, always send
    if (channelConfig.isMandatory) {
      return true;
    }

    // If no user preference, use default (enabled)
    if (!userPreference) {
      return channelConfig.enabled;
    }

    // If user disabled all notifications for this type
    if (!userPreference.enabled) {
      return false;
    }

    // Check if user has this channel enabled
    return userPreference.channels.includes(channelConfig.channel);
  }

  // =====================
  // Business Rule Checks
  // =====================

  /**
   * Check all business rules for a notification
   *
   * @param config - Notification configuration
   * @param context - Notification context
   * @returns Check result with allowed status and reason
   */
  async checkBusinessRules(
    config: NotificationConfiguration,
    context: NotificationContext,
  ): Promise<BusinessRulesCheckResult> {
    this.logger.debug('Checking business rules', { key: config.key });

    // Check if configuration is enabled
    if (!config.isEnabled) {
      return {
        allowed: false,
        reason: 'Notification configuration is disabled',
      };
    }

    // Check working day + work hours if configured — weekends, holidays, and off-hours blocked
    if (config.respectWorkHours) {
      const canSend = await this.workScheduleService.canSendNow();
      if (!canSend) {
        const nextSendableTime = await this.workScheduleService.getNextSendableTime();
        return {
          allowed: false,
          reason: 'Outside working hours/day (weekends, holidays, or off-hours)',
          shouldReschedule: true,
          rescheduleTime: nextSendableTime,
        };
      }
    }

    // Check frequency limit
    if (config.maxPerDay && context.userId) {
      const frequencyCheck = await this.checkFrequencyLimit(
        context.userId,
        config.key,
        config.maxPerDay,
      );
      if (!frequencyCheck.allowed) {
        return frequencyCheck;
      }
    }

    // Check deduplication
    if (config.deduplicationWindowMinutes && context.userId) {
      const dedupCheck = await this.checkDeduplication(
        context.userId,
        config.key,
        config.deduplicationWindowMinutes,
      );
      if (!dedupCheck.allowed) {
        return dedupCheck;
      }
    }

    return { allowed: true };
  }

  /**
   * Check if current time is within work hours (7:30 - 18:00)
   *
   * @returns true if within work hours
   */
  isWithinWorkHours(): boolean {
    const now = new Date();

    // Get current time in Sao Paulo timezone
    const saoPauloTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const hours = saoPauloTime.getHours();
    const minutes = saoPauloTime.getMinutes();

    // Work hours: 7:30 (7.5) to 18:00 (18.0)
    const currentTimeInHours = hours + minutes / 60;
    const workStartHour = 7.5; // 7:30
    const workEndHour = 18.0; // 18:00

    const isWithinHours = currentTimeInHours >= workStartHour && currentTimeInHours < workEndHour;

    this.logger.debug(
      `Work hours check: ${hours}:${minutes.toString().padStart(2, '0')} - Within hours: ${isWithinHours}`,
    );

    return isWithinHours;
  }

  /**
   * Check frequency limit for a user and config
   *
   * @param userId - User ID
   * @param configKey - Configuration key
   * @param maxPerDay - Maximum notifications per day
   * @returns Check result
   */
  async checkFrequencyLimit(
    userId: string,
    configKey: string,
    maxPerDay: number,
  ): Promise<BusinessRulesCheckResult> {
    const trackingKey = `${userId}:${configKey}`;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Get timestamps from tracker
    let timestamps = this.frequencyTracker.get(trackingKey) || [];

    // Filter to only today's timestamps
    timestamps = timestamps.filter(ts => ts >= startOfDay);

    if (timestamps.length >= maxPerDay) {
      this.logger.debug(`Frequency limit reached for ${userId} and ${configKey}: ${timestamps.length}/${maxPerDay}`);
      return {
        allowed: false,
        reason: `Maximum notifications per day (${maxPerDay}) reached`,
      };
    }

    // Add current timestamp
    timestamps.push(now);
    this.frequencyTracker.set(trackingKey, timestamps);

    return { allowed: true };
  }

  /**
   * Check deduplication window for a user and config
   *
   * @param userId - User ID
   * @param configKey - Configuration key
   * @param windowMinutes - Deduplication window in minutes
   * @returns Check result
   */
  async checkDeduplication(
    userId: string,
    configKey: string,
    windowMinutes: number,
  ): Promise<BusinessRulesCheckResult> {
    const trackingKey = `dedup:${userId}:${configKey}`;
    const now = new Date();
    const lastSent = this.deduplicationTracker.get(trackingKey);

    if (lastSent) {
      const timeSinceLastMs = now.getTime() - lastSent.getTime();
      const windowMs = windowMinutes * 60 * 1000;

      if (timeSinceLastMs < windowMs) {
        const remainingMinutes = Math.ceil((windowMs - timeSinceLastMs) / 60000);
        this.logger.debug(
          `Deduplication check failed for ${userId} and ${configKey}: ${remainingMinutes} minutes remaining`,
        );
        return {
          allowed: false,
          reason: `Similar notification sent recently. Wait ${remainingMinutes} minutes.`,
        };
      }
    }

    // Update tracker
    this.deduplicationTracker.set(trackingKey, now);

    return { allowed: true };
  }

  // =====================
  // Template Rendering
  // =====================

  /**
   * Render templates for all configured channels
   *
   * @param config - Notification configuration
   * @param context - Template variables/context
   * @returns Rendered templates for each channel
   */
  renderTemplates(
    config: NotificationConfiguration,
    context: Record<string, any>,
  ): RenderedTemplates {
    const templates = config.templates;
    const rendered: RenderedTemplates = {};

    if (templates.inApp) {
      rendered.inApp = {
        title: this.renderTemplate(templates.inApp.title, context),
        body: this.renderTemplate(templates.inApp.body, context),
      };
    }

    if (templates.email) {
      rendered.email = {
        subject: this.renderTemplate(templates.email.subject, context),
        body: this.renderTemplate(templates.email.body, context),
        html: templates.email.html
          ? this.renderTemplate(templates.email.html, context)
          : undefined,
      };
    }

    if (templates.push) {
      rendered.push = {
        title: this.renderTemplate(templates.push.title, context),
        body: this.renderTemplate(templates.push.body, context),
      };
    }

    if (templates.whatsapp) {
      rendered.whatsapp = {
        body: this.renderTemplate(templates.whatsapp.body, context),
      };
    }

    return rendered;
  }

  /**
   * Render a single template string using Handlebars
   * Supports {{var}}, {{#if condition}}...{{/if}}, and other Handlebars syntax
   *
   * @param template - Template string with Handlebars syntax
   * @param variables - Variables to replace
   * @returns Rendered string
   */
  renderTemplate(template: string, variables: Record<string, any>): string {
    if (!template) {
      return '';
    }

    try {
      // Use Handlebars for rendering to support conditionals like {{#if serialNumber}}
      const compiled = Handlebars.compile(template, { strict: false });
      return compiled(variables);
    } catch (error) {
      this.logger.warn(`Error rendering template with Handlebars: ${error.message}`);
      // Fallback to simple replacement for backwards compatibility
      return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
        const value = path.split('.').reduce((obj: any, key: string) => {
          return obj && obj[key] !== undefined ? obj[key] : undefined;
        }, variables);

        if (value === undefined || value === null) {
          return '';
        }

        return String(value);
      });
    }
  }

  // =====================
  // Caching Methods
  // =====================

  /**
   * Get configuration from cache
   */
  private getFromCache(key: string): NotificationConfiguration | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Store configuration in cache
   */
  private setInCache(key: string, data: NotificationConfiguration): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });
  }

  /**
   * Invalidate cache for a specific key
   */
  public invalidateCache(key?: string): void {
    if (key) {
      this.cache.delete(key);
      this.logger.debug(`Cache invalidated for key: ${key}`);
    } else {
      this.cache.clear();
      this.logger.debug('Cache invalidated (all keys)');
    }
  }

  /**
   * Clear entire cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.debug('Cache cleared');
  }

  // =====================
  // Helper Methods
  // =====================

  /**
   * Map database entity to configuration interface
   */
  private mapToConfiguration(entity: any): NotificationConfiguration {
    // Extract default and mandatory channels from channelConfigs
    const channelConfigs = entity.channelConfigs || [];
    const defaultChannels = this.getDefaultChannelsFromConfigs(channelConfigs);
    const mandatoryChannels = this.getMandatoryChannelsFromConfigs(channelConfigs);

    // Check if any channel is mandatory to determine isMandatory
    const hasMandatoryChannels = mandatoryChannels.length > 0;

    // Merge targetRule into metadata for easy access by dispatch service
    const baseMetadata = (entity.metadata as Record<string, any>) || {};
    const targetRule = entity.targetRule
      ? {
          allowedSectors: entity.targetRule.allowedSectors || [],
          excludeInactive: entity.targetRule.excludeInactive ?? true,
          excludeOnVacation: entity.targetRule.excludeOnVacation ?? true,
          customFilter: entity.targetRule.customFilter || null,
        }
      : null;

    const metadata = targetRule
      ? { ...baseMetadata, targetRule }
      : baseMetadata;

    return {
      id: entity.id,
      key: entity.key,
      name: entity.name || entity.key,
      description: entity.description,
      notificationType: entity.notificationType as NOTIFICATION_TYPE,
      eventType: entity.eventType,
      defaultChannels: defaultChannels,
      mandatoryChannels: mandatoryChannels,
      importance: entity.importance as NOTIFICATION_IMPORTANCE,
      isEnabled: entity.enabled,
      isMandatory: hasMandatoryChannels,
      respectWorkHours: entity.workHoursOnly ?? false,
      maxPerDay: entity.maxFrequencyPerDay,
      deduplicationWindowMinutes: entity.deduplicationWindow,
      templates: (entity.templates as NotificationTemplateConfig) || {},
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * Extract default channels from channel configs
   */
  private getDefaultChannelsFromConfigs(channelConfigs: any[]): NOTIFICATION_CHANNEL[] {
    return channelConfigs
      .filter((config: any) => config.defaultOn && config.enabled)
      .map((config: any) => config.channel as NOTIFICATION_CHANNEL);
  }

  /**
   * Extract mandatory channels from channel configs
   */
  private getMandatoryChannelsFromConfigs(channelConfigs: any[]): NOTIFICATION_CHANNEL[] {
    return channelConfigs
      .filter((config: any) => config.mandatory && config.enabled)
      .map((config: any) => config.channel as NOTIFICATION_CHANNEL);
  }

  /**
   * Validate notification channels
   */
  private validateChannels(channels: NOTIFICATION_CHANNEL[]): void {
    const validChannels = Object.values(NOTIFICATION_CHANNEL);
    for (const channel of channels) {
      if (!validChannels.includes(channel)) {
        throw new BadRequestException(`Invalid notification channel: ${channel}`);
      }
    }
  }

  /**
   * Filter channels based on user's available contact methods
   */
  private filterValidChannelsForUser(
    channels: NOTIFICATION_CHANNEL[],
    user: User,
  ): NOTIFICATION_CHANNEL[] {
    return channels.filter(channel => {
      switch (channel) {
        case NOTIFICATION_CHANNEL.EMAIL:
          return !!user.email;
        case NOTIFICATION_CHANNEL.WHATSAPP:
          return !!user.phone;
        case NOTIFICATION_CHANNEL.IN_APP:
        case NOTIFICATION_CHANNEL.PUSH:
          return true; // Always available
        default:
          return false;
      }
    });
  }

  /**
   * Calculate the next work hour start time (7:30 AM)
   */
  private getNextWorkHourStart(): Date {
    const now = new Date();

    // Get current time in Sao Paulo timezone
    const saoPauloTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const hours = saoPauloTime.getHours();
    const minutes = saoPauloTime.getMinutes();

    // Create next 7:30 AM
    const next730 = new Date(saoPauloTime);
    next730.setHours(7, 30, 0, 0);

    // If we're past 7:30 today, schedule for tomorrow
    const currentTimeInHours = hours + minutes / 60;
    if (currentTimeInHours >= 7.5) {
      next730.setDate(next730.getDate() + 1);
    }

    return next730;
  }
}
