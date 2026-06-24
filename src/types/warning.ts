// packages/interfaces/src/warning.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { WARNING_CATEGORY, WARNING_SEVERITY, ORDER_BY_DIRECTION } from '@constants';
import type { User, UserIncludes, UserOrderBy } from './user';
import type { File, FileIncludes } from './file';

// =====================
// Main Entity Interface
// =====================

// Papel de quem assina a advertência: o colaborador advertido ou uma testemunha.
export type WarningSignerRole = 'COLLABORATOR' | 'WITNESS';

export interface Warning extends BaseEntity {
  severity: WARNING_SEVERITY;
  severityOrder: number; // 1=Verbal, 2=Escrita, 3=Suspensão, 4=Advertência Final
  category: WARNING_CATEGORY;
  reason: string;
  description: string | null;
  isActive: boolean;
  collaboratorId: string;
  supervisorId: string;
  // Dias de suspensão (severity = SUSPENSION). CLT art. 474 limita a 30 dias.
  suspensionDays: number | null;
  // Rescisão por justa causa que esta advertência fundamenta (opcional).
  terminationId: string | null;
  followUpDate: Date;
  hrNotes: string | null;
  resolvedAt: Date | null;
  // Auto-resolução: encerra automaticamente após followUpDate quando habilitado.
  autoResolve: boolean;
  autoResolved: boolean;

  // Relations (optional, populated based on query)
  collaborator?: User;
  supervisor?: User;
  witness?: User[];
  attachments?: File[];
  termination?: unknown;
  signatures?: WarningSignature[];
}

// =====================
// In-app Signature Entities
// =====================

export interface WarningSignature extends BaseEntity {
  warningId: string;
  signerRole: WarningSignerRole;
  signedByUserId: string;
  signedByCpf: string;
  // Caminho da recusa testemunhada (CLT). refused=true → biometria ausente.
  refused: boolean;
  refusedReason: string | null;
  registeredById: string | null;
  // Biometria — apenas resultado (LGPD: nenhum dado biométrico bruto).
  biometricMethod: string;
  biometricSuccess: boolean;
  // Device
  deviceBrand: string | null;
  deviceModel: string | null;
  deviceOs: string | null;
  deviceOsVersion: string | null;
  appVersion: string | null;
  // Location (arredondado a 4 casas decimais — minimização LGPD)
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  networkType: string;
  ipAddress: string | null;
  // Timestamps (cliente + servidor)
  clientTimestamp: Date;
  serverTimestamp: Date;
  // Integridade criptográfica
  evidenceHash: string;
  hmacSignature: string;
  // PDF assinado/termo gerado
  signedDocumentId: string | null;
  // Selo PAdES (ICP-Brasil)
  padesSealed: boolean;
  padesSealedAt: Date | null;
  certSubject: string | null;
  certIssuer: string | null;
  certSerialNumber: string | null;
  certCnpj: string | null;
  certNotAfter: Date | null;
  documentSha256: string | null;
  // Evidência bruta (para reverificação)
  evidenceJson: unknown;
  // LGPD
  legalBasis: string;
  consentGiven: boolean;

  // Relations (optional, populated based on query)
  signedByUser?: User;
  registeredBy?: User;
  signedDocument?: File;
  events?: WarningSignatureEvent[];
}

export interface WarningSignatureEvent {
  id: string;
  warningId: string;
  signatureId: string | null;
  type: string;
  occurredAt: Date;
  actorUserId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;

  // Relations
  actorUser?: User;
}

// =====================
// Include Types
// =====================

export interface WarningIncludes {
  collaborator?:
    | boolean
    | {
        include?: UserIncludes;
      };
  supervisor?:
    | boolean
    | {
        include?: UserIncludes;
      };
  witness?:
    | boolean
    | {
        include?: UserIncludes;
      };
  attachments?:
    | boolean
    | {
        include?: FileIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface WarningOrderBy {
  id?: ORDER_BY_DIRECTION;
  severity?: ORDER_BY_DIRECTION;
  category?: ORDER_BY_DIRECTION;
  reason?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  isActive?: ORDER_BY_DIRECTION;
  followUpDate?: ORDER_BY_DIRECTION;
  hrNotes?: ORDER_BY_DIRECTION;
  resolvedAt?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  collaboratorId?: ORDER_BY_DIRECTION;
  supervisorId?: ORDER_BY_DIRECTION;
  collaborator?: UserOrderBy;
  supervisor?: UserOrderBy;
}

// =====================
// Response Interfaces
// =====================

export interface WarningGetUniqueResponse extends BaseGetUniqueResponse<Warning> {}
export interface WarningGetManyResponse extends BaseGetManyResponse<Warning> {}
export interface WarningCreateResponse extends BaseCreateResponse<Warning> {}
export interface WarningUpdateResponse extends BaseUpdateResponse<Warning> {}
export interface WarningDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface WarningBatchCreateResponse<T> extends BaseBatchResponse<Warning, T> {}
export interface WarningBatchUpdateResponse<T> extends BaseBatchResponse<
  Warning,
  T & { id: string }
> {}
export interface WarningBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
