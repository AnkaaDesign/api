import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { MessageService } from './message.service';
import { CreateMessageDto, UpdateMessageDto, FilterMessageDto } from './dto';
import { User, UserId, UserPayload } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';

/**
 * Message/Announcement Controller
 *
 * Provides endpoints for:
 * - Admin: CRUD operations for messages
 * - Users: View unviewed messages and mark as viewed
 */
@ApiTags('Messages')
@ApiBearerAuth()
@Controller('messages')
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  /**
   * Create a new message (Admin only)
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Create a new message/announcement',
    description: 'Create a new message with targeting options. Admin only.',
  })
  @ApiResponse({
    status: 201,
    description: 'Message created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid input data',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - admin access required',
  })
  async create(
    @Body() createMessageDto: CreateMessageDto,
    @UserId() userId: string,
  ) {
    const message = await this.messageService.create(createMessageDto, userId);
    return {
      success: true,
      data: message,
      message: 'Message created successfully',
    };
  }

  /**
   * Get all messages with filters (Admin only)
   */
  @Get()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Get all messages',
    description: 'Retrieve all messages with optional filters. Admin only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Messages retrieved successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - admin access required',
  })
  async findAll(@Query() filters: FilterMessageDto) {
    const result = await this.messageService.findAll(filters);
    return {
      success: true,
      data: result.data,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: Math.ceil(result.total / result.limit),
      },
      message: 'Messages retrieved successfully',
    };
  }

  /**
   * Get unviewed messages for current user
   */
  @Get('unviewed')
  @ApiOperation({
    summary: 'Get unviewed messages',
    description: 'Retrieve all unviewed messages for the current user based on targeting rules',
  })
  @ApiResponse({
    status: 200,
    description: 'Unviewed messages retrieved successfully',
  })
  async getUnviewed(
    @UserId() userId: string,
    @User() user: UserPayload,
  ) {
    console.log(`[MessageController.getUnviewed] userId=${userId}, role=${user.role}`);
    const messages = await this.messageService.getUnviewedForUser(userId, user.role);
    console.log(`[MessageController.getUnviewed] Received ${messages.length} messages from service`);
    return {
      success: true,
      data: messages,
      meta: {
        count: messages.length,
      },
      message: 'Unviewed messages retrieved successfully',
    };
  }

  /**
   * Get message by ID (Admin only)
   */
  @Get(':id')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Get message by ID',
    description: 'Retrieve a specific message by its ID. Admin only.',
  })
  @ApiParam({
    name: 'id',
    description: 'Message UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Message retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Message not found',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - admin access required',
  })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const message = await this.messageService.findOne(id);
    return {
      success: true,
      data: message,
      message: 'Message retrieved successfully',
    };
  }

  /**
   * Update message (Admin only)
   */
  @Put(':id')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Update message',
    description: 'Update an existing message. Admin only.',
  })
  @ApiParam({
    name: 'id',
    description: 'Message UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Message updated successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Message not found',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid input data',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - admin access required',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateMessageDto: UpdateMessageDto,
  ) {
    const message = await this.messageService.update(id, updateMessageDto);
    return {
      success: true,
      data: message,
      message: 'Message updated successfully',
    };
  }

  /**
   * Delete message (Admin only)
   */
  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete message',
    description: 'Delete a message and all associated views. Admin only.',
  })
  @ApiParam({
    name: 'id',
    description: 'Message UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Message deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Message not found',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - admin access required',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.messageService.remove(id);
    return {
      success: true,
      message: 'Message deleted successfully',
    };
  }

  /**
   * Mark message as viewed
   */
  @Post(':id/mark-viewed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark message as viewed',
    description: 'Mark a message as viewed by the current user',
  })
  @ApiParam({
    name: 'id',
    description: 'Message UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Message marked as viewed successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Message not found',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - user does not have permission to view this message',
  })
  async markAsViewed(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
    @User() user: UserPayload,
  ) {
    const view = await this.messageService.markAsViewed(id, userId, user.role);
    return {
      success: true,
      data: view,
      message: 'Message marked as viewed',
    };
  }

  /**
   * Get message statistics (Admin only)
   */
  @Get(':id/stats')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Get message statistics',
    description: 'Get view statistics for a specific message. Admin only.',
  })
  @ApiParam({
    name: 'id',
    description: 'Message UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Statistics retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Message not found',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - admin access required',
  })
  async getStats(@Param('id', ParseUUIDPipe) id: string) {
    const stats = await this.messageService.getStats(id);
    return {
      success: true,
      data: stats,
      message: 'Statistics retrieved successfully',
    };
  }
}
