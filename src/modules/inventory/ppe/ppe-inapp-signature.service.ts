/**
 * PPE In-App Signature Service
 *
 * Handles the in-app electronic signature workflow for PPE delivery documents.
 * Uses biometric authentication + cryptographic evidence.
 *
 * Legal basis: Lei 14.063/2020, Art. 4° — Advanced electronic signature
 * LGPD compliance: Data minimization, purpose limitation, no raw biometric data stored
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PpeDocumentService } from './ppe-document.service';
import { PPE_DELIVERY_STATUS, PPE_DELIVERY_STATUS_ORDER, ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '@constants';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { FileService } from '@modules/common/file/file.service';
import * as crypto from 'crypto';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { PpeDeliverySignFormData } from '@schemas';

/**
 * Canonical JSON serialization with sorted keys.
 * Required because PostgreSQL JSONB does not preserve key order,
 * so we must ensure deterministic stringification for HMAC computation.
 */
function canonicalJsonStringify(obj: any): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/**
 * Deep canonical JSON stringification — recursively sorts keys at every level.
 */
function deepCanonicalStringify(value: any): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(v => deepCanonicalStringify(v)).join(',') + ']';
  }
  const sortedKeys = Object.keys(value).sort();
  const pairs = sortedKeys.map(k => JSON.stringify(k) + ':' + deepCanonicalStringify(value[k]));
  return '{' + pairs.join(',') + '}';
}

@Injectable()
export class PpeInAppSignatureService {
  private readonly logger = new Logger(PpeInAppSignatureService.name);
  private readonly hmacSecret: string;
  private readonly filesRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly ppeDocumentService: PpeDocumentService,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
  ) {
    this.hmacSecret = this.configService.get<string>('PPE_SIGNATURE_HMAC_SECRET') || '';
    this.filesRoot = this.configService.get<string>('FILES_ROOT') || './files';

    if (!this.hmacSecret) {
      this.logger.warn(
        'PPE_SIGNATURE_HMAC_SECRET not configured — in-app signatures will not be available',
      );
    }
  }

  /**
   * Sign a PPE delivery with biometric evidence
   */
  async signDelivery(
    deliveryId: string,
    evidence: PpeDeliverySignFormData,
    authenticatedUserId: string,
    requestIp?: string,
  ): Promise<{ signatureId: string; hmac: string }> {
    if (!this.hmacSecret) {
      throw new BadRequestException(
        'Assinatura eletrônica in-app não está configurada. Contate o administrador.',
      );
    }

    // 1. Fetch delivery with user data
    const delivery = await this.prisma.ppeDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        user: {
          include: {
            position: true,
            sector: true,
            ppeSize: true,
          },
        },
        item: true,
        signature: true,
      },
    });

    if (!delivery) {
      throw new NotFoundException('Entrega de EPI não encontrada.');
    }

    // 2. Validate: employee signs their own delivery only
    if (delivery.userId !== authenticatedUserId) {
      throw new ForbiddenException(
        'Apenas o colaborador destinatário pode assinar a entrega de EPI.',
      );
    }

    // 3. Validate delivery status
    const allowedStatuses = [PPE_DELIVERY_STATUS.DELIVERED, PPE_DELIVERY_STATUS.WAITING_SIGNATURE];
    if (!allowedStatuses.includes(delivery.status as any)) {
      throw new BadRequestException(
        `Entrega não pode ser assinada no status atual: ${delivery.status}. Status permitidos: DELIVERED, WAITING_SIGNATURE.`,
      );
    }

    // 4. Check if already signed
    if (delivery.signature) {
      throw new BadRequestException('Esta entrega já foi assinada eletronicamente.');
    }

    // 5. Re-compute evidence hash server-side and compare
    const evidenceForHash = this.buildEvidencePayload(evidence);
    const serverHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(evidenceForHash))
      .digest('hex');

    if (serverHash !== evidence.evidenceHash) {
      this.logger.warn(
        `Evidence hash mismatch for delivery ${deliveryId}: client=${evidence.evidenceHash}, server=${serverHash}`,
      );
      throw new BadRequestException(
        'Hash de evidência não confere. Possível adulteração dos dados.',
      );
    }

    // 6. Round GPS coordinates to 4 decimal places (LGPD minimization)
    const latitude = evidence.latitude != null ? Math.round(evidence.latitude * 10000) / 10000 : null;
    const longitude = evidence.longitude != null ? Math.round(evidence.longitude * 10000) / 10000 : null;
    const locationAccuracy = evidence.locationAccuracy != null ? Math.round(evidence.locationAccuracy * 100) / 100 : null;

    // 7. Build evidence JSON for storage
    const serverTimestamp = new Date();
    const evidenceJson = {
      ...evidenceForHash,
      latitude,
      longitude,
      locationAccuracy,
      serverTimestamp: serverTimestamp.toISOString(),
      ipAddress: requestIp || null,
    };

    // 8. Compute HMAC-SHA256 (server-side tamper-proof seal)
    // Uses deep canonical JSON to ensure deterministic key ordering
    // (PostgreSQL JSONB does not preserve insertion order)
    const hmacPayload = deepCanonicalStringify({
      evidence: evidenceJson,
      serverTimestamp: serverTimestamp.toISOString(),
      ipAddress: requestIp || null,
    });
    const hmacSignature = crypto
      .createHmac('sha256', this.hmacSecret)
      .update(hmacPayload)
      .digest('hex');

    // 9. Generate signed PDF
    let signedDocumentId: string | null = null;
    try {
      const signatureEvidence = {
        signerName: delivery.user?.name || 'Nome não informado',
        signerCpf: delivery.user?.cpf || '',
        biometricMethod: evidence.biometricMethod,
        deviceModel: evidence.deviceModel || null,
        clientTimestamp: new Date(evidence.clientTimestamp),
        serverTimestamp,
        latitude,
        longitude,
        hmacSignature,
      };

      const pdfBuffer = await this.ppeDocumentService.generateSignedDeliveryDocument(
        deliveryId,
        signatureEvidence,
      );

      // Save PDF to file storage
      signedDocumentId = await this.savePdfToStorage(
        pdfBuffer,
        delivery,
        'signed',
      );
    } catch (error) {
      this.logger.error(`Failed to generate signed PDF for delivery ${deliveryId}:`, error);
      // Continue without PDF — the signature record is still valid
    }

    // 10. Create PpeDeliverySignature record + update delivery status in transaction
    const result = await this.prisma.$transaction(async tx => {
      const signature = await tx.ppeDeliverySignature.create({
        data: {
          deliveryId,
          signedByUserId: authenticatedUserId,
          signedByCpf: delivery.user?.cpf || '',
          biometricMethod: evidence.biometricMethod,
          biometricSuccess: evidence.biometricSuccess,
          deviceBrand: evidence.deviceBrand || null,
          deviceModel: evidence.deviceModel || null,
          deviceOs: evidence.deviceOs || null,
          deviceOsVersion: evidence.deviceOsVersion || null,
          appVersion: evidence.appVersion || null,
          latitude,
          longitude,
          locationAccuracy,
          networkType: evidence.networkType,
          ipAddress: requestIp || null,
          clientTimestamp: new Date(evidence.clientTimestamp),
          serverTimestamp,
          evidenceHash: evidence.evidenceHash,
          hmacSignature,
          signedDocumentId,
          evidenceJson,
          consentGiven: evidence.consentGiven,
        },
      });

      // Update delivery status to COMPLETED
      await tx.ppeDelivery.update({
        where: { id: deliveryId },
        data: {
          status: PPE_DELIVERY_STATUS.COMPLETED,
          statusOrder: PPE_DELIVERY_STATUS_ORDER.COMPLETED,
        },
      });

      return signature;
    });

    // 11. Log to changelog
    try {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.PPE_DELIVERY,
        entityId: deliveryId,
        action: CHANGE_ACTION.COMPLETE,
        reason: `In-app signature completed for delivery ${deliveryId}`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: authenticatedUserId,
        userId: authenticatedUserId,
        oldValue: { status: delivery.status, signatureId: null },
        newValue: { status: PPE_DELIVERY_STATUS.COMPLETED, signatureId: result.id },
      });
    } catch (error) {
      this.logger.error('Failed to log changelog for in-app signature:', error);
    }

    this.logger.log(
      `In-app signature completed for delivery ${deliveryId} by user ${authenticatedUserId}`,
    );

    return {
      signatureId: result.id,
      hmac: hmacSignature,
    };
  }

  /**
   * Verify the integrity of a signature by re-computing HMAC
   */
  async verifySignature(deliveryId: string): Promise<{ valid: boolean; details?: string }> {
    const signature = await this.prisma.ppeDeliverySignature.findUnique({
      where: { deliveryId },
    });

    if (!signature) {
      throw new NotFoundException('Assinatura eletrônica não encontrada para esta entrega.');
    }

    if (!this.hmacSecret) {
      throw new BadRequestException('HMAC secret não configurado — verificação não disponível.');
    }

    // Re-compute HMAC from stored evidence using deep canonical JSON
    // (matches the signing-time serialization regardless of JSONB key reordering)
    const hmacPayload = deepCanonicalStringify({
      evidence: signature.evidenceJson,
      serverTimestamp: signature.serverTimestamp.toISOString(),
      ipAddress: signature.ipAddress || null,
    });

    const recomputedHmac = crypto
      .createHmac('sha256', this.hmacSecret)
      .update(hmacPayload)
      .digest('hex');

    const valid = recomputedHmac === signature.hmacSignature;

    if (!valid) {
      this.logger.warn(`HMAC verification failed for delivery ${deliveryId}: stored HMAC does not match recomputed value`);
    }

    return {
      valid,
      details: valid
        ? 'Integridade verificada — assinatura íntegra.'
        : 'FALHA NA VERIFICAÇÃO — dados podem ter sido adulterados.',
    };
  }

  /**
   * Get signature details for a delivery (CPF masked for LGPD)
   */
  async getSignatureDetails(deliveryId: string): Promise<any> {
    const signature = await this.prisma.ppeDeliverySignature.findUnique({
      where: { deliveryId },
      include: {
        signedByUser: {
          select: {
            id: true,
            name: true,
          },
        },
        signedDocument: true,
      },
    });

    if (!signature) {
      throw new NotFoundException('Assinatura eletrônica não encontrada para esta entrega.');
    }

    return {
      id: signature.id,
      deliveryId: signature.deliveryId,
      signedBy: {
        id: signature.signedByUser.id,
        name: signature.signedByUser.name,
        cpf: this.maskCpfForLgpd(signature.signedByCpf),
      },
      biometricMethod: signature.biometricMethod,
      biometricSuccess: signature.biometricSuccess,
      deviceModel: signature.deviceModel,
      clientTimestamp: signature.clientTimestamp,
      serverTimestamp: signature.serverTimestamp,
      latitude: signature.latitude,
      longitude: signature.longitude,
      networkType: signature.networkType,
      verificationCode: signature.hmacSignature.substring(0, 16),
      legalBasis: signature.legalBasis,
      consentGiven: signature.consentGiven,
      signedDocumentId: signature.signedDocumentId,
      signedDocument: (signature as any).signedDocument || null,
      createdAt: signature.createdAt,
    };
  }

  /**
   * Mask CPF for LGPD compliance: 123.456.789-01 → ***.456.789-**
   */
  private maskCpfForLgpd(cpf: string): string {
    if (!cpf) return '***.***.***-**';
    const digits = cpf.replace(/\D/g, '');
    if (digits.length < 11) return '***.***.***-**';
    return `***.${digits.substring(3, 6)}.${digits.substring(6, 9)}-**`;
  }

  /**
   * Build the evidence payload that the client should hash
   * This must match what the mobile app hashes for verification
   */
  private buildEvidencePayload(evidence: PpeDeliverySignFormData): Record<string, any> {
    return {
      biometricMethod: evidence.biometricMethod,
      biometricSuccess: evidence.biometricSuccess,
      deviceBrand: evidence.deviceBrand ?? null,
      deviceModel: evidence.deviceModel ?? null,
      deviceOs: evidence.deviceOs ?? null,
      deviceOsVersion: evidence.deviceOsVersion ?? null,
      appVersion: evidence.appVersion ?? null,
      latitude: evidence.latitude ?? null,
      longitude: evidence.longitude ?? null,
      locationAccuracy: evidence.locationAccuracy ?? null,
      networkType: evidence.networkType,
      clientTimestamp: evidence.clientTimestamp,
      consentGiven: evidence.consentGiven,
    };
  }

  /**
   * Save PDF to file storage and create File record
   */
  private async savePdfToStorage(
    pdfBuffer: Buffer,
    delivery: any,
    prefix: string,
  ): Promise<string | null> {
    try {
      const userName = delivery.user?.name || 'Desconhecido';
      const sanitizedName = userName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '_');

      const now = new Date();
      const year = String(now.getFullYear()).slice(-2);
      const month = String(now.getMonth() + 1).padStart(2, '0');

      const dirPath = join(
        this.filesRoot,
        'Colaboradores',
        sanitizedName,
        "EPI's",
        year,
        month,
      );

      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }

      const filename = `${prefix}_epi_${delivery.id.substring(0, 8)}_${Date.now()}.pdf`;
      const filePath = join(dirPath, filename);

      writeFileSync(filePath, pdfBuffer);

      // Create File record in database
      const file = await this.prisma.file.create({
        data: {
          filename,
          originalName: `Termo de Entrega EPI - ${userName} - Assinado.pdf`,
          mimetype: 'application/pdf',
          path: filePath,
          size: pdfBuffer.length,
        },
      });

      return file.id;
    } catch (error) {
      this.logger.error('Failed to save signed PDF:', error);
      return null;
    }
  }
}
