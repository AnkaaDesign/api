/**
 * PPE Signature Service
 *
 * Handles the digital signature workflow for PPE delivery documents.
 * Integrates with ClickSign API for electronic signatures.
 *
 * Key responsibilities:
 * - Generate PDF for PPE delivery(ies)
 * - Save PDF to file storage
 * - Send to ClickSign for signature
 * - Update delivery status to WAITING_SIGNATURE
 * - Handle signature completion webhook
 * - Download and save signed document
 */

import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  ClickSignService,
  SignatureResult,
} from '@modules/integrations/clicksign/clicksign.service';
import { BaileysWhatsAppService } from '@modules/common/whatsapp/baileys-whatsapp.service';
import { PpeDocumentService } from './ppe-document.service';
import { PPE_DELIVERY_STATUS, PPE_DELIVERY_STATUS_ORDER } from '@constants';
import { v4 as uuidv4 } from 'uuid';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';

export interface InitiateSignatureInput {
  deliveryIds: string[];
  userId?: string;
}

export interface SignatureCompletionInput {
  envelopeId: string;
  documentKey: string;
  signedAt: Date;
  signedDocumentUrl?: string;
}

export interface BatchDeliveryGroup {
  userId: string;
  userName: string;
  userEmail: string;
  userCpf?: string;
  userPhone?: string;
  deliveryIds: string[];
}

@Injectable()
export class PpeSignatureService {
  private readonly logger = new Logger(PpeSignatureService.name);
  private readonly filesRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly clickSignService: ClickSignService,
    private readonly ppeDocumentService: PpeDocumentService,
    @Inject('WhatsAppService')
    private readonly whatsappService: BaileysWhatsAppService,
  ) {
    // File storage root - FILES_ROOT is validated by env.validation.ts (defaults to './files')
    // In production this is typically set to an absolute path (e.g. /srv/files)
    this.filesRoot = this.configService.get<string>('FILES_ROOT') || './files';
  }

  /**
   * Check if ClickSign integration is available
   */
  isClickSignAvailable(): boolean {
    return this.clickSignService.isAvailable();
  }

  /**
   * Initiate signature workflow for multiple deliveries
   * Groups deliveries by user and creates one signature request per user
   */
  async initiateSignatureForDeliveries(input: InitiateSignatureInput): Promise<{
    success: boolean;
    results: Array<{
      userId: string;
      deliveryIds: string[];
      signatureResult?: SignatureResult;
      error?: string;
    }>;
  }> {
    if (!this.clickSignService.isAvailable()) {
      this.logger.warn('ClickSign not configured - skipping signature initiation');
      return {
        success: false,
        results: [
          {
            userId: '',
            deliveryIds: input.deliveryIds,
            error: 'ClickSign não está configurado',
          },
        ],
      };
    }

    // Group deliveries by user
    const groups = await this.groupDeliveriesByUser(input.deliveryIds);
    const results: Array<{
      userId: string;
      deliveryIds: string[];
      signatureResult?: SignatureResult;
      error?: string;
    }> = [];

    // Process each group (one signature per user)
    for (const group of groups) {
      try {
        const result = await this.initiateSignatureForUserGroup(group, input.userId);
        results.push({
          userId: group.userId,
          deliveryIds: group.deliveryIds,
          signatureResult: result,
        });
      } catch (error) {
        this.logger.error(`Error initiating signature for user ${group.userId}: ${error}`);
        results.push({
          userId: group.userId,
          deliveryIds: group.deliveryIds,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
        });
      }
    }

    return {
      success: results.every(r => !r.error),
      results,
    };
  }

  /**
   * Group deliveries by user for batch signature
   */
  private async groupDeliveriesByUser(deliveryIds: string[]): Promise<BatchDeliveryGroup[]> {
    const deliveries = await this.prisma.ppeDelivery.findMany({
      where: {
        id: { in: deliveryIds },
        status: PPE_DELIVERY_STATUS.DELIVERED,
      },
      include: {
        user: true,
      },
    });

    // Group by userId
    const groupMap = new Map<string, BatchDeliveryGroup>();

    for (const delivery of deliveries) {
      if (!delivery.user) continue;

      const existing = groupMap.get(delivery.userId);
      if (existing) {
        existing.deliveryIds.push(delivery.id);
      } else {
        groupMap.set(delivery.userId, {
          userId: delivery.userId,
          userName: delivery.user.name,
          userEmail: delivery.user.email,
          userCpf: delivery.user.cpf || undefined,
          userPhone: delivery.user.phone || undefined,
          deliveryIds: [delivery.id],
        });
      }
    }

    return Array.from(groupMap.values());
  }

  /**
   * Initiate signature for a single user's deliveries
   */
  private async initiateSignatureForUserGroup(
    group: BatchDeliveryGroup,
    triggeredByUserId?: string,
  ): Promise<SignatureResult> {
    this.logger.log(
      `Initiating signature for user ${group.userName} with ${group.deliveryIds.length} deliveries`,
    );

    // Step 1: Generate PDF (batch if multiple deliveries)
    let pdfBuffer: Buffer;
    if (group.deliveryIds.length === 1) {
      pdfBuffer = await this.ppeDocumentService.generateDeliveryDocument(group.deliveryIds[0]);
    } else {
      pdfBuffer = await this.ppeDocumentService.generateBatchDeliveryDocument(group.deliveryIds);
    }

    // Step 2: Save PDF to file storage with user-specific path
    const filename = this.generateFilename(group.userName, group.deliveryIds);
    const savedFile = await this.savePdfToStorage(
      pdfBuffer,
      filename,
      group.userName,
      group.deliveryIds[0],
    );

    // Step 3: Send to ClickSign - sends notification directly to user's email
    const signatureResult = await this.clickSignService.initiateSignature(
      pdfBuffer,
      filename,
      group.deliveryIds,
      {
        email: group.userEmail,
        name: group.userName,
        cpf: group.userCpf,
        phoneNumber: group.userPhone,
      },
    );

    // Step 4: Update all deliveries with ClickSign info and status
    await this.prisma.ppeDelivery.updateMany({
      where: { id: { in: group.deliveryIds } },
      data: {
        status: PPE_DELIVERY_STATUS.WAITING_SIGNATURE,
        statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.WAITING_SIGNATURE],
        clicksignEnvelopeId: signatureResult.envelopeId,
        clicksignDocumentKey: signatureResult.documentKey,
        clicksignSignerKey: signatureResult.signerKey,
        deliveryDocumentId: savedFile.id,
      },
    });

    this.logger.log(
      `Signature initiated for ${group.deliveryIds.length} deliveries. Envelope: ${signatureResult.envelopeId}`,
    );

    // Step 5: Send WhatsApp notification to user about pending signature
    await this.sendSignatureRequestWhatsApp(group);

    return signatureResult;
  }

  /**
   * Send WhatsApp notification to user about pending signature
   */
  private async sendSignatureRequestWhatsApp(group: BatchDeliveryGroup): Promise<void> {
    if (!group.userPhone) {
      this.logger.warn(`User ${group.userName} has no phone number for WhatsApp notification`);
      return;
    }

    try {
      const itemCount = group.deliveryIds.length;
      const itemText = itemCount === 1 ? '1 item de EPI' : `${itemCount} itens de EPI`;

      const message = `Olá ${group.userName}! 👋

Você recebeu ${itemText} e precisa assinar o termo de entrega digitalmente.

📋 *Assinatura Digital de EPI*

Você receberá um e-mail da ClickSign com o link para assinatura.

⏰ Por favor, assine o documento o mais breve possível.`;

      await this.whatsappService.sendMessage(group.userPhone, message);
      this.logger.log(`WhatsApp notification sent to ${group.userName} (${group.userPhone})`);
    } catch (error) {
      this.logger.error(`Failed to send WhatsApp notification to ${group.userName}: ${error}`);
      // Don't throw - WhatsApp notification is not critical
    }
  }

  /**
   * Handle signature completion webhook
   * Idempotent - safe to call multiple times for same document
   *
   * Flow:
   * 1. Find deliveries by document key
   * 2. Get signed document URL (from webhook or fetch from API)
   * 3. Download signed PDF
   * 4. Save signed PDF and replace original
   * 5. Update delivery status to COMPLETED
   * 6. Send WhatsApp notification
   */
  async handleSignatureCompletion(input: SignatureCompletionInput): Promise<{
    success: boolean;
    updatedDeliveries: string[];
  }> {
    this.logger.log(`Processing signature completion for document: ${input.documentKey}`);

    // Find all deliveries with this document key that are WAITING_SIGNATURE
    const deliveries = await this.prisma.ppeDelivery.findMany({
      where: {
        clicksignDocumentKey: input.documentKey,
        status: PPE_DELIVERY_STATUS.WAITING_SIGNATURE,
      },
      include: {
        deliveryDocument: true,
        user: true,
      },
    });

    // If no deliveries found in WAITING_SIGNATURE status, check if already completed
    if (deliveries.length === 0) {
      const alreadyCompleted = await this.prisma.ppeDelivery.findMany({
        where: {
          clicksignDocumentKey: input.documentKey,
          status: PPE_DELIVERY_STATUS.COMPLETED,
        },
        include: {
          deliveryDocument: true,
          user: true,
        },
      });

      if (alreadyCompleted.length > 0) {
        // Check if we still need to download the signed document
        // This handles the case where auto_close fires before signed PDF is ready,
        // but document_closed fires later with the signed PDF available
        const needsSignedDoc = alreadyCompleted.some(
          d => !d.deliveryDocument?.filename?.includes('_assinado'),
        );

        if (needsSignedDoc && input.signedDocumentUrl) {
          this.logger.log(
            `Document ${input.documentKey} already completed but signed PDF not yet downloaded - attempting download`,
          );
          await this.downloadAndSaveSignedDocument(input.signedDocumentUrl, alreadyCompleted);
          return { success: true, updatedDeliveries: [] };
        }

        // Also try fetching from API if URL not in webhook
        if (needsSignedDoc && alreadyCompleted[0].clicksignEnvelopeId) {
          const signedUrl = await this.clickSignService.fetchSignedDocumentUrl(
            alreadyCompleted[0].clicksignEnvelopeId,
            input.documentKey,
          );
          if (signedUrl) {
            this.logger.log(`Fetched signed URL for already-completed document - downloading`);
            await this.downloadAndSaveSignedDocument(signedUrl, alreadyCompleted);
            return { success: true, updatedDeliveries: [] };
          }
        }

        this.logger.log(
          `Document ${input.documentKey} already completed - ignoring duplicate webhook`,
        );
        return { success: true, updatedDeliveries: [] };
      }

      this.logger.warn(`No deliveries found for document key: ${input.documentKey}`);
      return { success: false, updatedDeliveries: [] };
    }

    const deliveryIds = deliveries.map(d => d.id);
    const userName = deliveries[0].user?.name || 'Unknown';
    const envelopeId = deliveries[0].clicksignEnvelopeId;

    // Download and save signed document, replacing the original
    let signedFileId: string | null = null;
    const oldDocumentId = deliveries[0].deliveryDocumentId;

    // Get signed document URL - from webhook or fetch from API
    let signedDocumentUrl = input.signedDocumentUrl;

    // If URL not in webhook, fetch it from ClickSign API
    // This is necessary because auto_close webhook may not include download URLs
    if (!signedDocumentUrl && envelopeId && this.clickSignService.isAvailable()) {
      this.logger.log(`Signed URL not in webhook, fetching from ClickSign API...`);
      signedDocumentUrl = await this.clickSignService.fetchSignedDocumentUrl(
        envelopeId,
        input.documentKey,
      );
    }

    if (signedDocumentUrl) {
      try {
        this.logger.log(`Downloading signed document from: ${signedDocumentUrl}`);
        const signedPdfBuffer =
          await this.clickSignService.downloadSignedDocument(signedDocumentUrl);

        // Use same filename as original but with _assinado suffix
        const originalFilename = deliveries[0].deliveryDocument?.filename || 'termo_epi.pdf';
        const signedFilename = originalFilename.replace('.pdf', '_assinado.pdf');

        const savedSignedFile = await this.savePdfToStorage(
          signedPdfBuffer,
          signedFilename,
          userName,
          deliveryIds[0],
        );
        signedFileId = savedSignedFile.id;
        this.logger.log(`Signed document saved: ${savedSignedFile.path}`);
      } catch (error) {
        this.logger.error(`Error downloading signed document: ${error}`);
        // Continue with completion even if download fails
      }
    } else {
      this.logger.warn(`No signed document URL available - signed PDF will not be downloaded`);
    }

    // Update all deliveries to COMPLETED with signed document
    await this.prisma.ppeDelivery.updateMany({
      where: { id: { in: deliveryIds } },
      data: {
        status: PPE_DELIVERY_STATUS.COMPLETED,
        statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.COMPLETED],
        clicksignSignedAt: input.signedAt,
        // Replace document with signed version if available
        ...(signedFileId && { deliveryDocumentId: signedFileId }),
      },
    });

    // Delete old unsigned document if we have a new signed one
    if (signedFileId && oldDocumentId && oldDocumentId !== signedFileId) {
      await this.deleteOldFile(oldDocumentId);
    }

    this.logger.log(
      `Signature completion processed. ${deliveryIds.length} deliveries marked as COMPLETED`,
    );

    // Send WhatsApp notification to user about completed signature
    await this.sendSignatureCompletedWhatsApp(deliveries);

    return {
      success: true,
      updatedDeliveries: deliveryIds,
    };
  }

  /**
   * Download and save signed document for already-completed deliveries
   * Used when document_closed webhook arrives after auto_close already marked as complete
   */
  private async downloadAndSaveSignedDocument(
    signedDocumentUrl: string,
    deliveries: any[],
  ): Promise<void> {
    try {
      const userName = deliveries[0].user?.name || 'Unknown';
      const oldDocumentId = deliveries[0].deliveryDocumentId;
      const deliveryIds = deliveries.map(d => d.id);

      this.logger.log(
        `Downloading signed document for completed delivery: ${signedDocumentUrl.substring(0, 80)}...`,
      );
      const signedPdfBuffer = await this.clickSignService.downloadSignedDocument(signedDocumentUrl);

      // Use same filename as original but with _assinado suffix
      const originalFilename = deliveries[0].deliveryDocument?.filename || 'termo_epi.pdf';
      const signedFilename = originalFilename.replace('.pdf', '_assinado.pdf');

      const savedSignedFile = await this.savePdfToStorage(
        signedPdfBuffer,
        signedFilename,
        userName,
        deliveryIds[0],
      );

      // Update deliveries with signed document reference
      await this.prisma.ppeDelivery.updateMany({
        where: { id: { in: deliveryIds } },
        data: {
          deliveryDocumentId: savedSignedFile.id,
        },
      });

      this.logger.log(`Signed document saved and linked: ${savedSignedFile.path}`);

      // Delete old unsigned document
      if (oldDocumentId && oldDocumentId !== savedSignedFile.id) {
        await this.deleteOldFile(oldDocumentId);
      }
    } catch (error) {
      this.logger.error(`Error downloading signed document for completed delivery: ${error}`);
    }
  }

  /**
   * Send WhatsApp notification to user about completed signature
   */
  private async sendSignatureCompletedWhatsApp(deliveries: any[]): Promise<void> {
    if (deliveries.length === 0) return;

    const user = deliveries[0].user;
    if (!user?.phone) {
      this.logger.warn(`User has no phone number for WhatsApp completion notification`);
      return;
    }

    try {
      const itemCount = deliveries.length;
      const itemText = itemCount === 1 ? '1 item de EPI' : `${itemCount} itens de EPI`;

      const message = `✅ *Assinatura Concluída!*

Olá ${user.name}!

Sua assinatura do termo de entrega de ${itemText} foi registrada com sucesso.

📄 O documento assinado está arquivado em nosso sistema.

Obrigado pela colaboração!`;

      await this.whatsappService.sendMessage(user.phone, message);
      this.logger.log(`WhatsApp completion notification sent to ${user.name}`);
    } catch (error) {
      this.logger.error(`Failed to send WhatsApp completion notification: ${error}`);
      // Don't throw - WhatsApp notification is not critical
    }
  }

  /**
   * Manually complete signature (for testing/fallback)
   */
  async manuallyCompleteSignature(deliveryId: string, userId?: string): Promise<void> {
    const delivery = await this.prisma.ppeDelivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery) {
      throw new NotFoundException('Entrega não encontrada');
    }

    if (delivery.status !== PPE_DELIVERY_STATUS.WAITING_SIGNATURE) {
      throw new BadRequestException('Entrega não está aguardando assinatura');
    }

    // If this delivery is part of a batch (same document key), complete all
    const deliveriesToComplete = delivery.clicksignDocumentKey
      ? await this.prisma.ppeDelivery.findMany({
          where: {
            clicksignDocumentKey: delivery.clicksignDocumentKey,
            status: PPE_DELIVERY_STATUS.WAITING_SIGNATURE,
          },
        })
      : [delivery];

    const deliveryIds = deliveriesToComplete.map(d => d.id);

    await this.prisma.ppeDelivery.updateMany({
      where: { id: { in: deliveryIds } },
      data: {
        status: PPE_DELIVERY_STATUS.COMPLETED,
        statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.COMPLETED],
        clicksignSignedAt: new Date(),
      },
    });

    this.logger.log(`Manually completed signature for ${deliveryIds.length} deliveries`);
  }

  /**
   * Handle signature refusal from webhook (by document key)
   */
  async handleSignatureRefusal(documentKey: string, reason: string): Promise<void> {
    this.logger.log(`Processing signature refusal for document: ${documentKey}`);

    // Find all deliveries with this document key
    const deliveries = await this.prisma.ppeDelivery.findMany({
      where: {
        clicksignDocumentKey: documentKey,
        status: PPE_DELIVERY_STATUS.WAITING_SIGNATURE,
      },
      include: { user: true },
    });

    if (deliveries.length === 0) {
      this.logger.warn(`No deliveries found for document key: ${documentKey}`);
      return;
    }

    const deliveryIds = deliveries.map(d => d.id);

    await this.prisma.ppeDelivery.updateMany({
      where: { id: { in: deliveryIds } },
      data: {
        status: PPE_DELIVERY_STATUS.SIGNATURE_REJECTED,
        statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.SIGNATURE_REJECTED],
        reason,
      },
    });

    this.logger.log(
      `Signature refusal processed. ${deliveryIds.length} deliveries marked as SIGNATURE_REJECTED`,
    );

    // Send WhatsApp notification to user about rejection
    if (deliveries[0]?.user?.phone) {
      try {
        const message = `⚠️ *Assinatura Recusada*

Olá ${deliveries[0].user.name}!

O documento de entrega de EPI foi recusado.

Motivo: ${reason}

Entre em contato com o setor responsável para mais informações.`;

        await this.whatsappService.sendMessage(deliveries[0].user.phone, message);
      } catch (error) {
        this.logger.error(`Failed to send WhatsApp rejection notification: ${error}`);
      }
    }
  }

  /**
   * Reject signature and revert to previous status
   */
  async rejectSignature(deliveryId: string, reason?: string): Promise<void> {
    const delivery = await this.prisma.ppeDelivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery) {
      throw new NotFoundException('Entrega não encontrada');
    }

    if (delivery.status !== PPE_DELIVERY_STATUS.WAITING_SIGNATURE) {
      throw new BadRequestException('Entrega não está aguardando assinatura');
    }

    // If part of batch, reject all
    const deliveriesToReject = delivery.clicksignDocumentKey
      ? await this.prisma.ppeDelivery.findMany({
          where: {
            clicksignDocumentKey: delivery.clicksignDocumentKey,
            status: PPE_DELIVERY_STATUS.WAITING_SIGNATURE,
          },
        })
      : [delivery];

    const deliveryIds = deliveriesToReject.map(d => d.id);

    await this.prisma.ppeDelivery.updateMany({
      where: { id: { in: deliveryIds } },
      data: {
        status: PPE_DELIVERY_STATUS.SIGNATURE_REJECTED,
        statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.SIGNATURE_REJECTED],
        reason: reason || delivery.reason,
      },
    });

    this.logger.log(`Signature rejected for ${deliveryIds.length} deliveries`);
  }

  /**
   * Resend signature notification
   */
  async resendSignatureNotification(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.ppeDelivery.findUnique({
      where: { id: deliveryId },
      include: { user: true },
    });

    if (!delivery) {
      throw new NotFoundException('Entrega não encontrada');
    }

    if (delivery.status !== PPE_DELIVERY_STATUS.WAITING_SIGNATURE) {
      throw new BadRequestException('Entrega não está aguardando assinatura');
    }

    if (!delivery.clicksignEnvelopeId) {
      throw new BadRequestException('Informações do ClickSign não encontradas');
    }

    // Resend notification using ClickSign API
    await this.clickSignService.sendNotification(delivery.clicksignEnvelopeId);

    this.logger.log(`Notification resent for delivery ${deliveryId}`);
  }

  /**
   * Generate filename for PDF document
   */
  private generateFilename(userName: string, deliveryIds: string[]): string {
    const sanitizedName = userName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .substring(0, 30);

    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const uniqueId = uuidv4().substring(0, 8);

    return `termo_epi_${sanitizedName}_${timestamp}_${uniqueId}.pdf`;
  }

  /**
   * Sanitize user name for use in file path
   */
  private sanitizeUserNameForPath(userName: string): string {
    return userName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special chars except spaces
      .trim()
      .replace(/\s+/g, ' '); // Normalize spaces
  }

  /**
   * Save PDF buffer to file storage and create database record
   * Path structure: {FILES_ROOT}/Colaboradores/[User Name]/EPI's/YY/MM/
   */
  private async savePdfToStorage(
    pdfBuffer: Buffer,
    filename: string,
    userName: string,
    deliveryId: string,
  ): Promise<{ id: string; path: string }> {
    // Create directory structure: {FILES_ROOT}/Colaboradores/[User Name]/EPI's/YY/MM/
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2); // Last 2 digits (YY)
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const sanitizedUserName = this.sanitizeUserNameForPath(userName);

    const relativePath = join('Colaboradores', sanitizedUserName, "EPI's", year, month);
    const absoluteDir = join(this.filesRoot, relativePath);

    // Ensure directory exists
    if (!existsSync(absoluteDir)) {
      mkdirSync(absoluteDir, { recursive: true });
    }

    // Write file to disk
    const filePath = join(absoluteDir, filename);
    writeFileSync(filePath, pdfBuffer);

    // Create database record
    const fileRecord = await this.prisma.file.create({
      data: {
        filename,
        originalName: filename,
        mimetype: 'application/pdf',
        path: join(relativePath, filename),
        size: pdfBuffer.length,
      },
    });

    this.logger.log(`PDF saved: ${filePath} (${pdfBuffer.length} bytes)`);

    return {
      id: fileRecord.id,
      path: fileRecord.path,
    };
  }

  /**
   * Delete old file when replacing with signed version
   */
  private async deleteOldFile(fileId: string): Promise<void> {
    try {
      const file = await this.prisma.file.findUnique({ where: { id: fileId } });
      if (file) {
        const absolutePath = join(this.filesRoot, file.path);
        if (existsSync(absolutePath)) {
          unlinkSync(absolutePath);
          this.logger.log(`Deleted old file from disk: ${file.path}`);
        }
        await this.prisma.file.delete({ where: { id: fileId } });
        this.logger.log(`Deleted old file record: ${fileId}`);
      }
    } catch (error) {
      this.logger.error(`Error deleting old file ${fileId}: ${error}`);
      // Non-critical error, don't throw
    }
  }

  /**
   * Get signature status for a delivery
   */
  async getSignatureStatus(deliveryId: string): Promise<{
    status: string;
    documentKey?: string;
    signedAt?: Date;
    documentUrl?: string;
    signatureUrl?: string;
  }> {
    const delivery = await this.prisma.ppeDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        deliveryDocument: true,
      },
    });

    if (!delivery) {
      throw new NotFoundException('Entrega não encontrada');
    }

    // Get signature URL if delivery is waiting for signature
    let signatureUrl: string | undefined;
    if (
      delivery.status === PPE_DELIVERY_STATUS.WAITING_SIGNATURE &&
      delivery.clicksignEnvelopeId &&
      delivery.clicksignSignerKey
    ) {
      try {
        signatureUrl = await this.clickSignService.getSignerUrl(
          delivery.clicksignEnvelopeId,
          delivery.clicksignSignerKey,
        );
      } catch (error) {
        this.logger.warn(`Could not get signature URL: ${error}`);
      }
    }

    return {
      status: delivery.status,
      documentKey: delivery.clicksignDocumentKey || undefined,
      signedAt: delivery.clicksignSignedAt || undefined,
      documentUrl: delivery.deliveryDocument ? `/files/${delivery.deliveryDocument.id}` : undefined,
      signatureUrl,
    };
  }
}
