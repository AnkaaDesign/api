import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '@constants';
import { BaileysWhatsAppService } from './baileys-whatsapp.service';
import { SendMessageDto } from './dto';

/**
 * WhatsApp controller for managing Baileys WhatsApp client
 * All endpoints require ADMIN privileges
 *
 * Updated for Baileys migration - maintains backward compatibility with web app
 */
@Controller('whatsapp')
@UseGuards(AuthGuard)
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    @Inject('WhatsAppService')
    private readonly whatsappService: BaileysWhatsAppService,
  ) {}

  /**
   * Get WhatsApp client connection status (Basic)
   * @returns Basic connection status information
   */
  @Get('status')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getStatus() {
    try {
      const statusInfo = await this.whatsappService.getConnectionStatus();

      return {
        success: true,
        data: {
          ready: statusInfo.ready,
          initializing: statusInfo.status === 'CONNECTING',
          hasQRCode: statusInfo.hasQRCode,
          reconnectAttempts: statusInfo.reconnectAttempts,
          message: statusInfo.ready
            ? 'WhatsApp client is connected and ready'
            : statusInfo.status === 'CONNECTING'
              ? 'WhatsApp client is initializing...'
              : statusInfo.hasQRCode
                ? 'QR code is available for scanning'
                : 'WhatsApp client is disconnected',
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get status: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to get WhatsApp status');
    }
  }

  /**
   * Get WhatsApp client connection status (Detailed)
   * Returns detailed status including cached information
   * @returns Detailed connection status information
   */
  @Get('connection-status')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getConnectionStatus() {
    try {
      const status = await this.whatsappService.getConnectionStatus();

      return {
        success: true,
        data: {
          status: status.status,
          ready: status.ready,
          initializing: status.status === 'CONNECTING',
          hasQRCode: status.hasQRCode,
          qrCodeExpiry: status.qrCodeExpiry,
          reconnectAttempts: status.reconnectAttempts,
          lastUpdated: new Date(),
          message: this.getStatusMessage(status.status, status.ready),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get connection status: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to get WhatsApp connection status');
    }
  }

  /**
   * Check if WhatsApp is authenticated
   * @returns Authentication status
   */
  @Get('is-authenticated')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async isAuthenticated() {
    try {
      const isAuthenticated = await this.whatsappService.isAuthenticated();

      return {
        success: true,
        data: {
          authenticated: isAuthenticated,
          message: isAuthenticated
            ? 'WhatsApp client is authenticated and ready to send messages'
            : 'WhatsApp client is not authenticated. Please scan QR code to authenticate.',
        },
      };
    } catch (error) {
      this.logger.error(`Failed to check authentication: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to check WhatsApp authentication status');
    }
  }

  /**
   * Helper method to generate status message
   */
  private getStatusMessage(status: string, ready: boolean): string {
    if (ready) {
      return 'WhatsApp client is connected and ready to send messages';
    }

    switch (status) {
      case 'CONNECTING':
        return 'WhatsApp client is connecting...';
      case 'QR_READY':
        return 'QR code is ready for scanning. Please scan with WhatsApp mobile app.';
      case 'AUTHENTICATED':
        return 'WhatsApp client is authenticated and initializing...';
      case 'READY':
        return 'WhatsApp client is ready';
      case 'AUTH_FAILURE':
        return 'Authentication failed. Please try reconnecting.';
      case 'DISCONNECTED':
        return 'WhatsApp client is disconnected';
      default:
        return 'Unknown status';
    }
  }

  /**
   * Get current QR code for WhatsApp authentication
   * Returns cached QR code if available and not expired
   * @returns QR code data or null if not available
   */
  @Get('qr')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getQRCode() {
    try {
      const qrData = await this.whatsappService.getQRCode();

      if (!qrData) {
        return {
          success: false,
          data: null,
          message:
            'No QR code available. Client may be authenticated or QR code has expired. Use /admin/whatsapp/qr-code to generate a new one.',
        };
      }

      return {
        success: true,
        data: {
          qr: qrData.qr,
          generatedAt: qrData.generatedAt,
          expiresAt: qrData.expiresAt,
          message: 'Scan this QR code with WhatsApp mobile app to authenticate',
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get QR code: ${error.message}`, error.stack);
      throw new BadRequestException(error.message || 'Failed to get QR code');
    }
  }

  /**
   * Generate new QR code for WhatsApp authentication (Admin Only)
   * This endpoint triggers reconnection which will generate a new QR code
   * @returns QR code data with expiration information
   */
  @Get('admin/qr-code')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async generateQRCodeForAdmin() {
    try {
      // Check if already connected
      const status = await this.whatsappService.getConnectionStatus();

      if (status.ready) {
        // Already connected, need to disconnect first to get new QR
        await this.whatsappService.disconnect();
        // Wait a bit for disconnection to complete
        await new Promise(resolve => setTimeout(resolve, 2000));
        // Reconnect to get new QR
        await this.whatsappService.reconnect();
        // Wait for QR to be generated
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Get the QR code
      const qrData = await this.whatsappService.getQRCode();

      if (!qrData) {
        throw new BadRequestException('QR code not yet generated. Please try again in a few seconds.');
      }

      return {
        success: true,
        data: {
          qr: qrData.qr,
          generatedAt: qrData.generatedAt,
          expiresAt: qrData.expiresAt,
          expiryInSeconds: Math.floor((qrData.expiresAt.getTime() - Date.now()) / 1000),
          message: 'Scan this QR code with WhatsApp mobile app within 60 seconds to authenticate',
        },
      };
    } catch (error) {
      this.logger.error(`Failed to generate QR code: ${error.message}`, error.stack);
      throw new BadRequestException(error.message || 'Failed to generate QR code');
    }
  }

  /**
   * Send a WhatsApp message manually
   * For admin testing and manual message sending
   * @param sendMessageDto Phone number and message
   * @returns Success status
   */
  @Post('send')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async sendMessage(@Body() sendMessageDto: SendMessageDto) {
    try {
      const { phone, message } = sendMessageDto;

      await this.whatsappService.sendMessage(phone, message);

      return {
        success: true,
        message: 'Message sent successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to send message: ${error.message}`, error.stack);
      throw new BadRequestException(error.message || 'Failed to send message');
    }
  }

  /**
   * Disconnect WhatsApp client
   * This will stop the client and clear the session
   * @returns Success status
   */
  @Post('disconnect')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async disconnect() {
    try {
      await this.whatsappService.disconnect();

      return {
        success: true,
        message: 'WhatsApp client disconnected successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to disconnect: ${error.message}`, error.stack);
      throw new BadRequestException(error.message || 'Failed to disconnect WhatsApp client');
    }
  }

  /**
   * Reconnect WhatsApp client
   * This will destroy the current client and create a new one
   * @returns Success status
   */
  @Post('reconnect')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async reconnect() {
    try {
      await this.whatsappService.reconnect();

      return {
        success: true,
        message:
          'WhatsApp client reconnection initiated. Check status endpoint for connection progress.',
      };
    } catch (error) {
      this.logger.error(`Failed to reconnect: ${error.message}`, error.stack);
      throw new BadRequestException(error.message || 'Failed to reconnect WhatsApp client');
    }
  }
}
