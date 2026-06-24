/**
 * Warning In-App Signature Service
 *
 * In-app electronic signature/refusal workflow for warnings (advertências),
 * mirroring the PPE delivery signature subsystem.
 *
 * Multi-signer: the warned collaborator AND each witness sign in their own app.
 * The supervisor/RH may instead register a witnessed REFUSAL (recusa
 * testemunhada — CLT) when the collaborator refuses to sign.
 *
 * Legal basis: CLT Art. 2 (poder diretivo / ciência de medida disciplinar) +
 * Lei 14.063/2020 Art. 4° (assinatura eletrônica avançada).
 * LGPD: data minimization, no raw biometric data stored, GPS rounded to 4 dp.
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
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  WarningDocumentService,
  WarningSignerEvidence,
} from './warning-document.service';
import { PpePadesSignerService, CertMetadata } from '@modules/inventory/ppe/ppe-pades-signer.service';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '@constants';
import { WarningSignatureEventType, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { WarningSignFormData, WarningRefuseSignFormData } from '@schemas';

/**
 * Deep canonical JSON stringification — recursively sorts keys at every level.
 * Required because PostgreSQL JSONB does not preserve key order, so HMAC
 * computation must be deterministic.
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

type WarningWithRelations = {
  id: string;
  severity: string;
  collaboratorId: string;
  collaborator: { id: string; name: string | null; cpf: string | null } | null;
  supervisorId: string;
  witness: Array<{ id: string; name: string | null; cpf: string | null }>;
  signatures: Array<{
    id: string;
    signedByUserId: string;
    signerRole: string;
    refused: boolean;
  }>;
};

@Injectable()
export class WarningSignatureService {
  private readonly logger = new Logger(WarningSignatureService.name);
  private readonly hmacSecret: string;
  private readonly filesRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly warningDocumentService: WarningDocumentService,
    private readonly changeLogService: ChangeLogService,
    private readonly padesSigner: PpePadesSignerService,
  ) {
    // Dedicated secret with fallback to the PPE secret (shared HMAC keying).
    this.hmacSecret =
      this.configService.get<string>('WARNING_SIGNATURE_HMAC_SECRET') ||
      this.configService.get<string>('PPE_SIGNATURE_HMAC_SECRET') ||
      '';
    this.filesRoot = this.configService.get<string>('FILES_ROOT') || './files';

    if (!this.hmacSecret) {
      this.logger.warn(
        'WARNING_SIGNATURE_HMAC_SECRET / PPE_SIGNATURE_HMAC_SECRET not configured — warning in-app signatures will not be available',
      );
    }
  }

  // ============================================================
  // SIGN (collaborator OR witness signs with biometric ciência)
  // ============================================================
  async signWarning(
    warningId: string,
    evidence: WarningSignFormData,
    authenticatedUserId: string,
    requestIp?: string,
  ): Promise<{ success: true; signatureId: string; hmac: string; signerRole: string }> {
    if (!this.hmacSecret) {
      throw new BadRequestException(
        'Assinatura eletrônica in-app não está configurada. Contate o administrador.',
      );
    }

    const warning = await this.loadWarning(warningId);

    // 1. Infer signer role.
    const signerRole = this.inferSignerRole(warning, authenticatedUserId);

    // 2. Reject if this user already signed/refused.
    if (warning.signatures.some(s => s.signedByUserId === authenticatedUserId)) {
      throw new BadRequestException('Você já registrou ciência desta advertência.');
    }

    // 3. Hard-require real biometric proof.
    await this.recordEvent(warningId, 'SIGNATURE_SUBMITTED', {
      actorUserId: authenticatedUserId,
      ipAddress: requestIp,
      metadata: {
        signerRole,
        biometricMethod: evidence.biometricMethod,
        biometricSuccess: evidence.biometricSuccess,
        deviceModel: evidence.deviceModel ?? null,
        deviceOs: evidence.deviceOs ?? null,
        appVersion: evidence.appVersion ?? null,
      },
    });

    if (!evidence.biometricSuccess || evidence.biometricMethod === 'NONE') {
      await this.recordEvent(warningId, 'BIOMETRIC_FAILED', {
        actorUserId: authenticatedUserId,
        ipAddress: requestIp,
        metadata: {
          biometricMethod: evidence.biometricMethod,
          biometricSuccess: evidence.biometricSuccess,
          reason: 'rejected_by_server',
        },
      });
      throw new BadRequestException(
        'Autenticação biométrica obrigatória. Habilite a biometria do dispositivo e tente novamente.',
      );
    }

    // 4. Re-compute evidence hash server-side and compare.
    const evidenceForHash = this.buildEvidencePayload(evidence);
    const serverHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(evidenceForHash))
      .digest('hex');

    if (serverHash !== evidence.evidenceHash) {
      this.logger.warn(
        `Evidence hash mismatch for warning ${warningId}: client=${evidence.evidenceHash}, server=${serverHash}`,
      );
      await this.recordEvent(warningId, 'HMAC_REJECTED', {
        actorUserId: authenticatedUserId,
        ipAddress: requestIp,
        metadata: { clientHash: evidence.evidenceHash, serverHash },
      });
      throw new BadRequestException(
        'Hash de evidência não confere. Possível adulteração dos dados.',
      );
    }

    await this.recordEvent(warningId, 'HMAC_VALIDATED', {
      actorUserId: authenticatedUserId,
      ipAddress: requestIp,
      metadata: { evidenceHash: evidence.evidenceHash },
    });

    // 5. Round GPS coordinates (LGPD minimization).
    const { latitude, longitude, locationAccuracy } = this.roundGps(evidence);

    // 6. Build evidence JSON for storage.
    const serverTimestamp = new Date();
    const evidenceJson = {
      ...evidenceForHash,
      latitude,
      longitude,
      locationAccuracy,
      serverTimestamp: serverTimestamp.toISOString(),
      ipAddress: requestIp || null,
    };

    // 7. HMAC-SHA256 server-side seal.
    const hmacSignature = this.computeHmac(evidenceJson, serverTimestamp, requestIp);

    const signerUser =
      signerRole === 'COLLABORATOR'
        ? warning.collaborator
        : warning.witness.find(w => w.id === authenticatedUserId) || null;
    const signedByCpf = signerUser?.cpf || '';

    // 8. Upsert the signature row + record the document below.
    const signature = await this.prisma.warningSignature.upsert({
      where: { warningId_signedByUserId: { warningId, signedByUserId: authenticatedUserId } },
      create: {
        warningId,
        signerRole: signerRole as any,
        signedByUserId: authenticatedUserId,
        signedByCpf,
        refused: false,
        biometricMethod: evidence.biometricMethod as any,
        biometricSuccess: evidence.biometricSuccess,
        deviceBrand: evidence.deviceBrand || null,
        deviceModel: evidence.deviceModel || null,
        deviceOs: evidence.deviceOs || null,
        deviceOsVersion: evidence.deviceOsVersion || null,
        appVersion: evidence.appVersion || null,
        latitude,
        longitude,
        locationAccuracy,
        networkType: evidence.networkType as any,
        ipAddress: requestIp || null,
        clientTimestamp: new Date(evidence.clientTimestamp),
        serverTimestamp,
        evidenceHash: evidence.evidenceHash,
        hmacSignature,
        evidenceJson: evidenceJson as Prisma.InputJsonValue,
        consentGiven: evidence.consentGiven,
      },
      update: {
        signerRole: signerRole as any,
        signedByCpf,
        refused: false,
        biometricMethod: evidence.biometricMethod as any,
        biometricSuccess: evidence.biometricSuccess,
        deviceBrand: evidence.deviceBrand || null,
        deviceModel: evidence.deviceModel || null,
        deviceOs: evidence.deviceOs || null,
        deviceOsVersion: evidence.deviceOsVersion || null,
        appVersion: evidence.appVersion || null,
        latitude,
        longitude,
        locationAccuracy,
        networkType: evidence.networkType as any,
        ipAddress: requestIp || null,
        clientTimestamp: new Date(evidence.clientTimestamp),
        serverTimestamp,
        evidenceHash: evidence.evidenceHash,
        hmacSignature,
        evidenceJson: evidenceJson as Prisma.InputJsonValue,
        consentGiven: evidence.consentGiven,
      },
    });

    // Backfill prior events that predate this signature row (e.g. SUBMITTED).
    await this.attachSignatureId(warningId, authenticatedUserId, signature.id);

    // 9. (Re)generate + seal PDF and store it as the warning's signed document.
    const { signedDocumentId, padesSealed, padesSealedAt, certMeta, documentSha256 } =
      await this.regenerateAndStorePdf(warningId, authenticatedUserId, requestIp, {
        refused: false,
      });

    await this.prisma.warningSignature.update({
      where: { id: signature.id },
      data: {
        signedDocumentId,
        padesSealed,
        padesSealedAt,
        certSubject: certMeta?.subject ?? null,
        certIssuer: certMeta?.issuer ?? null,
        certSerialNumber: certMeta?.serialNumber ?? null,
        certCnpj: certMeta?.cnpj ?? null,
        certNotAfter: certMeta?.notAfter ?? null,
        documentSha256,
      },
    });

    await this.recordEvent(warningId, 'SIGNATURE_COMPLETED', {
      signatureId: signature.id,
      actorUserId: authenticatedUserId,
      ipAddress: requestIp,
      metadata: {
        signerRole,
        verificationCode: hmacSignature.substring(0, 16),
        padesSealed,
        signedDocumentId,
      },
    });

    try {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.WARNING,
        entityId: warningId,
        action: CHANGE_ACTION.UPDATE,
        reason: `Ciência de advertência registrada (${signerRole}) por ${authenticatedUserId}`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: authenticatedUserId,
        userId: authenticatedUserId,
        oldValue: { signatureId: null },
        newValue: { signatureId: signature.id, signerRole },
      });
    } catch (error) {
      this.logger.error('Failed to log changelog for warning signature:', error as Error);
    }

    this.logger.log(
      `Warning ${warningId} signed by ${authenticatedUserId} (${signerRole})`,
    );

    return { success: true, signatureId: signature.id, hmac: hmacSignature, signerRole };
  }

  // ============================================================
  // REFUSE (supervisor/RH registers a witnessed refusal)
  // ============================================================
  async refuseWarningSignature(
    warningId: string,
    data: WarningRefuseSignFormData,
    registeredByUserId: string,
    requestIp?: string,
  ): Promise<{ success: true; signatureId: string }> {
    if (!this.hmacSecret) {
      throw new BadRequestException(
        'Assinatura eletrônica in-app não está configurada. Contate o administrador.',
      );
    }

    const warning = await this.loadWarning(warningId);

    // CLT: a witnessed refusal needs at least 2 witnesses.
    if (warning.witness.length < 2) {
      throw new BadRequestException(
        'São necessárias ao menos 2 testemunhas para registrar a recusa de assinatura.',
      );
    }

    // Reject if the collaborator already signed/refused.
    if (
      warning.signatures.some(
        s => s.signerRole === 'COLLABORATOR' && s.signedByUserId === warning.collaboratorId,
      )
    ) {
      throw new BadRequestException('A ciência do colaborador já foi registrada.');
    }

    await this.recordEvent(warningId, 'SIGNATURE_REFUSED', {
      actorUserId: registeredByUserId,
      ipAddress: requestIp,
      metadata: {
        refusedReason: data.refusedReason,
        deviceModel: data.deviceModel ?? null,
        appVersion: data.appVersion ?? null,
        witnessCount: warning.witness.length,
      },
    });

    const { latitude, longitude, locationAccuracy } = this.roundGps(data);
    const serverTimestamp = new Date();
    const evidenceForHash = this.buildEvidencePayload(data);
    const evidenceJson = {
      ...evidenceForHash,
      refusedReason: data.refusedReason,
      registeredById: registeredByUserId,
      latitude,
      longitude,
      locationAccuracy,
      serverTimestamp: serverTimestamp.toISOString(),
      ipAddress: requestIp || null,
    };
    const hmacSignature = this.computeHmac(evidenceJson, serverTimestamp, requestIp);

    await this.recordEvent(warningId, 'HMAC_VALIDATED', {
      actorUserId: registeredByUserId,
      ipAddress: requestIp,
      metadata: { evidenceHash: data.evidenceHash },
    });

    const signature = await this.prisma.warningSignature.upsert({
      where: {
        warningId_signedByUserId: { warningId, signedByUserId: warning.collaboratorId },
      },
      create: {
        warningId,
        signerRole: 'COLLABORATOR' as any,
        signedByUserId: warning.collaboratorId,
        signedByCpf: warning.collaborator?.cpf || '',
        refused: true,
        refusedReason: data.refusedReason,
        registeredById: registeredByUserId,
        biometricMethod: 'NONE' as any,
        biometricSuccess: false,
        deviceBrand: data.deviceBrand || null,
        deviceModel: data.deviceModel || null,
        deviceOs: data.deviceOs || null,
        deviceOsVersion: data.deviceOsVersion || null,
        appVersion: data.appVersion || null,
        latitude,
        longitude,
        locationAccuracy,
        networkType: data.networkType as any,
        ipAddress: requestIp || null,
        clientTimestamp: new Date(data.clientTimestamp),
        serverTimestamp,
        evidenceHash: data.evidenceHash,
        hmacSignature,
        evidenceJson: evidenceJson as Prisma.InputJsonValue,
        consentGiven: data.consentGiven,
      },
      update: {
        refused: true,
        refusedReason: data.refusedReason,
        registeredById: registeredByUserId,
        serverTimestamp,
        evidenceHash: data.evidenceHash,
        hmacSignature,
        evidenceJson: evidenceJson as Prisma.InputJsonValue,
      },
    });

    await this.attachSignatureId(warningId, warning.collaboratorId, signature.id);

    const { signedDocumentId, padesSealed, padesSealedAt, certMeta, documentSha256 } =
      await this.regenerateAndStorePdf(warningId, registeredByUserId, requestIp, {
        refused: true,
        refusedReason: data.refusedReason,
        refusedAt: serverTimestamp,
      });

    await this.prisma.warningSignature.update({
      where: { id: signature.id },
      data: {
        signedDocumentId,
        padesSealed,
        padesSealedAt,
        certSubject: certMeta?.subject ?? null,
        certIssuer: certMeta?.issuer ?? null,
        certSerialNumber: certMeta?.serialNumber ?? null,
        certCnpj: certMeta?.cnpj ?? null,
        certNotAfter: certMeta?.notAfter ?? null,
        documentSha256,
      },
    });

    await this.recordEvent(warningId, 'SIGNATURE_COMPLETED', {
      signatureId: signature.id,
      actorUserId: registeredByUserId,
      ipAddress: requestIp,
      metadata: {
        refused: true,
        verificationCode: hmacSignature.substring(0, 16),
        padesSealed,
        signedDocumentId,
      },
    });

    try {
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.WARNING,
        entityId: warningId,
        action: CHANGE_ACTION.UPDATE,
        reason: `Recusa testemunhada de assinatura registrada por ${registeredByUserId}`,
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: registeredByUserId,
        userId: registeredByUserId,
        oldValue: { refused: false },
        newValue: { refused: true, signatureId: signature.id },
      });
    } catch (error) {
      this.logger.error('Failed to log changelog for warning refusal:', error as Error);
    }

    this.logger.log(`Warning ${warningId} signature REFUSED, registered by ${registeredByUserId}`);

    return { success: true, signatureId: signature.id };
  }

  // ============================================================
  // VERIFY (recompute HMAC per signature)
  // ============================================================
  async verifyWarningSignature(warningId: string): Promise<{
    valid: boolean;
    signatures: Array<{ signatureId: string; signerRole: string; valid: boolean }>;
    details: string;
  }> {
    const signatures = await this.prisma.warningSignature.findMany({
      where: { warningId },
    });

    if (signatures.length === 0) {
      throw new NotFoundException('Nenhuma assinatura eletrônica encontrada para esta advertência.');
    }

    if (!this.hmacSecret) {
      throw new BadRequestException('HMAC secret não configurado — verificação não disponível.');
    }

    const results = signatures.map(sig => {
      const hmacPayload = deepCanonicalStringify({
        evidence: sig.evidenceJson,
        serverTimestamp: sig.serverTimestamp.toISOString(),
        ipAddress: sig.ipAddress || null,
      });
      const recomputedHmac = crypto
        .createHmac('sha256', this.hmacSecret)
        .update(hmacPayload)
        .digest('hex');
      const valid = recomputedHmac === sig.hmacSignature;
      if (!valid) {
        this.logger.warn(
          `HMAC verification failed for warning signature ${sig.id} (warning ${warningId})`,
        );
      }
      return { signatureId: sig.id, signerRole: sig.signerRole as string, valid };
    });

    const valid = results.every(r => r.valid);

    return {
      valid,
      signatures: results,
      details: valid
        ? 'Integridade verificada — todas as assinaturas íntegras.'
        : 'FALHA NA VERIFICAÇÃO — uma ou mais assinaturas podem ter sido adulteradas.',
    };
  }

  // ============================================================
  // ON-DEMAND DOCUMENT (sealed term OR fresh preview)
  // ============================================================

  /**
   * Return the warning term as a PDF for inline viewing.
   *
   * If any signature already has a sealed `signedDocument`, the most recent one
   * (by serverTimestamp) is the authoritative term — its bytes are read from
   * storage and returned as-is. Otherwise a fresh, unsealed preview is rendered
   * from the warning's current state.
   */
  async getWarningDocumentPdf(
    warningId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const warning = await this.prisma.warning.findUnique({
      where: { id: warningId },
      include: {
        collaborator: { select: { id: true, name: true, cpf: true } },
        supervisor: { select: { id: true, name: true } },
        witness: { select: { id: true, name: true, cpf: true, position: { select: { name: true } } } },
        signatures: {
          include: {
            signedByUser: { select: { id: true, name: true, cpf: true } },
            signedDocument: { select: { id: true, path: true } },
          },
          orderBy: { serverTimestamp: 'desc' },
        },
      },
    });

    if (!warning) {
      throw new NotFoundException('Advertência não encontrada.');
    }

    const filename = `advertencia-${warningId}.pdf`;

    // 1. Authoritative sealed term — most recent signature with a stored document.
    const sealed = (warning.signatures as any[]).find(s => s.signedDocument?.path);
    if (sealed?.signedDocument?.path) {
      const path = sealed.signedDocument.path as string;
      if (existsSync(path)) {
        return { buffer: readFileSync(path), filename };
      }
      this.logger.warn(
        `Sealed warning document missing on disk for warning ${warningId} (path: ${path}); rendering fresh preview.`,
      );
    }

    // 2. Fresh preview — build evidence rows from the existing signatures.
    const signers: WarningSignerEvidence[] = (warning.signatures as any[]).map(s => ({
      name: s.signedByUser?.name || 'Signatário',
      cpf: s.signedByUser?.cpf || s.signedByCpf || '',
      role: (s.signerRole === 'WITNESS' ? 'WITNESS' : 'COLLABORATOR') as
        | 'COLLABORATOR'
        | 'WITNESS',
      position: null,
      signed: !s.refused,
      refused: !!s.refused,
      refusedReason: s.refusedReason ?? null,
      biometricMethod: s.biometricMethod ?? null,
      serverTimestamp: s.serverTimestamp ?? null,
      deviceModel: s.deviceModel ?? null,
      verificationCode: s.hmacSignature ? s.hmacSignature.substring(0, 16) : null,
    }));

    // Refusal state derived from the collaborator's own signature, if any.
    const collabSig = (warning.signatures as any[]).find(
      s => s.signedByUserId === warning.collaboratorId && s.refused,
    );
    const state = collabSig
      ? {
          refused: true,
          refusedReason: collabSig.refusedReason ?? null,
          refusedAt: collabSig.serverTimestamp ?? null,
        }
      : { refused: false };

    const buffer = await this.warningDocumentService.generateWarningDocument(
      warningId,
      signers,
      state,
    );
    return { buffer, filename };
  }

  // ============================================================
  // Helpers
  // ============================================================

  private async loadWarning(warningId: string): Promise<WarningWithRelations> {
    const warning = await this.prisma.warning.findUnique({
      where: { id: warningId },
      include: {
        collaborator: { select: { id: true, name: true, cpf: true } },
        witness: { select: { id: true, name: true, cpf: true } },
        signatures: {
          select: { id: true, signedByUserId: true, signerRole: true, refused: true },
        },
      },
    });
    if (!warning) {
      throw new NotFoundException('Advertência não encontrada.');
    }
    return warning as unknown as WarningWithRelations;
  }

  private inferSignerRole(
    warning: WarningWithRelations,
    userId: string,
  ): 'COLLABORATOR' | 'WITNESS' {
    if (userId === warning.collaboratorId) return 'COLLABORATOR';
    if (warning.witness.some(w => w.id === userId)) return 'WITNESS';
    throw new ForbiddenException(
      'Apenas o colaborador advertido ou uma testemunha indicada pode assinar esta advertência.',
    );
  }

  private roundGps(evidence: WarningSignFormData | WarningRefuseSignFormData): {
    latitude: number | null;
    longitude: number | null;
    locationAccuracy: number | null;
  } {
    return {
      latitude:
        evidence.latitude != null ? Math.round(evidence.latitude * 10000) / 10000 : null,
      longitude:
        evidence.longitude != null ? Math.round(evidence.longitude * 10000) / 10000 : null,
      locationAccuracy:
        evidence.locationAccuracy != null
          ? Math.round(evidence.locationAccuracy * 100) / 100
          : null,
    };
  }

  private computeHmac(evidenceJson: any, serverTimestamp: Date, requestIp?: string): string {
    const hmacPayload = deepCanonicalStringify({
      evidence: evidenceJson,
      serverTimestamp: serverTimestamp.toISOString(),
      ipAddress: requestIp || null,
    });
    return crypto.createHmac('sha256', this.hmacSecret).update(hmacPayload).digest('hex');
  }

  /**
   * Evidence payload that the client hashes; must match the mobile hashing.
   */
  private buildEvidencePayload(
    evidence: WarningSignFormData | WarningRefuseSignFormData,
  ): Record<string, any> {
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
   * (Re)generate the warning PDF reflecting the current signer state, PAdES-seal
   * it when configured, store the File, and return its id + cert metadata.
   */
  private async regenerateAndStorePdf(
    warningId: string,
    actorUserId: string,
    requestIp: string | undefined,
    state: { refused: boolean; refusedReason?: string | null; refusedAt?: Date | null },
  ): Promise<{
    signedDocumentId: string | null;
    padesSealed: boolean;
    padesSealedAt: Date | null;
    certMeta: CertMetadata | null;
    documentSha256: string | null;
  }> {
    let signedDocumentId: string | null = null;
    let padesSealed = false;
    let padesSealedAt: Date | null = null;
    let certMeta: CertMetadata | null = null;
    let documentSha256: string | null = null;

    try {
      const warning = await this.prisma.warning.findUnique({
        where: { id: warningId },
        include: {
          collaborator: { select: { id: true, name: true, cpf: true } },
          witness: { select: { id: true, name: true, cpf: true, position: { select: { name: true } } } },
          signatures: true,
        },
      });
      if (!warning) throw new Error(`Warning ${warningId} not found`);

      const signers = this.buildSignerEvidence(warning, state);
      const trailEvents = await this.getAuditTrail(warningId);
      const auditCtx = {
        events: trailEvents,
        documentNumber: warningId,
        filename: `termo_advertencia_${(warning.collaborator?.name || 'colaborador')
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-zA-Z0-9]/g, '_')
          .substring(0, 30)}_${warningId.substring(0, 8)}.pdf`,
        originalDocHash: null as string | null,
      };

      let pdfBuffer = await this.warningDocumentService.generateWarningDocument(
        warningId,
        signers,
        state,
        auditCtx,
      );

      const preSealHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

      // Re-render with the hash injected into the audit page.
      pdfBuffer = await this.warningDocumentService.generateWarningDocument(
        warningId,
        signers,
        state,
        { ...auditCtx, originalDocHash: preSealHash },
      );
      documentSha256 = preSealHash;

      const serverTimestamp = state.refusedAt ?? new Date();
      if (this.padesSigner.isEnabled()) {
        try {
          const sealed = await this.padesSigner.sealPdf(pdfBuffer, {
            reason: `Termo de ciência de advertência — ${warningId}`,
            location: 'Ibiporã-PR, Brasil',
            signerName: this.padesSigner.getCertMetadata()?.subjectCommonName || 'Ankaa Design',
            contactInfo: 'contato@ankaadesign.com.br',
            signingTime: serverTimestamp,
          });
          pdfBuffer = sealed.signedPdf;
          padesSealed = true;
          padesSealedAt = sealed.sealedAt;
          certMeta = sealed.cert;
          await this.recordEvent(warningId, 'PADES_SEALED', {
            actorUserId,
            ipAddress: requestIp,
            metadata: {
              certCnpj: certMeta.cnpj,
              certSerial: certMeta.serialNumber,
              certIssuer: certMeta.issuer,
            },
          });
        } catch (sealError) {
          this.logger.error(
            `PAdES seal failed for warning ${warningId} — saving unsealed PDF: ${
              sealError instanceof Error ? sealError.message : sealError
            }`,
          );
          await this.recordEvent(warningId, 'PADES_FAILED', {
            actorUserId,
            ipAddress: requestIp,
            metadata: { error: sealError instanceof Error ? sealError.message : String(sealError) },
          });
        }
      } else {
        this.logger.warn(
          `PAdES signer not configured — warning ${warningId} will be saved without ICP-Brasil seal`,
        );
      }

      signedDocumentId = await this.savePdfToStorage(
        pdfBuffer,
        warning.collaborator?.name || 'Colaborador',
        warningId,
      );
    } catch (error) {
      this.logger.error(`Failed to generate signed PDF for warning ${warningId}:`, error as Error);
    }

    return { signedDocumentId, padesSealed, padesSealedAt, certMeta, documentSha256 };
  }

  /**
   * Build per-signer evidence rows (collaborator + each witness) from the
   * warning relations + persisted signatures.
   */
  private buildSignerEvidence(
    warning: any,
    state: { refused: boolean; refusedReason?: string | null },
  ): WarningSignerEvidence[] {
    const sigByUser = new Map<string, any>();
    for (const s of warning.signatures || []) {
      sigByUser.set(s.signedByUserId, s);
    }

    const rows: WarningSignerEvidence[] = [];

    const collabSig = sigByUser.get(warning.collaboratorId);
    rows.push({
      name: warning.collaborator?.name || 'Colaborador',
      cpf: warning.collaborator?.cpf || '',
      role: 'COLLABORATOR',
      position: null,
      signed: !!collabSig && !collabSig.refused,
      refused: !!collabSig?.refused || state.refused,
      refusedReason: collabSig?.refusedReason ?? state.refusedReason ?? null,
      biometricMethod: collabSig?.biometricMethod ?? null,
      serverTimestamp: collabSig?.serverTimestamp ?? null,
      deviceModel: collabSig?.deviceModel ?? null,
      verificationCode: collabSig?.hmacSignature
        ? collabSig.hmacSignature.substring(0, 16)
        : null,
    });

    for (const w of warning.witness || []) {
      const wSig = sigByUser.get(w.id);
      rows.push({
        name: w.name || 'Testemunha',
        cpf: w.cpf || '',
        role: 'WITNESS',
        position: w.position?.name ?? null,
        signed: !!wSig && !wSig.refused,
        refused: false,
        biometricMethod: wSig?.biometricMethod ?? null,
        serverTimestamp: wSig?.serverTimestamp ?? null,
        deviceModel: wSig?.deviceModel ?? null,
        verificationCode: wSig?.hmacSignature ? wSig.hmacSignature.substring(0, 16) : null,
      });
    }

    return rows;
  }

  private async savePdfToStorage(
    pdfBuffer: Buffer,
    userName: string,
    warningId: string,
  ): Promise<string | null> {
    try {
      const sanitizedName = userName
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const now = new Date();
      const year = String(now.getFullYear()).slice(-2);
      const month = String(now.getMonth() + 1).padStart(2, '0');

      const dirPath = join(this.filesRoot, 'Colaboradores', sanitizedName, 'Advertencias', year, month);
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }

      const filename = `advertencia_${warningId.substring(0, 8)}_${Date.now()}.pdf`;
      const filePath = join(dirPath, filename);
      writeFileSync(filePath, pdfBuffer);

      const file = await this.prisma.file.create({
        data: {
          filename,
          originalName: `Termo de Ciência de Advertência - ${userName} - Assinado.pdf`,
          mimetype: 'application/pdf',
          path: filePath,
          size: pdfBuffer.length,
        },
      });

      return file.id;
    } catch (error) {
      this.logger.error('Failed to save signed warning PDF:', error as Error);
      return null;
    }
  }

  /**
   * Record a signature lifecycle event. Never throws.
   */
  private async recordEvent(
    warningId: string,
    type: WarningSignatureEventType | string,
    ctx: {
      signatureId?: string | null;
      actorUserId?: string | null;
      ipAddress?: string | null;
      userAgent?: string | null;
      metadata?: any;
    } = {},
  ): Promise<void> {
    try {
      await this.prisma.warningSignatureEvent.create({
        data: {
          warningId,
          signatureId: ctx.signatureId ?? null,
          type: type as WarningSignatureEventType,
          occurredAt: new Date(),
          actorUserId: ctx.actorUserId ?? null,
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
          metadata: ctx.metadata ?? Prisma.JsonNull,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record warning signature event ${type} for warning ${warningId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  /**
   * Backfill signatureId on events recorded before the signature row existed.
   */
  private async attachSignatureId(
    warningId: string,
    signedByUserId: string,
    signatureId: string,
  ): Promise<void> {
    try {
      await this.prisma.warningSignatureEvent.updateMany({
        where: { warningId, signatureId: null, actorUserId: signedByUserId },
        data: { signatureId },
      });
    } catch (error) {
      this.logger.error(
        `Failed to attach signatureId ${signatureId} to events for warning ${warningId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  private async getAuditTrail(warningId: string): Promise<
    Array<{
      type: string;
      occurredAt: Date;
      actorName: string | null;
      ipAddress: string | null;
      userAgent: string | null;
      metadata: any;
    }>
  > {
    const events = await this.prisma.warningSignatureEvent.findMany({
      where: { warningId },
      orderBy: { occurredAt: 'asc' },
      include: { actorUser: { select: { id: true, name: true } } },
    });

    return events.map(e => ({
      type: e.type,
      occurredAt: e.occurredAt,
      actorName: e.actorUser?.name ?? null,
      ipAddress: e.ipAddress,
      userAgent: e.userAgent,
      metadata: e.metadata,
    }));
  }
}
