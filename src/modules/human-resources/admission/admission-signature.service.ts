/**
 * Admission Document In-App Signature Service
 *
 * Handles the in-app electronic signature workflow for assinable admission
 * documents (notably the "Termo LGPD" / LGPD_TERM). It reuses the exact
 * evidence/HMAC/PAdES pipeline built for PPE delivery signatures:
 *
 *  - Biometric assertion result (NO raw biometric stored — LGPD minimization)
 *  - SHA-256 evidence hash re-computed server-side (anti-tamper)
 *  - HMAC-SHA256 seal over the canonicalized evidence JSON
 *  - SHA-256 of the original PDF (documentSha256)
 *  - Server-side PAdES (ICP-Brasil A1) seal via the shared PpePadesSignerService
 *
 * Legal basis: Lei 14.063/2020, Art. 4° (advanced electronic signature) +
 * Medida Provisória 2.200-2/2001 (ICP-Brasil seal) + LGPD (consent + minimization).
 *
 * The evidence/HMAC builders are PORTED from PpeInAppSignatureService so the
 * PPE module's behavior is never modified; only PpePadesSignerService is shared.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { PpePadesSignerService, CertMetadata } from '@modules/inventory/ppe/ppe-pades-signer.service';
import {
  ADMISSION_DOCUMENT_STATUS,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  SECTOR_PRIVILEGES,
} from '../../../constants';
import * as crypto from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AdmissionDocumentSignFormData } from '../../../schemas';

const LEGAL_BASIS =
  'Lei 14.063/2020, Art. 4° (assinatura eletrônica avançada); MP 2.200-2/2001 (ICP-Brasil); LGPD (consentimento e minimização).';

/**
 * Deep canonical JSON stringification — recursively sorts keys at every level.
 * Required because PostgreSQL JSONB does not preserve key order, so the HMAC
 * must be computed over a deterministic serialization. (Ported from PPE.)
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

export interface AdmissionSignatureResult {
  documentId: string;
  signedFileId: string | null;
  hmac: string;
  padesSealed: boolean;
}

@Injectable()
export class AdmissionSignatureService {
  private readonly logger = new Logger(AdmissionSignatureService.name);
  private readonly hmacSecret: string;
  private readonly filesRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly changeLogService: ChangeLogService,
    private readonly padesSigner: PpePadesSignerService,
  ) {
    // Reuse the same HMAC secret as the PPE pipeline so verification tooling and
    // legal posture are uniform across the company's in-app signatures.
    this.hmacSecret = this.configService.get<string>('PPE_SIGNATURE_HMAC_SECRET') || '';
    this.filesRoot = this.configService.get<string>('FILES_ROOT') || './files';

    if (!this.hmacSecret) {
      this.logger.warn(
        'PPE_SIGNATURE_HMAC_SECRET not configured — admission in-app signatures will not be available',
      );
    }
  }

  /**
   * Sign an admission document (e.g. the LGPD_TERM) with biometric evidence.
   * Generic for any AdmissionDocument that already has an uploaded source file.
   */
  async signDocument(
    documentId: string,
    evidence: AdmissionDocumentSignFormData,
    authenticatedUserId: string,
    actorPrivilege?: string | null,
    requestIp?: string,
  ): Promise<AdmissionSignatureResult> {
    if (!this.hmacSecret) {
      throw new BadRequestException(
        'Assinatura eletrônica in-app não está configurada. Contate o administrador.',
      );
    }

    // 1. Fetch the document + its admission's collaborator and the source file.
    const document = await this.prisma.admissionDocument.findUnique({
      where: { id: documentId },
      include: {
        file: true,
        admission: {
          include: {
            user: { select: { id: true, name: true, cpf: true } },
          },
        },
      },
    });

    if (!document) {
      throw new NotFoundException('Documento da admissão não encontrado.');
    }

    const collaborator = document.admission?.user;
    if (!collaborator) {
      throw new BadRequestException('Documento sem colaborador vinculado — não pode ser assinado.');
    }

    // 2. Permission: the collaborator signs their own document, OR HR/ADMIN.
    const isOwner = collaborator.id === authenticatedUserId;
    const isHrOrAdmin =
      actorPrivilege === SECTOR_PRIVILEGES.HUMAN_RESOURCES ||
      actorPrivilege === SECTOR_PRIVILEGES.ADMIN ||
      actorPrivilege === SECTOR_PRIVILEGES.ACCOUNTING;
    if (!isOwner && !isHrOrAdmin) {
      throw new ForbiddenException(
        'Apenas o próprio colaborador ou o RH/Administração podem assinar este documento.',
      );
    }

    // 3. Already signed?
    if (document.status === ADMISSION_DOCUMENT_STATUS.SIGNED || document.signedAt) {
      throw new BadRequestException('Este documento já foi assinado eletronicamente.');
    }

    // 4. Source PDF must exist — without a term-PDF generator we sign the
    // uploaded source file (fileId). Web/mobile must upload it first.
    if (!document.fileId || !document.file) {
      throw new BadRequestException(
        'O documento ainda não possui um arquivo de origem para assinar. Envie o termo (PDF) antes de assinar.',
      );
    }

    const sourcePath = document.file.path;
    if (!sourcePath || !existsSync(sourcePath)) {
      throw new BadRequestException(
        'Arquivo de origem do documento não encontrado no armazenamento.',
      );
    }

    // 5. Hard-require a real biometric proof (mirrors PPE — emulators that
    // return success:false must not be able to complete the flow).
    if (!evidence.biometricSuccess || evidence.biometricMethod === 'NONE') {
      throw new BadRequestException(
        'Autenticação biométrica obrigatória. Habilite a biometria do dispositivo e tente novamente.',
      );
    }

    // 6. Re-compute the evidence hash server-side and compare (anti-tamper).
    const evidenceForHash = this.buildEvidencePayload(evidence);
    const serverHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(evidenceForHash))
      .digest('hex');

    if (serverHash !== evidence.evidenceHash) {
      this.logger.warn(
        `Evidence hash mismatch for admission document ${documentId}: client=${evidence.evidenceHash}, server=${serverHash}`,
      );
      throw new BadRequestException(
        'Hash de evidência não confere. Possível adulteração dos dados.',
      );
    }

    // 7. Round GPS coordinates (LGPD minimization).
    const latitude =
      evidence.latitude != null ? Math.round(evidence.latitude * 10000) / 10000 : null;
    const longitude =
      evidence.longitude != null ? Math.round(evidence.longitude * 10000) / 10000 : null;
    const locationAccuracy =
      evidence.locationAccuracy != null ? Math.round(evidence.locationAccuracy * 100) / 100 : null;

    // 8. Build evidence JSON for storage.
    const serverTimestamp = new Date();
    const evidenceJson = {
      ...evidenceForHash,
      latitude,
      longitude,
      locationAccuracy,
      serverTimestamp: serverTimestamp.toISOString(),
      ipAddress: requestIp || null,
      signerName: collaborator.name || 'Nome não informado',
      signerCpf: collaborator.cpf || '',
    };

    // 9. HMAC-SHA256 seal over the canonicalized evidence (ported from PPE).
    const hmacPayload = deepCanonicalStringify({
      evidence: evidenceJson,
      serverTimestamp: serverTimestamp.toISOString(),
      ipAddress: requestIp || null,
    });
    const hmacSignature = crypto
      .createHmac('sha256', this.hmacSecret)
      .update(hmacPayload)
      .digest('hex');

    // 10. SHA-256 of the original (unsigned) PDF.
    const originalPdf = readFileSync(sourcePath);
    const documentSha256 = crypto.createHash('sha256').update(originalPdf).digest('hex');

    // 11. PAdES-seal the PDF using the shared PPE signer (ICP-Brasil A1).
    let signedPdf: Buffer = originalPdf;
    let padesSealed = false;
    let padesSealedAt: Date | null = null;
    let certMeta: CertMetadata | null = null;

    if (this.padesSigner.isEnabled()) {
      try {
        const sealed = await this.padesSigner.sealPdf(originalPdf, {
          reason: `Termo de admissão (${document.type}) — ${documentId}`,
          location: 'Ibiporã-PR, Brasil',
          signerName: this.padesSigner.getCertMetadata()?.subjectCommonName || 'Ankaa Design',
          contactInfo: 'contato@ankaadesign.com.br',
          signingTime: serverTimestamp,
        });
        signedPdf = sealed.signedPdf;
        padesSealed = true;
        padesSealedAt = sealed.sealedAt;
        certMeta = sealed.cert;
        this.logger.log(
          `PAdES seal applied to admission document ${documentId} with cert ${certMeta.subjectCommonName} (serial ${certMeta.serialNumber})`,
        );
      } catch (sealError) {
        this.logger.error(
          `PAdES seal failed for admission document ${documentId} — saving unsealed PDF: ${
            sealError instanceof Error ? sealError.message : sealError
          }`,
        );
      }
    } else {
      this.logger.warn(
        `PAdES signer not configured — admission document ${documentId} will be saved without ICP-Brasil seal`,
      );
    }

    // 12. Persist the signed PDF and flip the document → SIGNED in a transaction.
    const result = await this.prisma.$transaction(async tx => {
      const signedFileId = await this.saveSignedPdf(
        signedPdf,
        collaborator.name || 'Colaborador',
        document.type,
        documentId,
      );

      await tx.admissionDocument.update({
        where: { id: documentId },
        data: {
          status: ADMISSION_DOCUMENT_STATUS.SIGNED,
          signedFileId,
          signedByUserId: authenticatedUserId,
          signedAt: serverTimestamp,
          signatureEvidence: evidenceJson,
          evidenceHash: evidence.evidenceHash,
          hmacSignature,
          documentSha256,
          padesSealed,
          padesSealedAt,
          certSubject: certMeta?.subject ?? null,
          certIssuer: certMeta?.issuer ?? null,
          certSerialNumber: certMeta?.serialNumber ?? null,
          certCnpj: certMeta?.cnpj ?? null,
          certNotAfter: certMeta?.notAfter ?? null,
          legalBasis: LEGAL_BASIS,
          consentGiven: true,
        },
      });

      return { signedFileId };
    });

    // 13. Audit trail via changelog (admission audit lives in the changelog,
    // not in the PPE-delivery-scoped event table — that table is keyed by
    // deliveryId and must not be polluted with admission rows).
    try {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.ADMISSION,
        entityId: document.admissionId,
        action: CHANGE_ACTION.UPDATE,
        field: `document_${document.type}_signature`,
        oldValue: { status: document.status, signedAt: null },
        newValue: {
          status: ADMISSION_DOCUMENT_STATUS.SIGNED,
          signedAt: serverTimestamp.toISOString(),
          signedByUserId: authenticatedUserId,
          padesSealed,
          verificationCode: hmacSignature.substring(0, 16),
          documentSha256,
        },
        reason: `Documento de admissão assinado eletronicamente (${document.type}) por ${collaborator.name}`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: document.admissionId,
        userId: authenticatedUserId,
      });
    } catch (error) {
      this.logger.error('Failed to log changelog for admission document signature:', error);
    }

    this.logger.log(
      `In-app signature completed for admission document ${documentId} by user ${authenticatedUserId}`,
    );

    return {
      documentId,
      signedFileId: result.signedFileId,
      hmac: hmacSignature,
      padesSealed,
    };
  }

  /**
   * Verify the integrity of a signed admission document by re-computing the HMAC.
   */
  async verifySignature(documentId: string): Promise<{ valid: boolean; details: string }> {
    const document = await this.prisma.admissionDocument.findUnique({
      where: { id: documentId },
      select: { signatureEvidence: true, hmacSignature: true, signedAt: true },
    });

    if (!document || !document.hmacSignature || !document.signatureEvidence) {
      throw new NotFoundException('Assinatura eletrônica não encontrada para este documento.');
    }

    if (!this.hmacSecret) {
      throw new BadRequestException('HMAC secret não configurado — verificação não disponível.');
    }

    const evidence = document.signatureEvidence as any;
    const hmacPayload = deepCanonicalStringify({
      evidence,
      serverTimestamp: evidence?.serverTimestamp ?? null,
      ipAddress: evidence?.ipAddress ?? null,
    });
    const recomputed = crypto
      .createHmac('sha256', this.hmacSecret)
      .update(hmacPayload)
      .digest('hex');

    const valid = recomputed === document.hmacSignature;
    return {
      valid,
      details: valid
        ? 'Integridade verificada — assinatura íntegra.'
        : 'FALHA NA VERIFICAÇÃO — dados podem ter sido adulterados.',
    };
  }

  /**
   * Read path for web/mobile — signature evidence (CPF masked for LGPD).
   */
  async getSignatureDetails(documentId: string): Promise<any> {
    const document = await this.prisma.admissionDocument.findUnique({
      where: { id: documentId },
      include: {
        signedFile: true,
        signedBy: { select: { id: true, name: true } },
      },
    });

    if (!document) {
      throw new NotFoundException('Documento da admissão não encontrado.');
    }

    if (!document.signedAt) {
      return {
        documentId: document.id,
        type: document.type,
        status: document.status,
        signed: false,
      };
    }

    const evidence = (document.signatureEvidence as any) || {};

    return {
      documentId: document.id,
      type: document.type,
      status: document.status,
      signed: true,
      signedAt: document.signedAt,
      signedBy: document.signedBy
        ? { id: document.signedBy.id, name: document.signedBy.name }
        : null,
      signerCpf: this.maskCpfForLgpd(evidence.signerCpf || ''),
      biometricMethod: evidence.biometricMethod ?? null,
      biometricSuccess: evidence.biometricSuccess ?? null,
      deviceModel: evidence.deviceModel ?? null,
      clientTimestamp: evidence.clientTimestamp ?? null,
      serverTimestamp: evidence.serverTimestamp ?? null,
      latitude: evidence.latitude ?? null,
      longitude: evidence.longitude ?? null,
      networkType: evidence.networkType ?? null,
      verificationCode: document.hmacSignature?.substring(0, 16) ?? null,
      legalBasis: document.legalBasis,
      consentGiven: document.consentGiven,
      documentSha256: document.documentSha256,
      signedFileId: document.signedFileId,
      signedFile: document.signedFile || null,
      pades: document.padesSealed
        ? {
            sealed: true,
            sealedAt: document.padesSealedAt,
            certSubject: document.certSubject,
            certIssuer: document.certIssuer,
            certSerialNumber: document.certSerialNumber,
            certCnpj: document.certCnpj,
            certNotAfter: document.certNotAfter,
          }
        : { sealed: false },
    };
  }

  /**
   * Mask CPF for LGPD: 123.456.789-01 → ***.456.789-** (ported from PPE).
   */
  private maskCpfForLgpd(cpf: string): string {
    if (!cpf) return '***.***.***-**';
    const digits = cpf.replace(/\D/g, '');
    if (digits.length < 11) return '***.***.***-**';
    return `***.${digits.substring(3, 6)}.${digits.substring(6, 9)}-**`;
  }

  /**
   * The exact evidence payload the client must hash. MUST match the mobile
   * hashing order. Mirrors PpeInAppSignatureService.buildEvidencePayload.
   */
  private buildEvidencePayload(evidence: AdmissionDocumentSignFormData): Record<string, any> {
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
   * Save the signed PDF to file storage and create the File record.
   */
  private async saveSignedPdf(
    pdfBuffer: Buffer,
    userName: string,
    docType: string,
    documentId: string,
  ): Promise<string | null> {
    try {
      const sanitizedName = userName
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const now = new Date();
      const year = String(now.getFullYear());
      const month = String(now.getMonth() + 1).padStart(2, '0');

      const dirPath = join(
        this.filesRoot,
        'Colaboradores',
        sanitizedName,
        'Admissão',
        'Assinados',
        year,
        month,
      );
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }

      const filename = `assinado_${docType.toLowerCase()}_${documentId.substring(0, 8)}_${Date.now()}.pdf`;
      const filePath = join(dirPath, filename);
      writeFileSync(filePath, pdfBuffer);

      const file = await this.prisma.file.create({
        data: {
          filename,
          originalName: `Termo de Admissão (${docType}) - ${userName} - Assinado.pdf`,
          mimetype: 'application/pdf',
          path: filePath,
          size: pdfBuffer.length,
        },
      });

      return file.id;
    } catch (error) {
      this.logger.error('Failed to save signed admission PDF:', error);
      return null;
    }
  }
}
