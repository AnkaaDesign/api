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
import { DeviceTokenService } from './device-token.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants';
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

  constructor(
    private readonly pushService: PushService,
    private readonly deviceTokenService: DeviceTokenService,
  ) {}

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

    const success = await this.pushService.registerDeviceToken(
      userId,
      dto.token,
      dto.platform,
      dto.deviceId,
    );

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

  @Get('device-tokens/health')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @ApiOperation({
    summary: 'Device token health overview (Admin only)',
  })
  async getDeviceTokenHealth() {
    return {
      success: true,
      data: await this.deviceTokenService.getHealthSummary(),
    };
  }

  @Post('device-tokens/prune')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @ApiOperation({
    summary: 'Retire stale/superseded device tokens now (Admin only)',
    description:
      'Runs the same sweep as the nightly job. Safe to repeat: a device that is still ' +
      'alive re-registers itself within 12 hours and becomes active again.',
  })
  async pruneDeviceTokens() {
    const before = await this.deviceTokenService.getHealthSummary();
    const result = await this.deviceTokenService.pruneStaleTokens();
    const after = await this.deviceTokenService.getHealthSummary();

    return {
      success: true,
      message: `${result.abandoned + result.stale} token(s) retired`,
      data: { ...result, before, after },
    };
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN)
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
