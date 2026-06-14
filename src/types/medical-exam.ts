// src/types/medical-exam.ts
// ASO / Exames ocupacionais (Medicina do Trabalho)

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type {
  MEDICAL_EXAM_TYPE,
  MEDICAL_EXAM_STATUS,
  MEDICAL_EXAM_RESULT,
  ORDER_BY_DIRECTION,
} from '@constants';
import type { User, UserIncludes } from './user';
import type { File } from './file';
import type { Admission } from './admission';
import type { Termination } from './termination';

// =====================
// Main Entity Interface
// =====================

export interface MedicalExam extends BaseEntity {
  userId: string;
  type: MEDICAL_EXAM_TYPE;
  status: MEDICAL_EXAM_STATUS;
  statusOrder: number;
  result: MEDICAL_EXAM_RESULT;
  restrictions: string | null;
  periodicityMonths: number | null;
  scheduledAt: Date | null;
  examDate: Date | null;
  expiresAt: Date | null;
  physicianName: string | null;
  crm: string | null;
  clinic: string | null;
  notes: string | null;
  fileId: string | null;
  // FKs to the originating admission / termination process (auto-created ASOs).
  admissionId: string | null;
  terminationId: string | null;

  // Relations (optional, populated based on query)
  user?: User;
  file?: File;
  admission?: Admission;
  termination?: Termination;
}

// =====================
// Include Types
// =====================

export interface MedicalExamIncludes {
  user?:
    | boolean
    | {
        include?: UserIncludes;
      };
  file?: boolean;
}

// =====================
// Order By Types
// =====================

export interface MedicalExamOrderBy {
  id?: ORDER_BY_DIRECTION;
  userId?: ORDER_BY_DIRECTION;
  type?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  result?: ORDER_BY_DIRECTION;
  scheduledAt?: ORDER_BY_DIRECTION;
  examDate?: ORDER_BY_DIRECTION;
  expiresAt?: ORDER_BY_DIRECTION;
  physicianName?: ORDER_BY_DIRECTION;
  clinic?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

export interface MedicalExamGetUniqueResponse extends BaseGetUniqueResponse<MedicalExam> {}
export interface MedicalExamGetManyResponse extends BaseGetManyResponse<MedicalExam> {}
export interface MedicalExamCreateResponse extends BaseCreateResponse<MedicalExam> {}
export interface MedicalExamUpdateResponse extends BaseUpdateResponse<MedicalExam> {}
export interface MedicalExamDeleteResponse extends BaseDeleteResponse {}

export interface MedicalExamBatchCreateResponse<T> extends BaseBatchResponse<MedicalExam, T> {}
export interface MedicalExamBatchUpdateResponse<T> extends BaseBatchResponse<
  MedicalExam,
  T & { id: string }
> {}
export interface MedicalExamBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
