import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { CreateMessageDto, UpdateMessageDto, FilterMessageDto } from './dto';

import type { Message, MessageView, MessageTarget, MessageStatus } from '@prisma/client';

// Extended message type with relations
type MessageWithRelations = Message & {
  views?: MessageView[];
  targets?: MessageTarget[];
};

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate message content blocks
   * Handles both array and object formats (object with numeric keys gets converted to array)
   */
  private validateContentBlocks(contentBlocks: any[] | any): void {
    // Convert object with numeric keys to array if needed
    // This handles cases where body parser converts arrays to objects
    let blocksArray: any[];

    if (!contentBlocks) {
      throw new BadRequestException('É necessário pelo menos um bloco de conteúdo');
    }

    if (Array.isArray(contentBlocks)) {
      blocksArray = contentBlocks;
    } else if (typeof contentBlocks === 'object') {
      // Check if it's an object with numeric keys (array-like)
      const keys = Object.keys(contentBlocks);
      const isArrayLike = keys.every(key => /^\d+$/.test(key));

      if (isArrayLike && keys.length > 0) {
        // Convert to array, sorting by numeric key
        blocksArray = keys.sort((a, b) => parseInt(a) - parseInt(b)).map(key => contentBlocks[key]);
      } else {
        throw new BadRequestException('Os blocos de conteúdo devem ser um array');
      }
    } else {
      throw new BadRequestException('Os blocos de conteúdo devem ser um array');
    }

    if (blocksArray.length === 0) {
      throw new BadRequestException('É necessário pelo menos um bloco de conteúdo');
    }

    for (const block of blocksArray) {
      if (!block.id || !block.type) {
        throw new BadRequestException('Cada bloco de conteúdo deve ter id e tipo');
      }
      // Note: Different block types have different structures
      // - Text blocks (paragraph, heading, quote, callout): have 'content' field (array or string)
      // - Image blocks: have 'url' field
      // - Button blocks: have 'text' and 'url' fields
      // - Divider blocks: no additional data needed
      // - List blocks: have 'items' array
      // We validate that required data exists based on type
      if (
        ['paragraph', 'heading1', 'heading2', 'heading3', 'quote', 'callout'].includes(block.type)
      ) {
        // Content can be either array (rich text) or string (plain text) - both are valid
        if (!block.content) {
          throw new BadRequestException(
            `O bloco do tipo ${block.type} requer um campo de conteúdo`,
          );
        }
      } else if (block.type === 'image') {
        if (!block.url || typeof block.url !== 'string') {
          throw new BadRequestException('Blocos de imagem requerem um campo de URL');
        }
      } else if (block.type === 'button') {
        if (!block.text || !block.url) {
          throw new BadRequestException('Blocos de botão requerem campos de texto e URL');
        }
      } else if (block.type === 'list') {
        if (!block.items || !Array.isArray(block.items)) {
          throw new BadRequestException('Blocos de lista requerem um array de itens');
        }
      } else if (!['divider', 'quote'].includes(block.type)) {
        // For unknown types, just log a warning but don't fail
        this.logger.warn(`Tipo de bloco desconhecido: ${block.type}`);
      }
    }
  }

  /**
   * Validate scheduling dates
   */
  private validateScheduling(data: CreateMessageDto | UpdateMessageDto): void {
    if (data.startsAt && data.endsAt) {
      const start = new Date(data.startsAt);
      const end = new Date(data.endsAt);
      if (end <= start) {
        throw new BadRequestException('A data de término deve ser posterior à data de início');
      }
    }
  }

  /**
   * Check if user is allowed to view a message based on targeting
   * SIMPLIFIED: Now just checks if message is active and if user is in targets
   */
  private async canUserViewMessage(
    message: MessageWithRelations,
    userId: string,
    userRole: string,
  ): Promise<boolean> {
    // Check if message is active
    if (message.status !== 'ACTIVE') {
      return false;
    }

    // Check date range
    const now = new Date();
    if (message.startDate && now < new Date(message.startDate)) {
      return false;
    }
    if (message.endDate && now > new Date(message.endDate)) {
      return false;
    }

    // Check targeting:
    // - No targets = ALL_USERS (everyone can see)
    // - Has targets = SPECIFIC_USERS (only those in targets can see)

    // If no targets, message is for ALL_USERS
    if (!message.targets || message.targets.length === 0) {
      return true;
    }

    // Check if user is in the targets
    if (message.targets) {
      return message.targets.some(t => t.userId === userId);
    }

    // Fallback: query targets
    const userTarget = await this.prisma.messageTarget.findFirst({
      where: {
        messageId: message.id,
        userId: userId,
      },
    });

    return !!userTarget;
  }

  /**
   * Create a new message (admin only)
   */
  async create(data: CreateMessageDto, createdById: string): Promise<Message> {
    this.logger.log(`Creating message: ${data.title}`);

    try {
      // Log the raw incoming data for debugging
      this.logger.log(`[create] RAW data received:`, JSON.stringify(data, null, 2));
      this.logger.log(
        `[create] contentBlocks type: ${typeof data.contentBlocks}, isArray: ${Array.isArray(data.contentBlocks)}`,
      );

      if (Array.isArray(data.contentBlocks) && data.contentBlocks.length > 0) {
        this.logger.log(`[create] First block:`, JSON.stringify(data.contentBlocks[0]));
        this.logger.log(`[create] All blocks:`, JSON.stringify(data.contentBlocks));
      }

      this.validateContentBlocks(data.contentBlocks);
      this.validateScheduling(data);

      // Normalize contentBlocks to array if it's an object with numeric keys
      let contentBlocks: any[];

      if (Array.isArray(data.contentBlocks)) {
        contentBlocks = data.contentBlocks;
        this.logger.log(
          `[create] Using contentBlocks as-is (array), length: ${contentBlocks.length}`,
        );
      } else if (typeof data.contentBlocks === 'object') {
        const keys = Object.keys(data.contentBlocks);
        const isArrayLike = keys.every(key => /^\d+$/.test(key));
        if (isArrayLike) {
          contentBlocks = keys
            .sort((a, b) => parseInt(a) - parseInt(b))
            .map(key => (data.contentBlocks as any)[key]);
          this.logger.log(`[create] Converted object to array, length: ${contentBlocks.length}`);
        } else {
          contentBlocks = data.contentBlocks as any[];
          this.logger.log(`[create] Using as-is (object treated as array)`);
        }
      } else {
        contentBlocks = data.contentBlocks as any[];
        this.logger.log(`[create] Using as-is (unknown type)`);
      }

      // Verify contentBlocks are not empty arrays
      const hasEmptyBlocks = contentBlocks.some(
        block =>
          Array.isArray(block) || (typeof block === 'object' && Object.keys(block).length === 0),
      );
      if (hasEmptyBlocks) {
        this.logger.error(`[create] WARNING: Content blocks contain empty arrays or objects!`);
        this.logger.error(`[create] Blocks: ${JSON.stringify(contentBlocks)}`);
      }

      // Get target user IDs (already resolved on frontend)
      // Empty array = all users
      const targetUserIds = data.targets || [];

      // Create message using Prisma (matches schema)
      // Store content as object with blocks array (frontend expects content.blocks)
      const message = await this.prisma.message.create({
        data: {
          title: data.title,
          content: { blocks: contentBlocks }, // Wrap blocks in object for frontend compatibility
          status: data.isActive ? 'ACTIVE' : 'DRAFT',
          startDate: data.startsAt ? new Date(data.startsAt) : null,
          endDate: data.endsAt ? new Date(data.endsAt) : null,
          createdById,
          // Set publishedAt timestamp when creating ACTIVE messages
          // This is required for messages to appear in getUnviewedForUser query
          publishedAt: data.isActive ? new Date() : null,
        },
      });

      // Create target records for specific users
      // Empty targets = ALL_USERS (everyone can see)
      if (targetUserIds.length > 0) {
        await this.prisma.messageTarget.createMany({
          data: targetUserIds.map(userId => ({
            messageId: message.id,
            userId,
          })),
        });
      }

      this.logger.log(`Message created successfully: ${message.id}`);
      return message;
    } catch (error) {
      this.logger.error('Error creating message:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Falha ao criar mensagem');
    }
  }

  /**
   * Get all messages with filters (admin only)
   */
  async findAll(
    filters: FilterMessageDto,
  ): Promise<{ data: Message[]; total: number; page: number; limit: number }> {
    try {
      const page = filters.page || 1;
      const limit = filters.limit || 10;
      const offset = (page - 1) * limit;
      const sortBy = filters.sortBy || 'createdAt';
      const sortOrder = filters.sortOrder || 'desc';

      // Build where conditions using Prisma
      const where: any = {};

      if (filters.isActive !== undefined) {
        where.status = filters.isActive ? 'ACTIVE' : 'DRAFT';
      }

      if (filters.visibleAt) {
        const visibleDate = new Date(filters.visibleAt);
        where.AND = [
          {
            OR: [{ startDate: null }, { startDate: { lte: visibleDate } }],
          },
          {
            OR: [{ endDate: null }, { endDate: { gte: visibleDate } }],
          },
        ];
      }

      // Count total
      const total = await this.prisma.message.count({ where });

      // Fetch data with relations for stats calculation
      const messages = await this.prisma.message.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: offset,
        take: limit,
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
          views: true,
          targets: true,
        },
      });

      // Get total active users count for messages targeting all users
      const totalActiveUsers = await this.prisma.user.count({ where: { isActive: true } });

      // Map messages to include stats
      const data = messages.map(message => {
        const views = message.views || [];
        const targets = message.targets || [];

        const stats = {
          views: views.length,
          uniqueViews: new Set(views.map(v => v.userId)).size,
          targetUsers: targets.length > 0 ? targets.length : totalActiveUsers,
          dismissals: views.filter(v => v.dismissedAt !== null).length,
        };

        // Remove views and targets from response, keep only stats and targetCount
        const { views: _views, targets: _targets, ...messageWithoutRelations } = message;

        return {
          ...messageWithoutRelations,
          stats,
          targetCount: targets.length,
        };
      });

      return {
        data,
        total,
        page,
        limit,
      };
    } catch (error) {
      this.logger.error('Error fetching messages:', error);
      throw new InternalServerErrorException('Falha ao buscar mensagens');
    }
  }

  /**
   * Get message by ID (admin only)
   */
  async findOne(id: string): Promise<Message> {
    try {
      const message = await this.prisma.message.findUnique({
        where: { id },
        include: {
          targets: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          views: true,
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!message) {
        throw new NotFoundException(`Mensagem com ID ${id} não encontrada`);
      }

      return message;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error fetching message:', error);
      throw new InternalServerErrorException('Falha ao buscar mensagem');
    }
  }

  /**
   * Update message (admin only)
   */
  async update(id: string, data: UpdateMessageDto): Promise<Message> {
    this.logger.log(`Updating message: ${id}`);

    try {
      // Check if message exists
      const existingMessage = await this.findOne(id);

      if (data.contentBlocks) {
        this.validateContentBlocks(data.contentBlocks);
      }

      if (data.startsAt || data.endsAt) {
        this.validateScheduling(data);
      }

      // Normalize contentBlocks to array if needed
      let contentBlocks: any[] | undefined;
      if (data.contentBlocks) {
        if (Array.isArray(data.contentBlocks)) {
          contentBlocks = data.contentBlocks;
        } else if (typeof data.contentBlocks === 'object') {
          const keys = Object.keys(data.contentBlocks);
          const isArrayLike = keys.every(key => /^\d+$/.test(key));
          if (isArrayLike) {
            contentBlocks = keys
              .sort((a, b) => parseInt(a) - parseInt(b))
              .map(key => (data.contentBlocks as any)[key]);
          }
        }
      }

      // Build update data object
      const updateData: any = {};

      if (data.title !== undefined) {
        updateData.title = data.title;
      }

      if (contentBlocks !== undefined) {
        updateData.content = { blocks: contentBlocks }; // Wrap blocks in object for frontend compatibility
      }

      if (data.isActive !== undefined) {
        updateData.status = data.isActive ? 'ACTIVE' : 'DRAFT';

        // Set publishedAt when activating a message for the first time
        if (data.isActive && !existingMessage.publishedAt) {
          updateData.publishedAt = new Date();
        }
        // Clear publishedAt when setting to draft
        if (!data.isActive && existingMessage.publishedAt) {
          updateData.publishedAt = null;
        }
      }

      if (data.startsAt !== undefined) {
        updateData.startDate = data.startsAt ? new Date(data.startsAt) : null;
      }

      if (data.endsAt !== undefined) {
        updateData.endDate = data.endsAt ? new Date(data.endsAt) : null;
      }

      // Update message using Prisma
      const message = await this.prisma.message.update({
        where: { id },
        data: updateData,
      });

      // Update targets if provided (frontend already resolved to user IDs)
      if (data.targets !== undefined) {
        const targetUserIds = data.targets || [];

        // Delete existing targets
        await this.prisma.messageTarget.deleteMany({
          where: { messageId: id },
        });

        // Create new targets (empty = ALL_USERS)
        if (targetUserIds.length > 0) {
          await this.prisma.messageTarget.createMany({
            data: targetUserIds.map(userId => ({
              messageId: id,
              userId,
            })),
          });
        }
      }

      this.logger.log(`Message updated successfully: ${id}`);
      return message;
    } catch (error) {
      this.logger.error('Error updating message:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Falha ao atualizar mensagem');
    }
  }

  /**
   * Delete message (admin only)
   */
  async remove(id: string): Promise<void> {
    this.logger.log(`Deleting message: ${id}`);

    try {
      // Check if message exists
      await this.findOne(id);

      // Delete associated views first
      await this.prisma.$executeRaw`
        DELETE FROM "MessageView" WHERE "messageId" = ${id}::uuid
      `;

      // Delete message
      await this.prisma.$executeRaw`
        DELETE FROM "Message" WHERE id = ${id}::uuid
      `;

      this.logger.log(`Message deleted successfully: ${id}`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error deleting message:', error);
      throw new InternalServerErrorException('Falha ao excluir mensagem');
    }
  }

  /**
   * Get unviewed messages for current user
   */
  async getUnviewedForUser(userId: string, userRole: string): Promise<Message[]> {
    try {
      this.logger.log(`[getUnviewedForUser] Called with userId=${userId}, userRole=${userRole}`);

      const now = new Date();

      // Find all active messages that the user hasn't viewed or dismissed
      // Exclude ANY message that has been viewed (even if not dismissed) to prevent repeated showing
      const allMessages = await this.prisma.message.findMany({
        where: {
          status: 'ACTIVE',
          publishedAt: { not: null },
          OR: [{ startDate: null }, { startDate: { lte: now } }],
          AND: [
            {
              OR: [{ endDate: null }, { endDate: { gte: now } }],
            },
          ],
          // Exclude messages that have been viewed OR dismissed by this user
          // This prevents the modal from showing the same message repeatedly
          views: {
            none: {
              userId: userId,
            },
          },
        },
        include: {
          targets: true,
        },
        orderBy: [{ createdAt: 'desc' }],
      });

      this.logger.log(`[getUnviewedForUser] Query returned ${allMessages.length} messages`);

      // Filter by targeting rules
      const filteredMessages: Message[] = [];
      for (const message of allMessages) {
        const canView = await this.canUserViewMessage(message, userId, userRole);
        this.logger.log(
          `[getUnviewedForUser] Message "${message.title}" (${message.id}) - canView=${canView}`,
        );
        if (canView) {
          // Create a clean message object without targets
          const messageWithoutTargets = {
            id: message.id,
            title: message.title,
            content: message.content,
            status: message.status,
            statusOrder: message.statusOrder,
            startDate: message.startDate,
            endDate: message.endDate,
            createdById: message.createdById,
            metadata: message.metadata,
            isDismissible: message.isDismissible,
            requiresView: message.requiresView,
            createdAt: message.createdAt,
            updatedAt: message.updatedAt,
            publishedAt: message.publishedAt,
            archivedAt: message.archivedAt,
          };
          filteredMessages.push(messageWithoutTargets as Message);
        }
      }

      this.logger.log(
        `[getUnviewedForUser] Returning ${filteredMessages.length} filtered messages`,
      );
      return filteredMessages;
    } catch (error) {
      this.logger.error('Error fetching unviewed messages:', error);
      throw new InternalServerErrorException('Falha ao buscar mensagens não visualizadas');
    }
  }

  /**
   * Mark message as viewed
   */
  async markAsViewed(messageId: string, userId: string, userRole: string): Promise<MessageView> {
    this.logger.log(`Marking message ${messageId} as viewed by user ${userId}`);

    try {
      // Get message with targets and verify user can view it
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
        include: { targets: true },
      });

      if (!message) {
        throw new NotFoundException(`Mensagem com ID ${messageId} não encontrada`);
      }

      const canView = await this.canUserViewMessage(message, userId, userRole);

      if (!canView) {
        throw new ForbiddenException('Você não tem permissão para visualizar esta mensagem');
      }

      // Check if already viewed
      const existingView = await this.prisma.messageView.findUnique({
        where: {
          userId_messageId: {
            userId: userId,
            messageId: messageId,
          },
        },
      });

      if (existingView) {
        this.logger.log(`Message ${messageId} already viewed by user ${userId}`);
        return existingView;
      }

      // Create view record
      const view = await this.prisma.messageView.create({
        data: {
          messageId: messageId,
          userId: userId,
          viewedAt: new Date(),
        },
      });

      this.logger.log(`Message ${messageId} marked as viewed by user ${userId}`);
      return view;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Error marking message as viewed:', error);
      throw new InternalServerErrorException('Falha ao marcar mensagem como visualizada');
    }
  }

  /**
   * Mark message as dismissed (don't show again)
   */
  async dismissMessage(messageId: string, userId: string, userRole: string): Promise<MessageView> {
    this.logger.log(`Dismissing message ${messageId} for user ${userId}`);

    try {
      // Get message with targets and verify user can view it
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
        include: { targets: true },
      });

      if (!message) {
        throw new NotFoundException(`Mensagem com ID ${messageId} não encontrada`);
      }

      const canView = await this.canUserViewMessage(message, userId, userRole);

      if (!canView) {
        throw new ForbiddenException('Você não tem permissão para visualizar esta mensagem');
      }

      // Check if already viewed
      const existingView = await this.prisma.messageView.findUnique({
        where: {
          userId_messageId: {
            userId: userId,
            messageId: messageId,
          },
        },
      });

      if (existingView) {
        // Update existing view to mark as dismissed
        const updatedView = await this.prisma.messageView.update({
          where: { id: existingView.id },
          data: { dismissedAt: new Date() },
        });

        this.logger.log(`Message ${messageId} dismissed by user ${userId}`);
        return updatedView;
      }

      // Create view record with dismissal
      const view = await this.prisma.messageView.create({
        data: {
          messageId: messageId,
          userId: userId,
          viewedAt: new Date(),
          dismissedAt: new Date(),
        },
      });

      this.logger.log(`Message ${messageId} dismissed by user ${userId}`);
      return view;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Error dismissing message:', error);
      throw new InternalServerErrorException('Falha ao dispensar mensagem');
    }
  }

  /**
   * Get all messages for current user (including viewed/dismissed)
   * This allows users to review messages they've already seen
   */
  async getAllForUser(userId: string, userRole: string): Promise<Message[]> {
    try {
      this.logger.log(`[getAllForUser] Called with userId=${userId}, userRole=${userRole}`);

      const now = new Date();

      // Find all active messages within date range
      const allMessages = await this.prisma.message.findMany({
        where: {
          status: 'ACTIVE',
          publishedAt: { not: null },
          OR: [{ startDate: null }, { startDate: { lte: now } }],
          AND: [
            {
              OR: [{ endDate: null }, { endDate: { gte: now } }],
            },
          ],
        },
        include: {
          targets: true,
          views: {
            where: {
              userId: userId,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
      });

      this.logger.log(`[getAllForUser] Query returned ${allMessages.length} messages`);

      // Filter by targeting rules
      const filteredMessages: (Message & { viewedAt?: Date | null; dismissedAt?: Date | null })[] =
        [];
      for (const message of allMessages) {
        const canView = await this.canUserViewMessage(message, userId, userRole);
        if (canView) {
          // Get view info for this message
          const userView = message.views?.[0];

          // Create a clean message object with view status
          const messageWithViewStatus = {
            id: message.id,
            title: message.title,
            content: message.content,
            status: message.status,
            statusOrder: message.statusOrder,
            startDate: message.startDate,
            endDate: message.endDate,
            createdById: message.createdById,
            metadata: message.metadata,
            isDismissible: message.isDismissible,
            requiresView: message.requiresView,
            createdAt: message.createdAt,
            updatedAt: message.updatedAt,
            publishedAt: message.publishedAt,
            archivedAt: message.archivedAt,
            viewedAt: userView?.viewedAt || null,
            dismissedAt: userView?.dismissedAt || null,
          };
          filteredMessages.push(
            messageWithViewStatus as Message & {
              viewedAt?: Date | null;
              dismissedAt?: Date | null;
            },
          );
        }
      }

      this.logger.log(`[getAllForUser] Returning ${filteredMessages.length} filtered messages`);
      return filteredMessages;
    } catch (error) {
      this.logger.error('Error fetching all messages for user:', error);
      throw new InternalServerErrorException('Falha ao buscar mensagens');
    }
  }

  /**
   * Get message statistics (admin only)
   */
  async getStats(messageId: string): Promise<{
    totalViews: number;
    uniqueViewers: number;
    targetedUsers: number;
    totalDismissals: number;
  }> {
    try {
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
        include: {
          targets: true,
          views: true,
        },
      });

      if (!message) {
        throw new NotFoundException(`Mensagem com ID ${messageId} não encontrada`);
      }

      const totalViews = message.views?.length || 0;
      const uniqueViewers = new Set(message.views?.map(v => v.userId)).size;

      let targetedUsers = 0;

      // Simplified: no targets = ALL_USERS, has targets = count of targets
      if (!message.targets || message.targets.length === 0) {
        // ALL_USERS
        targetedUsers = await this.prisma.user.count({ where: { isActive: true } });
      } else {
        // SPECIFIC_USERS (count unique user IDs in targets)
        targetedUsers = message.targets.length;
      }

      // Count dismissals (messages marked as "don't show again")
      const totalDismissals = message.views?.filter(v => v.dismissedAt !== null).length || 0;

      return {
        totalViews,
        uniqueViewers,
        targetedUsers,
        totalDismissals,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error fetching message stats:', error);
      throw new InternalServerErrorException('Falha ao buscar estatísticas da mensagem');
    }
  }
}
