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
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '@constants';
import { BaileysWhatsAppService } from './baileys-whatsapp.service';
import { WhatsAppOutboundGuard } from './whatsapp-outbound-guard';
import { SendMessageDto } from './dto';
import { COMPANY } from '@config/company';

/**
 * E-mail publicado no perfil comercial do WhatsApp.
 *
 * NÃO é `COMPANY.email`. Aquele é o endereço institucional que sai nos
 * documentos; este é a caixa que de fato atende quem escreve pelo WhatsApp, e
 * publicar um endereço que ninguém lê é pior do que não publicar nenhum.
 */
const WHATSAPP_BUSINESS_EMAIL = 'sergio_ankaa@hotmail.com';

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
    private readonly guard: WhatsAppOutboundGuard,
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
   * Posição da conta perante o WhatsApp: trava de primeiro contato e cota de
   * conversas novas do ciclo.
   *
   * `?refresh=true` vai ao servidor; sem ele responde o último extrato conhecido
   * (memória, ou Redis depois de um restart). O padrão é o cache de propósito:
   * consulta wmex é chamada de rede na conta, e transformar um painel que
   * atualiza sozinho numa enxurrada de consultas é justamente o tipo de tráfego
   * automatizado que queremos evitar.
   */
  @Get('account-standing')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getAccountStanding(@Query('refresh') refresh?: string) {
    try {
      const standing =
        refresh === 'true'
          ? await this.whatsappService.fetchAccountStanding()
          : ((await this.whatsappService.getAccountStanding()) ??
            (await this.whatsappService.fetchAccountStanding()));

      return {
        success: true,
        data: {
          ...standing,
          // Os números do dia moram na guarda de saída, não no extrato do
          // servidor: um é o que o WhatsApp diz de nós, o outro é o que nós
          // decidimos gastar. A tela precisa dos dois lado a lado para que
          // "não consigo enviar" tenha uma resposta na primeira olhada.
          outbound: await this.guard.usage(),
          message: !standing.reachout
            ? 'Não foi possível consultar a trava de primeiro contato.'
            : standing.reachout.isActive
              ? 'Conta sob trava de primeiro contato: mensagens para quem nunca ' +
                'conversou com este número serão recusadas com o nack 463.'
              : 'Sem trava de primeiro contato.',
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get account standing: ${error.message}`, error.stack);
      throw new BadRequestException('Falha ao consultar a posição da conta no WhatsApp');
    }
  }

  /**
   * Preenche o perfil comercial da conta com os dados institucionais.
   *
   * Sem corpo: os valores vêm de `config/company.ts`, que já é a fonte da
   * verdade do que a Ankaa é em todo documento que o servidor emite. Aceitar um
   * corpo aqui abriria caminho para o perfil público divergir do que o orçamento
   * assinado afirma — e é justamente a COINCIDÊNCIA entre os dois (o domínio do
   * link e o site do perfil) que reduz o aviso de "cuidado com links".
   */
  @Post('business-profile/sync')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async syncBusinessProfile() {
    try {
      const standing = await this.whatsappService.updateBusinessProfile({
        description:
          `${COMPANY.name} — envelopamento, pintura e comunicação visual de ` +
          'frotas e implementos rodoviários. Orçamentos e assinatura eletrônica ' +
          `em ${COMPANY.website}.`,
        email: WHATSAPP_BUSINESS_EMAIL,
        address: COMPANY.address,
        websites: [COMPANY.websiteUrl],
      });
      return {
        success: true,
        message: 'Perfil comercial do WhatsApp atualizado.',
        data: standing.businessProfile,
      };
    } catch (error) {
      this.logger.error(`Failed to sync business profile: ${error.message}`, error.stack);
      throw new BadRequestException(
        error.message || 'Falha ao atualizar o perfil comercial do WhatsApp',
      );
    }
  }

  /**
   * Rearma o disjuntor de saída antes da hora.
   *
   * Existe porque o disjuntor é deliberadamente pessimista: um 463 segura o
   * contato frio por 12 h mesmo que a causa tenha sido um número errado. Quem
   * sabe o que aconteceu é o operador. Reabrir sem saber é reincidir — daí a
   * ação ser explícita, de ADMIN, e não um botão de "tentar de novo".
   */
  @Post('outbound/reset-breaker')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async resetBreaker() {
    await this.guard.clearBreaker();
    return { success: true, message: 'Disjuntor de saída rearmado.' };
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
        throw new BadRequestException(
          'QR code not yet generated. Please try again in a few seconds.',
        );
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

      // O booleano é o veredito do SERVIDOR do WhatsApp, não do socket. Ignorá-lo
      // devolvia "Message sent successfully" para mensagem recusada — o mesmo
      // defeito que fez a assinatura do orçamento 883 gravar INVITATION_SENT
      // para dois convites rejeitados com o nack 463 em 2026-08-17.
      const accepted = await this.whatsappService.sendMessage(phone, message);

      if (!accepted) {
        throw new BadRequestException(
          'O WhatsApp não confirmou o envio da mensagem. Veja o log do servidor para o código do nack.',
        );
      }

      return {
        success: true,
        message: 'Message sent successfully',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
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
