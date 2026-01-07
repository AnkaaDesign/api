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

interface MessageView {
  id: string;
  messageId: string;
  userId: string;
  viewedAt: Date;
  createdAt: Date;
}

interface Message {
  id: string;
  title: string;
  contentBlocks: any;
  targetType: string;
  targetUserIds: string[] | null;
  targetRoles: string[] | null;
  priority: string;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  actionUrl: string | null;
  actionText: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  views?: MessageView[];
}

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
  private async canUserViewMessage(message: Message, userId: string, userRole: string): Promise<boolean> {
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

    // Check targeting
    switch (message.targetingType) {
      case MESSAGE_TARGET_TYPE.ALL_USERS:
        return true;

      case MESSAGE_TARGET_TYPE.SPECIFIC_USERS:
        return message.targetUserIds?.includes(userId) || false;

      case MESSAGE_TARGET_TYPE.SPECIFIC_ROLES:
        return message.targetRoles?.includes(userRole) || false;

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
      const message = await this.prisma.$queryRaw<Message[]>`
        SELECT * FROM "Message" WHERE id = ${id}::uuid
      `;

      if (!message || message.length === 0) {
        throw new NotFoundException(`Message with ID ${id} not found`);
      }

      return message[0];
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

      const allMessages = await this.prisma.$queryRaw<Message[]>`
        SELECT m.* FROM "Message" m
        WHERE m."status" = 'ACTIVE'
        AND m."publishedAt" IS NOT NULL
        AND (m."startDate" IS NULL OR m."startDate" <= NOW())
        AND (m."endDate" IS NULL OR m."endDate" >= NOW())
        AND NOT EXISTS (
          SELECT 1 FROM "MessageView" mv
          WHERE mv."messageId" = m.id AND mv."userId"::text = ${userId}
        )
        ORDER BY m."priorityOrder" DESC, m."createdAt" DESC
      `;

      this.logger.log(`[getUnviewedForUser] SQL query returned ${allMessages.length} messages`);

      // Filter by targeting rules
      const filteredMessages = [];
      for (const message of allMessages) {
        const canView = await this.canUserViewMessage(message, userId, userRole);
        this.logger.log(`[getUnviewedForUser] Message "${message.title}" (${message.id}) - canView=${canView}, targetingType=${message.targetingType}`);
        if (canView) {
          filteredMessages.push(message);
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
      // Get message and verify user can view it
      const message = await this.findOne(messageId);
      const canView = await this.canUserViewMessage(message, userId, userRole);

      if (!canView) {
        throw new ForbiddenException('You do not have permission to view this message');
      }

      // Check if already viewed
      const existingView = await this.prisma.$queryRaw<MessageView[]>`
        SELECT * FROM "MessageView"
        WHERE "messageId"::text = ${messageId} AND "userId"::text = ${userId}
      `;

      if (existingView && existingView.length > 0) {
        this.logger.log(`Message ${messageId} already viewed by user ${userId}`);
        return existingView[0];
      }

      // Create view record
      const view = await this.prisma.$queryRaw<MessageView[]>`
        INSERT INTO "MessageView" (id, "messageId", "userId", "viewedAt", "createdAt")
        VALUES (gen_random_uuid(), CAST(${messageId} AS uuid), CAST(${userId} AS uuid), NOW(), NOW())
        RETURNING *
      `;

      this.logger.log(`Message ${messageId} marked as viewed by user ${userId}`);
      return view[0];
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
      await this.findOne(messageId);

      const stats = await this.prisma.$queryRaw<
        { total_views: number; unique_viewers: number }[]
      >`
        SELECT
          COUNT(*)::int as total_views,
          COUNT(DISTINCT "userId")::int as unique_viewers
        FROM "MessageView"
        WHERE "messageId"::text = ${messageId}
      `;

      const message = await this.findOne(messageId);
      let targetedUsers = 0;

      if (message.targetType === MESSAGE_TARGET_TYPE.SPECIFIC_USERS) {
        targetedUsers = message.targetUserIds?.length || 0;
      } else if (message.targetType === MESSAGE_TARGET_TYPE.SPECIFIC_ROLES) {
        // Count users with target roles
        const roleConditions = message.targetRoles?.map(role => `role = '${role}'`).join(' OR ');
        const userCount = await this.prisma.$queryRawUnsafe<{ count: number }[]>(
          `SELECT COUNT(*)::int as count FROM "User" WHERE ${roleConditions || 'false'}`
        );
        targetedUsers = userCount[0]?.count || 0;
      } else {
        // ALL_USERS
        const userCount = await this.prisma.$queryRaw<{ count: number }[]>`
          SELECT COUNT(*)::int as count FROM "User"
        `;
        targetedUsers = userCount[0]?.count || 0;
      }

      return {
        totalViews: stats[0]?.total_views || 0,
        uniqueViewers: stats[0]?.unique_viewers || 0,
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
