import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NotificationConfigurationRepository,
  NotificationConfiguration,
  ChannelConfiguration,
  SectorOverride,
  TargetRule,
  ConfigurationFilters,
  CreateNotificationConfigurationDto,
  UpdateNotificationConfigurationDto,
  ChannelConfigDto,
  SectorOverrideDto,
  TargetRuleDto,
} from './notification-configuration.repository';
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_CHANNEL,
  SECTOR_PRIVILEGES,
} from '../../../../constants';
import {
  Prisma,
  NotificationConfiguration as PrismaNotificationConfiguration,
  NotificationChannelConfig as PrismaNotificationChannelConfig,
  NotificationSectorOverride as PrismaNotificationSectorOverride,
  NotificationTargetRule as PrismaNotificationTargetRule,
  NotificationRule as PrismaNotificationRule,
  NotificationType,
  NotificationImportance,
  NotificationChannel,
  SectorPrivileges,
} from '@prisma/client';

// Type for full configuration with relations
type PrismaConfigurationWithRelations = PrismaNotificationConfiguration & {
  channelConfigs?: PrismaNotificationChannelConfig[];
  sectorOverrides?: PrismaNotificationSectorOverride[];
  targetRule?: PrismaNotificationTargetRule | null;
  rules?: PrismaNotificationRule[];
};

// Default include for fetching all relations
const DEFAULT_INCLUDE: Prisma.NotificationConfigurationInclude = {
  channelConfigs: true,
  sectorOverrides: true,
  targetRule: true,
  rules: true,
};

// Minimal include for listing operations
const MINIMAL_INCLUDE: Prisma.NotificationConfigurationInclude = {
  channelConfigs: true,
};

@Injectable()
export class NotificationConfigurationPrismaRepository
  implements NotificationConfigurationRepository
{
  private readonly logger = new Logger(NotificationConfigurationPrismaRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  // =====================
  // Query Methods
  // =====================

  async findByKey(key: string): Promise<NotificationConfiguration | null> {
    try {
      const configuration = await this.prisma.notificationConfiguration.findUnique({
        where: { key },
        include: DEFAULT_INCLUDE,
      });

      return configuration ? this.mapToEntity(configuration) : null;
    } catch (error) {
      this.logger.error(`Failed to find notification configuration by key: ${key}`, error);
      throw error;
    }
  }

  async findByTypeAndEvent(
    type: NOTIFICATION_TYPE,
    event?: string,
  ): Promise<NotificationConfiguration | null> {
    try {
      const configuration = await this.prisma.notificationConfiguration.findFirst({
        where: {
          notificationType: this.mapNotificationTypeToPrisma(type),
          ...(event !== undefined ? { eventType: event } : {}),
        },
        include: DEFAULT_INCLUDE,
      });

      return configuration ? this.mapToEntity(configuration) : null;
    } catch (error) {
      this.logger.error(
        `Failed to find notification configuration by type: ${type}, event: ${event}`,
        error,
      );
      throw error;
    }
  }

  async findAll(filters?: ConfigurationFilters): Promise<NotificationConfiguration[]> {
    try {
      const where = this.buildWhereClause(filters);

      const configurations = await this.prisma.notificationConfiguration.findMany({
        where,
        include: MINIMAL_INCLUDE,
        orderBy: [{ notificationType: 'asc' }, { key: 'asc' }],
      });

      return configurations.map(config => this.mapToEntity(config));
    } catch (error) {
      this.logger.error('Failed to find all notification configurations', error);
      throw error;
    }
  }

  async findEnabled(): Promise<NotificationConfiguration[]> {
    try {
      const configurations = await this.prisma.notificationConfiguration.findMany({
        where: { enabled: true },
        include: MINIMAL_INCLUDE,
        orderBy: [{ notificationType: 'asc' }, { key: 'asc' }],
      });

      return configurations.map(config => this.mapToEntity(config));
    } catch (error) {
      this.logger.error('Failed to find enabled notification configurations', error);
      throw error;
    }
  }

  async findWithChannelConfigs(id: string): Promise<NotificationConfiguration | null> {
    try {
      const configuration = await this.prisma.notificationConfiguration.findUnique({
        where: { id },
        include: {
          channelConfigs: true,
        },
      });

      return configuration ? this.mapToEntity(configuration) : null;
    } catch (error) {
      this.logger.error(`Failed to find notification configuration with channel configs: ${id}`, error);
      throw error;
    }
  }

  async findBySector(sector: SECTOR_PRIVILEGES): Promise<NotificationConfiguration[]> {
    try {
      // Find configurations where the target rule includes this sector in allowedSectors
      const configurations = await this.prisma.notificationConfiguration.findMany({
        where: {
          enabled: true,
          targetRule: {
            allowedSectors: {
              has: this.mapSectorPrivilegesToPrisma(sector),
            },
          },
        },
        include: DEFAULT_INCLUDE,
        orderBy: [{ notificationType: 'asc' }, { key: 'asc' }],
      });

      return configurations.map(config => this.mapToEntity(config));
    } catch (error) {
      this.logger.error(`Failed to find notification configurations by sector: ${sector}`, error);
      throw error;
    }
  }

  // =====================
  // Create Method
  // =====================

  async create(data: CreateNotificationConfigurationDto): Promise<NotificationConfiguration> {
    try {
      const configuration = await this.prisma.$transaction(async tx => {
        // Create the main configuration
        const config = await tx.notificationConfiguration.create({
          data: {
            key: data.key,
            notificationType: this.mapNotificationTypeToPrisma(data.notificationType),
            eventType: data.eventType || '',
            description: data.description || null,
            enabled: data.enabled ?? true,
            importance: this.mapNotificationImportanceToPrisma(data.defaultImportance),
            metadata: data.metadata ? (data.metadata as Prisma.JsonObject) : null,
          },
          include: DEFAULT_INCLUDE,
        });

        // Create default channel configs based on defaultChannels
        if (data.defaultChannels && data.defaultChannels.length > 0) {
          await tx.notificationChannelConfig.createMany({
            data: data.defaultChannels.map(channel => ({
              configurationId: config.id,
              channel: this.mapNotificationChannelToPrisma(channel),
              enabled: true,
              mandatory: false,
              defaultOn: true,
            })),
          });
        }

        // Fetch the complete configuration with all relations
        return tx.notificationConfiguration.findUnique({
          where: { id: config.id },
          include: DEFAULT_INCLUDE,
        });
      });

      if (!configuration) {
        throw new Error('Failed to create notification configuration');
      }

      return this.mapToEntity(configuration);
    } catch (error) {
      this.logger.error('Failed to create notification configuration', error);
      throw error;
    }
  }

  // =====================
  // Update Method
  // =====================

  async update(
    id: string,
    data: UpdateNotificationConfigurationDto,
  ): Promise<NotificationConfiguration> {
    try {
      const configuration = await this.prisma.$transaction(async tx => {
        // Build update data
        const updateData: Prisma.NotificationConfigurationUpdateInput = {};

        if (data.key !== undefined) updateData.key = data.key;
        if (data.notificationType !== undefined) {
          updateData.notificationType = this.mapNotificationTypeToPrisma(data.notificationType);
        }
        if (data.eventType !== undefined) updateData.eventType = data.eventType || '';
        if (data.title !== undefined) {
          // Note: 'title' field doesn't exist in Prisma schema, storing in metadata
          updateData.metadata = { ...(updateData.metadata as object || {}), title: data.title };
        }
        if (data.description !== undefined) updateData.description = data.description;
        if (data.defaultImportance !== undefined) {
          updateData.importance = this.mapNotificationImportanceToPrisma(data.defaultImportance);
        }
        if (data.enabled !== undefined) updateData.enabled = data.enabled;
        if (data.metadata !== undefined) {
          updateData.metadata = data.metadata ? (data.metadata as Prisma.JsonObject) : null;
        }

        // Update the main configuration
        const config = await tx.notificationConfiguration.update({
          where: { id },
          data: updateData,
          include: DEFAULT_INCLUDE,
        });

        // If defaultChannels is provided, update channel configs
        if (data.defaultChannels !== undefined) {
          // Delete existing channel configs
          await tx.notificationChannelConfig.deleteMany({
            where: { configurationId: id },
          });

          // Create new channel configs
          if (data.defaultChannels.length > 0) {
            await tx.notificationChannelConfig.createMany({
              data: data.defaultChannels.map(channel => ({
                configurationId: id,
                channel: this.mapNotificationChannelToPrisma(channel),
                enabled: true,
                mandatory: false,
                defaultOn: true,
              })),
            });
          }
        }

        // Fetch the complete configuration with all relations
        return tx.notificationConfiguration.findUnique({
          where: { id },
          include: DEFAULT_INCLUDE,
        });
      });

      if (!configuration) {
        throw new Error(`Notification configuration not found: ${id}`);
      }

      return this.mapToEntity(configuration);
    } catch (error) {
      this.logger.error(`Failed to update notification configuration: ${id}`, error);
      throw error;
    }
  }

  // =====================
  // Delete Method
  // =====================

  async delete(id: string): Promise<void> {
    try {
      // Cascade delete is handled by Prisma schema (onDelete: Cascade)
      await this.prisma.notificationConfiguration.delete({
        where: { id },
      });
    } catch (error) {
      this.logger.error(`Failed to delete notification configuration: ${id}`, error);
      throw error;
    }
  }

  // =====================
  // Channel Config Methods
  // =====================

  async upsertChannelConfig(configId: string, channelConfig: ChannelConfigDto): Promise<void> {
    try {
      await this.prisma.notificationChannelConfig.upsert({
        where: {
          configurationId_channel: {
            configurationId: configId,
            channel: this.mapNotificationChannelToPrisma(channelConfig.channel),
          },
        },
        create: {
          configurationId: configId,
          channel: this.mapNotificationChannelToPrisma(channelConfig.channel),
          enabled: channelConfig.enabled,
          mandatory: false,
          defaultOn: true,
        },
        update: {
          enabled: channelConfig.enabled,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to upsert channel config for configuration: ${configId}`,
        error,
      );
      throw error;
    }
  }

  // =====================
  // Sector Override Methods
  // =====================

  async upsertSectorOverride(configId: string, override: SectorOverrideDto): Promise<void> {
    try {
      const sectorValue = this.mapSectorPrivilegesToPrisma(override.sector);

      await this.prisma.notificationSectorOverride.upsert({
        where: {
          configurationId_sector: {
            configurationId: configId,
            sector: sectorValue,
          },
        },
        create: {
          configurationId: configId,
          sector: sectorValue,
          importanceOverride: override.importance
            ? this.mapNotificationImportanceToPrisma(override.importance)
            : null,
          channelOverrides: override.channels
            ? (override.channels.map(ch => this.mapNotificationChannelToPrisma(ch)) as unknown as Prisma.JsonValue)
            : null,
        },
        update: {
          importanceOverride: override.importance
            ? this.mapNotificationImportanceToPrisma(override.importance)
            : null,
          channelOverrides: override.channels
            ? (override.channels.map(ch => this.mapNotificationChannelToPrisma(ch)) as unknown as Prisma.JsonValue)
            : null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to upsert sector override for configuration: ${configId}`,
        error,
      );
      throw error;
    }
  }

  // =====================
  // Target Rule Methods
  // =====================

  async updateTargetRule(configId: string, targetRule: TargetRuleDto): Promise<void> {
    try {
      await this.prisma.$transaction(async tx => {
        // Check if target rule exists
        const existingRule = await tx.notificationTargetRule.findUnique({
          where: { configurationId: configId },
        });

        const allowedSectors = targetRule.targetSectors
          ? targetRule.targetSectors.map(s => this.mapSectorPrivilegesToPrisma(s))
          : [];

        if (existingRule) {
          // Update existing rule
          await tx.notificationTargetRule.update({
            where: { configurationId: configId },
            data: {
              allowedSectors: allowedSectors,
              customFilter: targetRule.customQuery || null,
            },
          });
        } else {
          // Create new rule
          await tx.notificationTargetRule.create({
            data: {
              configurationId: configId,
              allowedSectors: allowedSectors,
              excludeInactive: true,
              excludeOnVacation: true,
              customFilter: targetRule.customQuery || null,
            },
          });
        }
      });
    } catch (error) {
      this.logger.error(
        `Failed to update target rule for configuration: ${configId}`,
        error,
      );
      throw error;
    }
  }

  // =====================
  // Private Helper Methods
  // =====================

  private buildWhereClause(
    filters?: ConfigurationFilters,
  ): Prisma.NotificationConfigurationWhereInput {
    if (!filters) return {};

    const where: Prisma.NotificationConfigurationWhereInput = {};

    if (filters.notificationType !== undefined) {
      where.notificationType = this.mapNotificationTypeToPrisma(filters.notificationType);
    }

    if (filters.enabled !== undefined) {
      where.enabled = filters.enabled;
    }

    if (filters.importance !== undefined) {
      where.importance = this.mapNotificationImportanceToPrisma(filters.importance);
    }

    if (filters.search) {
      where.OR = [
        { key: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private mapToEntity(
    prismaEntity: PrismaConfigurationWithRelations,
  ): NotificationConfiguration {
    // Map channel configs
    const channelConfigs: ChannelConfiguration[] = (prismaEntity.channelConfigs || []).map(
      cc => ({
        id: cc.id,
        configurationId: cc.configurationId,
        channel: cc.channel as NOTIFICATION_CHANNEL,
        enabled: cc.enabled,
        templateId: null,
        settings: null,
        createdAt: cc.createdAt,
        updatedAt: cc.updatedAt,
      }),
    );

    // Map sector overrides
    const sectorOverrides: SectorOverride[] = (prismaEntity.sectorOverrides || []).map(so => ({
      id: so.id,
      configurationId: so.configurationId,
      sector: so.sector as SECTOR_PRIVILEGES,
      importance: so.importanceOverride as NOTIFICATION_IMPORTANCE | null,
      channels: so.channelOverrides
        ? (so.channelOverrides as string[]).map(ch => ch as NOTIFICATION_CHANNEL)
        : null,
      enabled: null,
      createdAt: so.createdAt,
      updatedAt: so.updatedAt,
    }));

    // Map target rule
    let targetRule: TargetRule | null = null;
    if (prismaEntity.targetRule) {
      const tr = prismaEntity.targetRule;
      targetRule = {
        id: tr.id,
        configurationId: tr.configurationId,
        targetType: 'SECTOR',
        targetIds: null,
        targetSectors: tr.allowedSectors as SECTOR_PRIVILEGES[],
        excludeIds: null,
        customQuery: tr.customFilter,
        createdAt: tr.createdAt,
        updatedAt: tr.updatedAt,
      };
    }

    // Extract default channels from channel configs
    const defaultChannels = channelConfigs
      .filter(cc => cc.enabled)
      .map(cc => cc.channel);

    // Extract title from metadata if available
    const metadata = prismaEntity.metadata as Record<string, unknown> | null;
    const title = metadata?.title as string || prismaEntity.key;

    return {
      id: prismaEntity.id,
      key: prismaEntity.key,
      notificationType: prismaEntity.notificationType as NOTIFICATION_TYPE,
      eventType: prismaEntity.eventType || null,
      title: title,
      description: prismaEntity.description,
      defaultImportance: prismaEntity.importance as NOTIFICATION_IMPORTANCE,
      defaultChannels: defaultChannels,
      enabled: prismaEntity.enabled,
      allowUserOverride: true, // Default value, can be stored in metadata if needed
      metadata: metadata,
      createdAt: prismaEntity.createdAt,
      updatedAt: prismaEntity.updatedAt,
      channelConfigs: channelConfigs,
      sectorOverrides: sectorOverrides,
      targetRule: targetRule,
    };
  }

  // =====================
  // Enum Mapping Methods
  // =====================

  private mapNotificationTypeToPrisma(type: NOTIFICATION_TYPE): NotificationType {
    return type as NotificationType;
  }

  private mapNotificationImportanceToPrisma(
    importance: NOTIFICATION_IMPORTANCE,
  ): NotificationImportance {
    return importance as NotificationImportance;
  }

  private mapNotificationChannelToPrisma(channel: NOTIFICATION_CHANNEL): NotificationChannel {
    return channel as NotificationChannel;
  }

  private mapSectorPrivilegesToPrisma(sector: SECTOR_PRIVILEGES): SectorPrivileges {
    return sector as SectorPrivileges;
  }
}
