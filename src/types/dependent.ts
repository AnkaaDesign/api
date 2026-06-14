// src/types/dependent.ts
// Dependentes do colaborador (dedução IRRF / salário-família)

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { DEPENDENT_RELATIONSHIP, ORDER_BY_DIRECTION } from '@constants';
import type { User, UserIncludes } from './user';
import type { UserBenefit, UserBenefitIncludes } from './benefit';

// =====================
// Main Entity Interface
// =====================

export interface Dependent extends BaseEntity {
  userId: string;
  name: string;
  cpf: string | null;
  birthDate: Date;
  relationship: DEPENDENT_RELATIONSHIP;
  /** Elegível à dedução de IRRF (R$ 189,59/mês por dependente) */
  irrfDeduction: boolean;
  /** Elegível ao salário-família (filho <= 14 anos ou inválido; teto de remuneração aplica) */
  salarioFamilia: boolean;
  /** Plano de saúde (UserBenefit) ao qual o dependente está inscrito; NULL = não inscrito. */
  healthPlanBenefitId: string | null;
  /** Valor mensal atribuído a este dependente no plano (compõe a dedução de IRRF). */
  healthPlanValue: number | null;
  notes: string | null;

  // Relations (optional, populated based on query)
  user?: User;
  healthPlanBenefit?: UserBenefit;
}

// =====================
// Include Types
// =====================

export interface DependentIncludes {
  user?:
    | boolean
    | {
        include?: UserIncludes;
      };
  healthPlanBenefit?:
    | boolean
    | {
        include?: UserBenefitIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface DependentOrderBy {
  id?: ORDER_BY_DIRECTION;
  userId?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  cpf?: ORDER_BY_DIRECTION;
  birthDate?: ORDER_BY_DIRECTION;
  relationship?: ORDER_BY_DIRECTION;
  irrfDeduction?: ORDER_BY_DIRECTION;
  salarioFamilia?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

export interface DependentGetUniqueResponse extends BaseGetUniqueResponse<Dependent> {}
export interface DependentGetManyResponse extends BaseGetManyResponse<Dependent> {}
export interface DependentCreateResponse extends BaseCreateResponse<Dependent> {}
export interface DependentUpdateResponse extends BaseUpdateResponse<Dependent> {}
export interface DependentDeleteResponse extends BaseDeleteResponse {}

export interface DependentBatchCreateResponse<T> extends BaseBatchResponse<Dependent, T> {}
export interface DependentBatchUpdateResponse<T> extends BaseBatchResponse<
  Dependent,
  T & { id: string }
> {}
export interface DependentBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
