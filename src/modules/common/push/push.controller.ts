import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PushService } from './push.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import {
  RegisterDeviceTokenDto,
  UnregisterDeviceTokenDto,
  SendTestNotificationDto,
} from './dto/push.dto';

@ApiTags('Push Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class PushController {
  private readonly logger = new Logger(PushController.name);

  constructor(private readonly pushService: PushService) {}

  @Post('device-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register a device token for push notifications' })
  @ApiResponse({
    status: 200,
    description: 'Device token registered successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request data',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async registerDeviceToken(@UserId() userId: string, @Body() dto: RegisterDeviceTokenDto) {
    this.logger.log(`Registering device token for user: ${userId}`);

    const success = await this.pushService.registerDeviceToken(userId, dto.token, dto.platform);

    if (!success) {
      throw new BadRequestException('Failed to register device token');
    }

    return {
      message: 'Device token registered successfully',
      success: true,
    };
  }

  @Delete('device-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unregister a device token' })
  @ApiResponse({
    status: 200,
    description: 'Device token unregistered successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request data',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async unregisterDeviceToken(@UserId() userId: string, @Body() dto: UnregisterDeviceTokenDto) {
    this.logger.log(`Unregistering device token for user: ${userId}`);

    // Verify token belongs to the requesting user
    const token = await this.pushService.findDeviceToken(dto.token);
    if (token && token.userId !== userId) {
      throw new ForbiddenException('Cannot unregister a device token that does not belong to you');
    }

    const success = await this.pushService.unregisterDeviceToken(dto.token);

    if (!success) {
      throw new BadRequestException('Failed to unregister device token');
    }

    return {
      message: 'Device token unregistered successfully',
      success: true,
    };
  }

  @Get('device-tokens')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all device tokens for the current user' })
  @ApiResponse({
    status: 200,
    description: 'User device tokens retrieved successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async getUserDevices(@UserId() userId: string) {
    this.logger.log(`Getting device tokens for user: ${userId}`);

    const devices = await this.pushService.getUserDevices(userId);

    return {
      success: true,
      data: devices,
      count: devices.length,
    };
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN', 'WAREHOUSE')
  @ApiOperation({
    summary: 'Send a test push notification (Admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Test notification sent successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Failed to send test notification',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  async sendTestNotification(@UserId() userId: string, @Body() dto: SendTestNotificationDto) {
    this.logger.log(`Sending test notification from user: ${userId}`);

    const result = await this.pushService.sendPushNotification(
      dto.token,
      dto.title,
      dto.body,
      dto.data,
    );

    if (!result.success) {
      throw new BadRequestException(`Failed to send test notification: ${result.error}`);
    }

    return {
      message: 'Test notification sent successfully',
      success: true,
      messageId: result.messageId,
    };
  }
}
