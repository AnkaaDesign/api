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

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ClickSignService, SignatureResult } from '@modules/integrations/clicksign/clicksign.service';
import { PpeDocumentService } from './ppe-document.service';
import { PPE_DELIVERY_STATUS, PPE_DELIVERY_STATUS_ORDER } from '@constants';
import { v4 as uuidv4 } from 'uuid';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

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
  ) {
    this.filesRoot = this.configService.get<string>('FILES_ROOT') || './uploads/files';
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
        results: [{
          userId: '',
          deliveryIds: input.deliveryIds,
          error: 'ClickSign não está configurado',
        }],
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
    this.logger.log(`Initiating signature for user ${group.userName} with ${group.deliveryIds.length} deliveries`);

    // Step 1: Generate PDF (batch if multiple deliveries)
    let pdfBuffer: Buffer;
    if (group.deliveryIds.length === 1) {
      pdfBuffer = await this.ppeDocumentService.generateDeliveryDocument(group.deliveryIds[0]);
    } else {
      pdfBuffer = await this.ppeDocumentService.generateBatchDeliveryDocument(group.deliveryIds);
    }

    // Step 2: Save PDF to file storage
    const filename = this.generateFilename(group.userName, group.deliveryIds);
    const savedFile = await this.savePdfToStorage(pdfBuffer, filename, group.deliveryIds[0]);

    // Step 3: Send to ClickSign
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
        clicksignRequestKey: signatureResult.requirementId,
        clicksignSignerKey: signatureResult.signerKey,
        deliveryDocumentId: savedFile.id,
      },
    });

    this.logger.log(`Signature initiated for ${group.deliveryIds.length} deliveries. Envelope: ${signatureResult.envelopeId}`);

    return signatureResult;
  }

  /**
   * Handle signature completion webhook
   */
  async handleSignatureCompletion(input: SignatureCompletionInput): Promise<{
    success: boolean;
    updatedDeliveries: string[];
  }> {
    this.logger.log(`Processing signature completion for document: ${input.documentKey}`);

    // Find all deliveries with this document key
    const deliveries = await this.prisma.ppeDelivery.findMany({
      where: {
        clicksignDocumentKey: input.documentKey,
        status: PPE_DELIVERY_STATUS.WAITING_SIGNATURE,
      },
      include: {
        deliveryDocument: true,
      },
    });

    if (deliveries.length === 0) {
      this.logger.warn(`No deliveries found for document key: ${input.documentKey}`);
      return { success: false, updatedDeliveries: [] };
    }

    const deliveryIds = deliveries.map(d => d.id);

    // Download and save signed document if URL provided
    let signedFileId: string | null = null;
    if (input.signedDocumentUrl) {
      try {
        const signedPdfBuffer = await this.clickSignService.downloadSignedDocument(input.signedDocumentUrl);
        const signedFilename = `signed_${deliveries[0].deliveryDocument?.filename || 'termo_epi.pdf'}`;
        const savedSignedFile = await this.savePdfToStorage(signedPdfBuffer, signedFilename, deliveryIds[0]);
        signedFileId = savedSignedFile.id;

        // Delete old unsigned document if exists
        if (deliveries[0].deliveryDocumentId) {
          await this.deleteOldFile(deliveries[0].deliveryDocumentId);
        }
      } catch (error) {
        this.logger.error(`Error downloading signed document: ${error}`);
        // Continue with completion even if download fails
      }
    }

    // Update all deliveries to COMPLETED
    await this.prisma.ppeDelivery.updateMany({
      where: { id: { in: deliveryIds } },
      data: {
        status: PPE_DELIVERY_STATUS.COMPLETED,
        statusOrder: PPE_DELIVERY_STATUS_ORDER[PPE_DELIVERY_STATUS.COMPLETED],
        clicksignSignedAt: input.signedAt,
        ...(signedFileId && { deliveryDocumentId: signedFileId }),
      },
    });

    this.logger.log(`Signature completion processed. ${deliveryIds.length} deliveries marked as COMPLETED`);

    return {
      success: true,
      updatedDeliveries: deliveryIds,
    };
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
   * Save PDF buffer to file storage and create database record
   */
  private async savePdfToStorage(
    pdfBuffer: Buffer,
    filename: string,
    deliveryId: string,
  ): Promise<{ id: string; path: string }> {
    // Create directory structure: files/ppe-documents/YYYY/MM/
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const relativePath = join('ppe-documents', year, month);
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
        }
        await this.prisma.file.delete({ where: { id: fileId } });
        this.logger.log(`Deleted old file: ${file.path}`);
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

    return {
      status: delivery.status,
      documentKey: delivery.clicksignDocumentKey || undefined,
      signedAt: delivery.clicksignSignedAt || undefined,
      documentUrl: delivery.deliveryDocument
        ? `/files/${delivery.deliveryDocument.id}`
        : undefined,
    };
  }
}
