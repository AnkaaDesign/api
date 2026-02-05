import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserId } from '../auth/decorators/user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import {
  SECTOR_PRIVILEGES,
  NOTIFICATION_TYPE,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_CHANNEL,
} from '../../../constants';

// =====================
// DTOs
// =====================

/**
 * Filter DTO for listing notification configurations
 */
interface NotificationConfigurationFiltersDto {
  notificationType?: NOTIFICATION_TYPE;
  enabled?: boolean;
  importance?: NOTIFICATION_IMPORTANCE;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * DTO for creating a notification configuration
 */
interface CreateNotificationConfigurationDto {
  key: string;
  notificationType: NOTIFICATION_TYPE;
  eventType: string;
  description?: string;
  enabled?: boolean;
  importance?: NOTIFICATION_IMPORTANCE;
  workHoursOnly?: boolean;
  batchingEnabled?: boolean;
  maxFrequencyPerDay?: number;
  deduplicationWindow?: number;
  templates?: Record<string, any>;
  metadata?: Record<string, any>;
  channels?: Array<{
    channel: NOTIFICATION_CHANNEL;
    enabled: boolean;
    mandatory: boolean;
    defaultOn: boolean;
    minImportance?: NOTIFICATION_IMPORTANCE;
  }>;
  targetRules?: {
    allowedSectors?: SECTOR_PRIVILEGES[];
    excludeInactive?: boolean;
    excludeOnVacation?: boolean;
    customFilter?: string;
  };
}

/**
 * DTO for updating a notification configuration
 */
interface UpdateNotificationConfigurationDto {
  key?: string;
  notificationType?: NOTIFICATION_TYPE;
  eventType?: string;
  description?: string;
  enabled?: boolean;
  importance?: NOTIFICATION_IMPORTANCE;
  workHoursOnly?: boolean;
  batchingEnabled?: boolean;
  maxFrequencyPerDay?: number;
  deduplicationWindow?: number;
  templates?: Record<string, any>;
  metadata?: Record<string, any>;
}

/**
 * DTO for testing a configuration
 */
interface TestConfigurationDto {
  templateVariables?: Record<string, any>;
  targetUserIds?: string[];
  targetSectorIds?: string[];
}

/**
 * DTO for sending notification by configuration
 */
interface SendByConfigurationDto {
  userId?: string;
  userIds?: string[];
  sectorId?: string;
  sectorIds?: string[];
  templateVariables?: Record<string, any>;
  actionUrl?: string;
  importanceOverride?: NOTIFICATION_IMPORTANCE;
  channelOverride?: NOTIFICATION_CHANNEL[];
  forceSend?: boolean;
  scheduledAt?: string;
  metadata?: Record<string, any>;
}

/**
 * DTO for updating channel config
 */
interface UpdateChannelConfigDto {
  enabled?: boolean;
  mandatory?: boolean;
  defaultOn?: boolean;
  minImportance?: NOTIFICATION_IMPORTANCE;
}

/**
 * DTO for updating sector override
 */
interface UpdateSectorOverrideDto {
  channelOverrides?: Record<string, any>;
  importanceOverride?: NOTIFICATION_IMPORTANCE;
}

/**
 * Admin Controller for Notification Configuration Management
 * Provides CRUD endpoints for managing notification configurations
 *
 * @security Admin-only access - all endpoints require ADMIN privileges
 */
@ApiTags('Admin - Notification Configurations')
@ApiBearerAuth()
@Controller('api/notification-configurations')
@UseGuards(AuthGuard)
export class NotificationConfigurationController {
  private readonly logger = new Logger(NotificationConfigurationController.name);

  constructor(private readonly prisma: PrismaService) {}

  // =====================
  // CRUD Operations
  // =====================

  /**
   * POST /api/notification-configurations
   * Create a new notification configuration
   */
  @Post()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create notification configuration (Admin)',
    description: 'Create a new notification configuration with channel settings and targeting rules',
  })
  @ApiBody({ description: 'Configuration data' })
  @ApiResponse({ status: 201, description: 'Configuration created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation error' })
  @ApiResponse({ status: 409, description: 'Configuration key already exists' })
  async create(
    @Body() dto: CreateNotificationConfigurationDto,
    @UserId() userId: string,
  ) {
    try {
      this.logger.log(`Creating notification configuration: ${dto.key}`, { userId });

      // Check if key already exists
      const existingConfig = await this.prisma.notificationConfiguration.findUnique({
        where: { key: dto.key },
      });

      if (existingConfig) {
        throw new BadRequestException(
          `Configuração com a chave "${dto.key}" já existe.`,
        );
      }

      // Create configuration with related data
      const configuration = await this.prisma.$transaction(async (tx) => {
        // Create the main configuration
        const config = await tx.notificationConfiguration.create({
          data: {
            key: dto.key,
            notificationType: dto.notificationType,
            eventType: dto.eventType,
            description: dto.description,
            enabled: dto.enabled ?? true,
            importance: dto.importance ?? NOTIFICATION_IMPORTANCE.NORMAL,
            workHoursOnly: dto.workHoursOnly ?? false,
            batchingEnabled: dto.batchingEnabled ?? false,
            maxFrequencyPerDay: dto.maxFrequencyPerDay,
            deduplicationWindow: dto.deduplicationWindow,
            templates: dto.templates ?? null,
            metadata: dto.metadata ?? null,
          },
        });

        // Create channel configurations if provided
        if (dto.channels && dto.channels.length > 0) {
          await tx.notificationChannelConfig.createMany({
            data: dto.channels.map((channel) => ({
              configurationId: config.id,
              channel: channel.channel,
              enabled: channel.enabled,
              mandatory: channel.mandatory,
              defaultOn: channel.defaultOn,
              minImportance: channel.minImportance,
            })),
          });
        }

        // Create target rules if provided
        if (dto.targetRules) {
          await tx.notificationTargetRule.create({
            data: {
              configurationId: config.id,
              allowedSectors: dto.targetRules.allowedSectors ?? [],
              excludeInactive: dto.targetRules.excludeInactive ?? true,
              excludeOnVacation: dto.targetRules.excludeOnVacation ?? true,
              customFilter: dto.targetRules.customFilter,
            },
          });
        }

        // Fetch the complete configuration with relations
        return tx.notificationConfiguration.findUnique({
          where: { id: config.id },
          include: {
            channelConfigs: true,
            sectorOverrides: true,
            targetRule: true,
          },
        });
      });

      return {
        success: true,
        data: configuration,
        message: 'Configuração de notificação criada com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Error creating notification configuration:', error);
      throw new InternalServerErrorException(
        'Erro ao criar configuração de notificação. Tente novamente.',
      );
    }
  }

  /**
   * GET /api/notification-configurations
   * List all notification configurations with filtering
   */
  @Get()
  @ApiOperation({
    summary: 'List notification configurations',
    description: 'Retrieve notification configurations with optional filtering',
  })
  @ApiQuery({
    name: 'notificationType',
    required: false,
    enum: NOTIFICATION_TYPE,
    description: 'Filter by notification type',
  })
  @ApiQuery({
    name: 'enabled',
    required: false,
    type: Boolean,
    description: 'Filter by enabled status',
  })
  @ApiQuery({
    name: 'importance',
    required: false,
    enum: NOTIFICATION_IMPORTANCE,
    description: 'Filter by importance level',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search in key, description, and eventType',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 20)',
  })
  @ApiResponse({ status: 200, description: 'Configurations retrieved successfully' })
  async findAll(@Query() filters: NotificationConfigurationFiltersDto) {
    try {
      const {
        notificationType,
        enabled,
        importance,
        search,
        page = 1,
        limit = 20,
      } = filters;

      // Build where clause
      const where: any = {};
      const andConditions: any[] = [];

      if (notificationType) {
        where.notificationType = notificationType;
      }

      if (enabled !== undefined) {
        where.enabled = enabled === true || enabled === 'true' as any;
      }

      if (importance) {
        where.importance = importance;
      }

      if (search && search.trim()) {
        const searchTerm = search.trim();
        andConditions.push({
          OR: [
            { key: { contains: searchTerm, mode: 'insensitive' } },
            { description: { contains: searchTerm, mode: 'insensitive' } },
            { eventType: { contains: searchTerm, mode: 'insensitive' } },
          ],
        });
      }

      if (andConditions.length > 0) {
        where.AND = andConditions;
      }

      // Calculate pagination
      const skip = (page - 1) * limit;

      // Execute query
      const [configurations, total] = await Promise.all([
        this.prisma.notificationConfiguration.findMany({
          where,
          include: {
            channelConfigs: true,
            sectorOverrides: true,
            targetRule: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.notificationConfiguration.count({ where }),
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        success: true,
        data: configurations,
        meta: {
          total,
          page,
          limit,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
        message: 'Configurações carregadas com sucesso.',
      };
    } catch (error) {
      this.logger.error('Error listing notification configurations:', error);
      throw new InternalServerErrorException(
        'Erro ao listar configurações de notificação. Tente novamente.',
      );
    }
  }

  /**
   * GET /api/notification-configurations/:key
   * Get a single notification configuration by key
   */
  @Get(':key')
  @ApiOperation({
    summary: 'Get notification configuration by key',
    description: 'Retrieve a specific notification configuration by its unique key',
  })
  @ApiParam({ name: 'key', description: 'Configuration unique key' })
  @ApiResponse({ status: 200, description: 'Configuration retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  async findByKey(@Param('key') key: string) {
    try {
      const configuration = await this.prisma.notificationConfiguration.findUnique({
        where: { key },
        include: {
          channelConfigs: true,
          sectorOverrides: true,
          targetRule: true,
          rules: true,
        },
      });

      if (!configuration) {
        throw new NotFoundException(
          `Configuração com a chave "${key}" não encontrada.`,
        );
      }

      return {
        success: true,
        data: configuration,
        message: 'Configuração carregada com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error getting notification configuration ${key}:`, error);
      throw new InternalServerErrorException(
        'Erro ao buscar configuração de notificação. Tente novamente.',
      );
    }
  }

  /**
   * PUT /api/notification-configurations/:id
   * Update a notification configuration
   */
  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update notification configuration (Admin)',
    description: 'Update an existing notification configuration',
  })
  @ApiParam({ name: 'id', description: 'Configuration UUID' })
  @ApiBody({ description: 'Updated configuration data' })
  @ApiResponse({ status: 200, description: 'Configuration updated successfully' })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNotificationConfigurationDto,
    @UserId() userId: string,
  ) {
    try {
      this.logger.log(`Updating notification configuration: ${id}`, { userId });

      // Check if configuration exists
      const existingConfig = await this.prisma.notificationConfiguration.findUnique({
        where: { id },
      });

      if (!existingConfig) {
        throw new NotFoundException(
          'Configuração de notificação não encontrada.',
        );
      }

      // Check for key uniqueness if being changed
      if (dto.key && dto.key !== existingConfig.key) {
        const keyExists = await this.prisma.notificationConfiguration.findUnique({
          where: { key: dto.key },
        });

        if (keyExists) {
          throw new BadRequestException(
            `Configuração com a chave "${dto.key}" já existe.`,
          );
        }
      }

      // Update configuration
      const configuration = await this.prisma.notificationConfiguration.update({
        where: { id },
        data: {
          key: dto.key,
          notificationType: dto.notificationType,
          eventType: dto.eventType,
          description: dto.description,
          enabled: dto.enabled,
          importance: dto.importance,
          workHoursOnly: dto.workHoursOnly,
          batchingEnabled: dto.batchingEnabled,
          maxFrequencyPerDay: dto.maxFrequencyPerDay,
          deduplicationWindow: dto.deduplicationWindow,
          templates: dto.templates,
          metadata: dto.metadata,
        },
        include: {
          channelConfigs: true,
          sectorOverrides: true,
          targetRule: true,
        },
      });

      return {
        success: true,
        data: configuration,
        message: 'Configuração de notificação atualizada com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error updating notification configuration ${id}:`, error);
      throw new InternalServerErrorException(
        'Erro ao atualizar configuração de notificação. Tente novamente.',
      );
    }
  }

  /**
   * DELETE /api/notification-configurations/:id
   * Delete a notification configuration
   */
  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete notification configuration (Admin)',
    description: 'Delete an existing notification configuration and all related data',
  })
  @ApiParam({ name: 'id', description: 'Configuration UUID' })
  @ApiResponse({ status: 200, description: 'Configuration deleted successfully' })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ) {
    try {
      this.logger.log(`Deleting notification configuration: ${id}`, { userId });

      // Check if configuration exists
      const existingConfig = await this.prisma.notificationConfiguration.findUnique({
        where: { id },
      });

      if (!existingConfig) {
        throw new NotFoundException(
          'Configuração de notificação não encontrada.',
        );
      }

      // Delete configuration (cascades to related records)
      await this.prisma.$transaction(async (tx) => {
        // Delete related channel configs
        await tx.notificationChannelConfig.deleteMany({
          where: { configurationId: id },
        });

        // Delete related sector overrides
        await tx.notificationSectorOverride.deleteMany({
          where: { configurationId: id },
        });

        // Delete related target rules
        await tx.notificationTargetRule.deleteMany({
          where: { configurationId: id },
        });

        // Delete related rules
        await tx.notificationRule.deleteMany({
          where: { configurationId: id },
        });

        // Delete the main configuration
        await tx.notificationConfiguration.delete({
          where: { id },
        });
      });

      return {
        success: true,
        message: 'Configuração de notificação excluída com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error deleting notification configuration ${id}:`, error);
      throw new InternalServerErrorException(
        'Erro ao excluir configuração de notificação. Tente novamente.',
      );
    }
  }

  // =====================
  // Test & Send Operations
  // =====================

  /**
   * POST /api/notification-configurations/:key/test
   * Test a notification configuration (dry run)
   */
  @Post(':key/test')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test notification configuration (Admin)',
    description:
      'Test a configuration without sending - returns recipients, channels, and rendered templates',
  })
  @ApiParam({ name: 'key', description: 'Configuration unique key' })
  @ApiBody({ description: 'Test parameters including template variables' })
  @ApiResponse({ status: 200, description: 'Test results returned successfully' })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  async testConfiguration(
    @Param('key') key: string,
    @Body() testDto: TestConfigurationDto,
  ) {
    try {
      // Find configuration
      const configuration = await this.prisma.notificationConfiguration.findUnique({
        where: { key },
        include: {
          channelConfigs: true,
          sectorOverrides: true,
          targetRule: true,
        },
      });

      if (!configuration) {
        throw new NotFoundException(
          `Configuração com a chave "${key}" não encontrada.`,
        );
      }

      // Determine target users
      let targetUsers: any[] = [];

      if (testDto.targetUserIds && testDto.targetUserIds.length > 0) {
        targetUsers = await this.prisma.user.findMany({
          where: {
            id: { in: testDto.targetUserIds },
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            sector: {
              select: {
                id: true,
                name: true,
                privileges: true,
              },
            },
          },
        });
      } else if (testDto.targetSectorIds && testDto.targetSectorIds.length > 0) {
        targetUsers = await this.prisma.user.findMany({
          where: {
            sectorId: { in: testDto.targetSectorIds },
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            sector: {
              select: {
                id: true,
                name: true,
                privileges: true,
              },
            },
          },
        });
      } else if (configuration.targetRule) {
        // Use target rules to determine recipients
        const whereClause: any = { isActive: true };

        if (
          configuration.targetRule.allowedSectors &&
          configuration.targetRule.allowedSectors.length > 0
        ) {
          whereClause.sector = {
            privileges: { in: configuration.targetRule.allowedSectors },
          };
        }

        if (configuration.targetRule.excludeInactive) {
          whereClause.isActive = true;
        }

        if (configuration.targetRule.excludeOnVacation) {
          // Exclude users who have an active vacation (approved/in-progress covering current date)
          const now = new Date();
          whereClause.vacations = {
            none: {
              status: { in: ['APPROVED', 'IN_PROGRESS'] },
              startAt: { lte: now },
              endAt: { gte: now },
            },
          };
        }

        targetUsers = await this.prisma.user.findMany({
          where: whereClause,
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            sector: {
              select: {
                id: true,
                name: true,
                privileges: true,
              },
            },
          },
          take: 100, // Limit for testing
        });
      }

      // Build channel information per user
      const recipientDetails = await Promise.all(
        targetUsers.map(async (user) => {
          // Get user's notification preferences
          const preferences = await this.prisma.userNotificationPreference.findMany({
            where: {
              userId: user.id,
              notificationType: configuration.notificationType,
            },
          });

          // Determine which channels would be used
          const channels = configuration.channelConfigs
            .filter((cc) => cc.enabled)
            .map((cc) => {
              const userPref = preferences.find((p) =>
                p.channels.includes(cc.channel),
              );
              return {
                channel: cc.channel,
                mandatory: cc.mandatory,
                defaultOn: cc.defaultOn,
                userEnabled: userPref ? true : cc.defaultOn,
                wouldSend: cc.mandatory || (userPref ? true : cc.defaultOn),
              };
            });

          return {
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              sector: user.sector?.name,
            },
            channels,
          };
        }),
      );

      // Render templates (if templates exist in configuration)
      let renderedTemplates: Record<string, any> | null = null;
      if (configuration.templates && testDto.templateVariables) {
        renderedTemplates = this.renderTemplates(
          configuration.templates as Record<string, any>,
          testDto.templateVariables,
        );
      }

      return {
        success: true,
        data: {
          configuration: {
            key: configuration.key,
            notificationType: configuration.notificationType,
            eventType: configuration.eventType,
            importance: configuration.importance,
            enabled: configuration.enabled,
          },
          testResults: {
            totalRecipients: recipientDetails.length,
            recipients: recipientDetails,
            renderedTemplates,
            channelSummary: this.summarizeChannels(recipientDetails),
          },
        },
        message: 'Teste de configuração executado com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error testing notification configuration ${key}:`, error);
      throw new InternalServerErrorException(
        'Erro ao testar configuração de notificação. Tente novamente.',
      );
    }
  }

  /**
   * POST /api/notification-configurations/:key/send
   * Manually trigger a notification using a configuration
   */
  @Post(':key/send')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send notification by configuration (Admin)',
    description: 'Manually trigger a notification using the specified configuration',
  })
  @ApiParam({ name: 'key', description: 'Configuration unique key' })
  @ApiBody({ description: 'Context data for the notification' })
  @ApiResponse({ status: 200, description: 'Notification triggered successfully' })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  @ApiResponse({ status: 400, description: 'Configuration is disabled' })
  async sendByConfiguration(
    @Param('key') key: string,
    @Body() contextDto: SendByConfigurationDto,
    @UserId() userId: string,
  ) {
    try {
      this.logger.log(`Sending notification by configuration: ${key}`, { userId });

      // Find configuration
      const configuration = await this.prisma.notificationConfiguration.findUnique({
        where: { key },
        include: {
          channelConfigs: true,
          targetRule: true,
        },
      });

      if (!configuration) {
        throw new NotFoundException(
          `Configuração com a chave "${key}" não encontrada.`,
        );
      }

      if (!configuration.enabled && !contextDto.forceSend) {
        throw new BadRequestException(
          'Esta configuração está desabilitada. Use forceSend: true para enviar mesmo assim.',
        );
      }

      // Determine target users
      let targetUserIds: string[] = [];

      if (contextDto.userId) {
        targetUserIds = [contextDto.userId];
      } else if (contextDto.userIds && contextDto.userIds.length > 0) {
        targetUserIds = contextDto.userIds;
      } else if (contextDto.sectorId || (contextDto.sectorIds && contextDto.sectorIds.length > 0)) {
        const sectorIds = contextDto.sectorIds || [contextDto.sectorId!];
        const users = await this.prisma.user.findMany({
          where: {
            sectorId: { in: sectorIds },
            isActive: true,
          },
          select: { id: true },
        });
        targetUserIds = users.map((u) => u.id);
      } else if (configuration.targetRule) {
        // Use target rules
        const whereClause: any = { isActive: true };

        if (
          configuration.targetRule.allowedSectors &&
          configuration.targetRule.allowedSectors.length > 0
        ) {
          whereClause.sectorId = { in: configuration.targetRule.allowedSectors };
        }

        const users = await this.prisma.user.findMany({
          where: whereClause,
          select: { id: true },
        });
        targetUserIds = users.map((u) => u.id);
      }

      if (targetUserIds.length === 0) {
        throw new BadRequestException(
          'Nenhum destinatário encontrado para esta configuração.',
        );
      }

      // Determine channels to use
      const channels =
        contextDto.channelOverride ||
        configuration.channelConfigs
          .filter((cc) => cc.enabled)
          .map((cc) => cc.channel as NOTIFICATION_CHANNEL);

      // Render templates
      let title = `[${configuration.notificationType}] ${configuration.eventType}`;
      let body = configuration.description || 'Nova notificação';

      if (configuration.templates && contextDto.templateVariables) {
        const rendered = this.renderTemplates(
          configuration.templates as Record<string, any>,
          contextDto.templateVariables,
        );
        if (rendered.title) title = rendered.title;
        if (rendered.body) body = rendered.body;
      }

      // Create notifications for each user
      const createdNotifications = await this.prisma.$transaction(async (tx) => {
        const notifications = [];

        for (const targetUserId of targetUserIds) {
          const notification = await tx.notification.create({
            data: {
              userId: targetUserId,
              title,
              body,
              type: configuration.notificationType,
              importance: contextDto.importanceOverride || configuration.importance,
              channel: channels,
              actionUrl: contextDto.actionUrl,
              scheduledAt: contextDto.scheduledAt ? new Date(contextDto.scheduledAt) : null,
              metadata: contextDto.metadata ?? null,
            },
          });
          notifications.push(notification);
        }

        return notifications;
      });

      return {
        success: true,
        data: {
          configurationKey: key,
          notificationsCreated: createdNotifications.length,
          targetUserIds,
          channels,
          scheduledAt: contextDto.scheduledAt || null,
          notifications: createdNotifications.slice(0, 10), // Return first 10 for preview
        },
        message: contextDto.scheduledAt
          ? `${createdNotifications.length} notificações agendadas com sucesso.`
          : `${createdNotifications.length} notificações criadas com sucesso.`,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error sending notification by configuration ${key}:`, error);
      throw new InternalServerErrorException(
        'Erro ao enviar notificação. Tente novamente.',
      );
    }
  }

  // =====================
  // Channel & Sector Override Operations
  // =====================

  /**
   * PUT /api/notification-configurations/:id/channels/:channel
   * Update a specific channel configuration
   */
  @Put(':id/channels/:channel')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update channel configuration (Admin)',
    description: 'Update settings for a specific notification channel',
  })
  @ApiParam({ name: 'id', description: 'Configuration UUID' })
  @ApiParam({ name: 'channel', description: 'Channel name (IN_APP, PUSH, EMAIL, WHATSAPP)' })
  @ApiBody({ description: 'Channel configuration updates' })
  @ApiResponse({ status: 200, description: 'Channel configuration updated successfully' })
  @ApiResponse({ status: 404, description: 'Configuration or channel not found' })
  async updateChannelConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('channel') channel: string,
    @Body() dto: UpdateChannelConfigDto,
  ) {
    try {
      // Validate channel
      if (!Object.values(NOTIFICATION_CHANNEL).includes(channel as NOTIFICATION_CHANNEL)) {
        throw new BadRequestException(`Canal inválido: ${channel}`);
      }

      // Check if configuration exists
      const configuration = await this.prisma.notificationConfiguration.findUnique({
        where: { id },
      });

      if (!configuration) {
        throw new NotFoundException('Configuração de notificação não encontrada.');
      }

      // Find or create channel config
      const existingChannelConfig = await this.prisma.notificationChannelConfig.findFirst({
        where: {
          configurationId: id,
          channel: channel as NOTIFICATION_CHANNEL,
        },
      });

      let channelConfig;

      if (existingChannelConfig) {
        channelConfig = await this.prisma.notificationChannelConfig.update({
          where: { id: existingChannelConfig.id },
          data: {
            enabled: dto.enabled,
            mandatory: dto.mandatory,
            defaultOn: dto.defaultOn,
            minImportance: dto.minImportance,
          },
        });
      } else {
        channelConfig = await this.prisma.notificationChannelConfig.create({
          data: {
            configurationId: id,
            channel: channel as NOTIFICATION_CHANNEL,
            enabled: dto.enabled ?? true,
            mandatory: dto.mandatory ?? false,
            defaultOn: dto.defaultOn ?? true,
            minImportance: dto.minImportance,
          },
        });
      }

      return {
        success: true,
        data: channelConfig,
        message: `Configuração do canal ${channel} atualizada com sucesso.`,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Error updating channel config for configuration ${id}, channel ${channel}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Erro ao atualizar configuração do canal. Tente novamente.',
      );
    }
  }

  /**
   * PUT /api/notification-configurations/:id/sectors/:sector
   * Update a sector override configuration
   */
  @Put(':id/sectors/:sector')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update sector override (Admin)',
    description: 'Update or create sector-specific notification settings',
  })
  @ApiParam({ name: 'id', description: 'Configuration UUID' })
  @ApiParam({ name: 'sector', description: 'Sector privilege (ADMIN, COMMERCIAL, etc.)' })
  @ApiBody({ description: 'Sector override settings' })
  @ApiResponse({ status: 200, description: 'Sector override updated successfully' })
  @ApiResponse({ status: 404, description: 'Configuration or sector not found' })
  async updateSectorOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sector') sector: string,
    @Body() dto: UpdateSectorOverrideDto,
  ) {
    try {
      // Validate sector privilege
      if (!Object.values(SECTOR_PRIVILEGES).includes(sector as SECTOR_PRIVILEGES)) {
        throw new BadRequestException(`Privilégio de setor inválido: ${sector}`);
      }

      const sectorPrivilege = sector as SECTOR_PRIVILEGES;

      // Check if configuration exists
      const configuration = await this.prisma.notificationConfiguration.findUnique({
        where: { id },
      });

      if (!configuration) {
        throw new NotFoundException('Configuração de notificação não encontrada.');
      }

      // Find or create sector override
      const existingOverride = await this.prisma.notificationSectorOverride.findFirst({
        where: {
          configurationId: id,
          sector: sectorPrivilege,
        },
      });

      let sectorOverride;

      if (existingOverride) {
        sectorOverride = await this.prisma.notificationSectorOverride.update({
          where: { id: existingOverride.id },
          data: {
            channelOverrides: dto.channelOverrides ?? undefined,
            importanceOverride: dto.importanceOverride ?? undefined,
          },
        });
      } else {
        sectorOverride = await this.prisma.notificationSectorOverride.create({
          data: {
            configurationId: id,
            sector: sectorPrivilege,
            channelOverrides: dto.channelOverrides ?? null,
            importanceOverride: dto.importanceOverride ?? null,
          },
        });
      }

      return {
        success: true,
        data: sectorOverride,
        message: 'Configuração de setor atualizada com sucesso.',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Error updating sector override for configuration ${id}, sector ${sector}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Erro ao atualizar configuração do setor. Tente novamente.',
      );
    }
  }

  // =====================
  // Helper Methods
  // =====================

  /**
   * Render templates with variables
   */
  private renderTemplates(
    templates: Record<string, any>,
    variables: Record<string, any>,
  ): Record<string, string> {
    const rendered: Record<string, string> = {};

    const renderString = (template: string): string => {
      if (!template || typeof template !== 'string') return template;

      return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return variables[key] !== undefined ? String(variables[key]) : match;
      });
    };

    for (const [key, value] of Object.entries(templates)) {
      if (typeof value === 'string') {
        rendered[key] = renderString(value);
      } else if (typeof value === 'object' && value !== null) {
        // Handle nested objects (like email with subject/body)
        rendered[key] = JSON.stringify(
          Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, typeof v === 'string' ? renderString(v) : v]),
          ),
        );
      }
    }

    return rendered;
  }

  /**
   * Summarize channel usage across recipients
   */
  private summarizeChannels(
    recipientDetails: Array<{ channels: Array<{ channel: string; wouldSend: boolean }> }>,
  ): Record<string, { total: number; wouldReceive: number }> {
    const summary: Record<string, { total: number; wouldReceive: number }> = {};

    for (const recipient of recipientDetails) {
      for (const channel of recipient.channels) {
        if (!summary[channel.channel]) {
          summary[channel.channel] = { total: 0, wouldReceive: 0 };
        }
        summary[channel.channel].total++;
        if (channel.wouldSend) {
          summary[channel.channel].wouldReceive++;
        }
      }
    }

    return summary;
  }
}
