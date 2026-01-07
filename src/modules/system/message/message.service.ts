import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  CreateMessageDto,
  UpdateMessageDto,
  FilterMessageDto,
  MESSAGE_TARGET_TYPE,
  MESSAGE_PRIORITY,
} from './dto';

import type { Message, MessageView, MessageTarget, MessageStatus, MessageTargetType } from '@prisma/client';

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
   */
  private validateContentBlocks(contentBlocks: any[]): void {
    if (!contentBlocks || !Array.isArray(contentBlocks) || contentBlocks.length === 0) {
      throw new BadRequestException('At least one content block is required');
    }

    for (const block of contentBlocks) {
      if (!block.type || !block.content) {
        throw new BadRequestException('Each content block must have type and content');
      }
    }
  }

  /**
   * Validate targeting logic
   */
  private validateTargeting(data: CreateMessageDto | UpdateMessageDto): void {
    if (data.targetType === MESSAGE_TARGET_TYPE.SPECIFIC_USERS) {
      if (!data.targetUserIds || data.targetUserIds.length === 0) {
        throw new BadRequestException('targetUserIds is required when targetType is SPECIFIC_USERS');
      }
    }

    if (data.targetType === MESSAGE_TARGET_TYPE.SPECIFIC_ROLES) {
      if (!data.targetRoles || data.targetRoles.length === 0) {
        throw new BadRequestException('targetRoles is required when targetType is SPECIFIC_ROLES');
      }
    }

    if (data.startsAt && data.endsAt) {
      const start = new Date(data.startsAt);
      const end = new Date(data.endsAt);
      if (end <= start) {
        throw new BadRequestException('endsAt must be after startsAt');
      }
    }
  }

  /**
   * Check if user is allowed to view a message based on targeting
   */
  private async canUserViewMessage(message: MessageWithRelations, userId: string, userRole: string): Promise<boolean> {
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

    // Check targeting based on targetingType
    switch (message.targetingType) {
      case 'ALL_USERS':
        return true;

      case 'SPECIFIC_USERS':
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

      case 'SECTOR':
        // Check if user's sector matches
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { sectorId: true },
        });
        if (!user?.sectorId) return false;
        if (message.targets) {
          return message.targets.some(t => t.sectorId === user.sectorId);
        }
        const sectorTarget = await this.prisma.messageTarget.findFirst({
          where: {
            messageId: message.id,
            sectorId: user.sectorId,
          },
        });
        return !!sectorTarget;

      case 'POSITION':
        // Check if user's position matches
        const userWithPosition = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { positionId: true },
        });
        if (!userWithPosition?.positionId) return false;
        if (message.targets) {
          return message.targets.some(t => t.positionId === userWithPosition.positionId);
        }
        const positionTarget = await this.prisma.messageTarget.findFirst({
          where: {
            messageId: message.id,
            positionId: userWithPosition.positionId,
          },
        });
        return !!positionTarget;

      case 'PRIVILEGE':
        // Check if user's sector privilege matches
        const userWithSector = await this.prisma.user.findUnique({
          where: { id: userId },
          include: { sector: true },
        });
        if (!userWithSector?.sector?.privileges) return false;
        if (message.targets) {
          return message.targets.some(t => t.sectorPrivilege === userWithSector.sector?.privileges);
        }
        const privilegeTarget = await this.prisma.messageTarget.findFirst({
          where: {
            messageId: message.id,
            sectorPrivilege: userWithSector.sector.privileges,
          },
        });
        return !!privilegeTarget;

      default:
        return false;
    }
  }

  /**
   * Create a new message (admin only)
   */
  async create(data: CreateMessageDto, createdById: string): Promise<Message> {
    this.logger.log(`Creating message: ${data.title}`);

    try {
      this.validateContentBlocks(data.contentBlocks);
      this.validateTargeting(data);

      const message = await this.prisma.$queryRaw<Message[]>`
        INSERT INTO "Message" (
          id,
          title,
          "contentBlocks",
          "targetType",
          "targetUserIds",
          "targetRoles",
          priority,
          "isActive",
          "startsAt",
          "endsAt",
          "actionUrl",
          "actionText",
          "createdAt",
          "updatedAt",
          "createdById"
        ) VALUES (
          gen_random_uuid(),
          ${data.title},
          ${JSON.stringify(data.contentBlocks)}::jsonb,
          ${data.targetType},
          ${data.targetUserIds ? `{${data.targetUserIds.join(',')}}` : null}::text[],
          ${data.targetRoles ? `{${data.targetRoles.join(',')}}` : null}::text[],
          ${data.priority || MESSAGE_PRIORITY.NORMAL},
          ${data.isActive !== undefined ? data.isActive : true},
          ${data.startsAt ? new Date(data.startsAt) : null},
          ${data.endsAt ? new Date(data.endsAt) : null},
          ${data.actionUrl || null},
          ${data.actionText || null},
          NOW(),
          NOW(),
          ${createdById}::uuid
        )
        RETURNING *
      `;

      this.logger.log(`Message created successfully: ${message[0].id}`);
      return message[0];
    } catch (error) {
      this.logger.error('Error creating message:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to create message');
    }
  }

  /**
   * Get all messages with filters (admin only)
   */
  async findAll(filters: FilterMessageDto): Promise<{ data: Message[]; total: number; page: number; limit: number }> {
    try {
      const page = filters.page || 1;
      const limit = filters.limit || 10;
      const offset = (page - 1) * limit;
      const sortBy = filters.sortBy || 'createdAt';
      const sortOrder = filters.sortOrder || 'desc';

      let whereConditions: string[] = [];
      let params: any[] = [];
      let paramIndex = 1;

      if (filters.targetType !== undefined) {
        whereConditions.push(`"targetType" = $${paramIndex++}`);
        params.push(filters.targetType);
      }

      if (filters.priority !== undefined) {
        whereConditions.push(`priority = $${paramIndex++}`);
        params.push(filters.priority);
      }

      if (filters.isActive !== undefined) {
        whereConditions.push(`"isActive" = $${paramIndex++}`);
        params.push(filters.isActive);
      }

      if (filters.visibleAt) {
        const visibleDate = new Date(filters.visibleAt);
        whereConditions.push(
          `("startsAt" IS NULL OR "startsAt" <= $${paramIndex}) AND ("endsAt" IS NULL OR "endsAt" >= $${paramIndex})`
        );
        params.push(visibleDate);
        paramIndex++;
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      // Count query
      const countQuery = `SELECT COUNT(*)::int as count FROM "Message" ${whereClause}`;
      const countResult = await this.prisma.$queryRawUnsafe<{ count: number }[]>(countQuery, ...params);
      const total = countResult[0]?.count || 0;

      // Data query
      const dataQuery = `
        SELECT * FROM "Message"
        ${whereClause}
        ORDER BY "${sortBy}" ${sortOrder.toUpperCase()}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      const data = await this.prisma.$queryRawUnsafe<Message[]>(dataQuery, ...params, limit, offset);

      return {
        data,
        total,
        page,
        limit,
      };
    } catch (error) {
      this.logger.error('Error fetching messages:', error);
      throw new InternalServerErrorException('Failed to fetch messages');
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
          targets: true,
          views: true,
        },
      });

      if (!message) {
        throw new NotFoundException(`Message with ID ${id} not found`);
      }

      return message;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error fetching message:', error);
      throw new InternalServerErrorException('Failed to fetch message');
    }
  }

  /**
   * Update message (admin only)
   */
  async update(id: string, data: UpdateMessageDto): Promise<Message> {
    this.logger.log(`Updating message: ${id}`);

    try {
      // Check if message exists
      await this.findOne(id);

      if (data.contentBlocks) {
        this.validateContentBlocks(data.contentBlocks);
      }

      if (data.targetType || data.targetUserIds || data.targetRoles) {
        this.validateTargeting(data as CreateMessageDto);
      }

      const updateFields: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (data.title !== undefined) {
        updateFields.push(`title = $${paramIndex++}`);
        params.push(data.title);
      }

      if (data.contentBlocks !== undefined) {
        updateFields.push(`"contentBlocks" = $${paramIndex++}::jsonb`);
        params.push(JSON.stringify(data.contentBlocks));
      }

      if (data.targetType !== undefined) {
        updateFields.push(`"targetType" = $${paramIndex++}`);
        params.push(data.targetType);
      }

      if (data.targetUserIds !== undefined) {
        updateFields.push(`"targetUserIds" = $${paramIndex++}::text[]`);
        params.push(data.targetUserIds ? `{${data.targetUserIds.join(',')}}` : null);
      }

      if (data.targetRoles !== undefined) {
        updateFields.push(`"targetRoles" = $${paramIndex++}::text[]`);
        params.push(data.targetRoles ? `{${data.targetRoles.join(',')}}` : null);
      }

      if (data.priority !== undefined) {
        updateFields.push(`priority = $${paramIndex++}`);
        params.push(data.priority);
      }

      if (data.isActive !== undefined) {
        updateFields.push(`"isActive" = $${paramIndex++}`);
        params.push(data.isActive);
      }

      if (data.startsAt !== undefined) {
        updateFields.push(`"startsAt" = $${paramIndex++}`);
        params.push(data.startsAt ? new Date(data.startsAt) : null);
      }

      if (data.endsAt !== undefined) {
        updateFields.push(`"endsAt" = $${paramIndex++}`);
        params.push(data.endsAt ? new Date(data.endsAt) : null);
      }

      if (data.actionUrl !== undefined) {
        updateFields.push(`"actionUrl" = $${paramIndex++}`);
        params.push(data.actionUrl);
      }

      if (data.actionText !== undefined) {
        updateFields.push(`"actionText" = $${paramIndex++}`);
        params.push(data.actionText);
      }

      updateFields.push(`"updatedAt" = NOW()`);

      if (updateFields.length === 1) {
        // Only updatedAt field, nothing to update
        return this.findOne(id);
      }

      const query = `
        UPDATE "Message"
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex}::uuid
        RETURNING *
      `;
      params.push(id);

      const result = await this.prisma.$queryRawUnsafe<Message[]>(query, ...params);

      this.logger.log(`Message updated successfully: ${id}`);
      return result[0];
    } catch (error) {
      this.logger.error('Error updating message:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to update message');
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
      throw new InternalServerErrorException('Failed to delete message');
    }
  }

  /**
   * Get unviewed messages for current user
   */
  async getUnviewedForUser(userId: string, userRole: string): Promise<Message[]> {
    try {
      this.logger.log(`[getUnviewedForUser] Called with userId=${userId}, userRole=${userRole}`);

      const now = new Date();

      // Find all active messages that the user hasn't viewed
      const allMessages = await this.prisma.message.findMany({
        where: {
          status: 'ACTIVE',
          publishedAt: { not: null },
          OR: [
            { startDate: null },
            { startDate: { lte: now } },
          ],
          AND: [
            {
              OR: [
                { endDate: null },
                { endDate: { gte: now } },
              ],
            },
          ],
          views: {
            none: {
              userId: userId,
            },
          },
        },
        include: {
          targets: true,
        },
        orderBy: [
          { priorityOrder: 'desc' },
          { createdAt: 'desc' },
        ],
      });

      this.logger.log(`[getUnviewedForUser] Query returned ${allMessages.length} messages`);

      // Filter by targeting rules
      const filteredMessages: Message[] = [];
      for (const message of allMessages) {
        const canView = await this.canUserViewMessage(message, userId, userRole);
        this.logger.log(`[getUnviewedForUser] Message "${message.title}" (${message.id}) - canView=${canView}, targetingType=${message.targetingType}`);
        if (canView) {
          // Remove targets from response to avoid circular reference
          const { targets, ...messageWithoutTargets } = message;
          filteredMessages.push(messageWithoutTargets as Message);
        }
      }

      this.logger.log(`[getUnviewedForUser] Returning ${filteredMessages.length} filtered messages`);
      return filteredMessages;
    } catch (error) {
      this.logger.error('Error fetching unviewed messages:', error);
      throw new InternalServerErrorException('Failed to fetch unviewed messages');
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
        throw new NotFoundException(`Message with ID ${messageId} not found`);
      }

      const canView = await this.canUserViewMessage(message, userId, userRole);

      if (!canView) {
        throw new ForbiddenException('You do not have permission to view this message');
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
      throw new InternalServerErrorException('Failed to mark message as viewed');
    }
  }

  /**
   * Get message statistics (admin only)
   */
  async getStats(messageId: string): Promise<{
    totalViews: number;
    uniqueViewers: number;
    targetedUsers: number;
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
        throw new NotFoundException(`Message with ID ${messageId} not found`);
      }

      const totalViews = message.views?.length || 0;
      const uniqueViewers = new Set(message.views?.map(v => v.userId)).size;

      let targetedUsers = 0;

      switch (message.targetingType) {
        case 'ALL_USERS':
          targetedUsers = await this.prisma.user.count({ where: { isActive: true } });
          break;

        case 'SPECIFIC_USERS':
          targetedUsers = message.targets?.filter(t => t.userId).length || 0;
          break;

        case 'SECTOR':
          const sectorIds = message.targets?.map(t => t.sectorId).filter(Boolean) as string[];
          if (sectorIds.length > 0) {
            targetedUsers = await this.prisma.user.count({
              where: {
                isActive: true,
                sectorId: { in: sectorIds },
              },
            });
          }
          break;

        case 'POSITION':
          const positionIds = message.targets?.map(t => t.positionId).filter(Boolean) as string[];
          if (positionIds.length > 0) {
            targetedUsers = await this.prisma.user.count({
              where: {
                isActive: true,
                positionId: { in: positionIds },
              },
            });
          }
          break;

        case 'PRIVILEGE':
          const privileges = message.targets?.map(t => t.sectorPrivilege).filter(Boolean);
          if (privileges && privileges.length > 0) {
            targetedUsers = await this.prisma.user.count({
              where: {
                isActive: true,
                sector: {
                  privileges: { in: privileges },
                },
              },
            });
          }
          break;
      }

      return {
        totalViews,
        uniqueViewers,
        targetedUsers,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Error fetching message stats:', error);
      throw new InternalServerErrorException('Failed to fetch message stats');
    }
  }
}
