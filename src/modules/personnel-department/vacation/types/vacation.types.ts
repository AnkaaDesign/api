// vacation.types.ts
// Férias (Departamento Pessoal) — Part C.
//
// Module-local response/entity types (kept here instead of `src/types/vacation.ts`
// to respect the vacation-module ownership boundary; the orchestrator may move
// them to the global aggregator for web/mobile parity).

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from '../../../../types/common';
import type { VACATION_STATUS } from '../../../../constants';
import type { User } from '../../../../types/user';

// =====================
// Entities
// =====================

export interface Vacation extends BaseEntity {
  userId: string;
  contractId: string | null;
  // Férias coletivas: vínculo opcional ao grupo que originou este registro individual.
  groupId: string | null;
  // Modelo FLAT: uma Vacation = uma tomada single-period.
  startDate: Date | null;
  days: number;
  acquisitiveStart: Date;
  acquisitiveEnd: Date;
  concessiveEnd: Date | null;
  unjustifiedAbsencesInPeriod: number;
  entitledDays: number;
  status: VACATION_STATUS;
  abonoPecuniarioDays: number;
  soldThird: boolean;
  baseRemuneration: number | null;
  oneThird: number | null;
  abonoAmount: number | null;
  inss: number | null;
  irrf: number | null;
  isDouble: boolean;
  paymentDueDate: Date | null;
  paymentDate: Date | null;
  notes: string | null;
  // Soft-delete: registros excluídos são marcados (não removidos) para preservar
  // histórico/passivo. Todas as leituras filtram deletedAt = null.
  deletedAt: Date | null;

  // Relations
  user?: User;
  contract?: any;
  // Férias coletivas: grupo que originou este registro individual (quando expandido).
  group?: any;
}

// =====================
// Saldo de gozo do período aquisitivo (siblings agrupados)
// =====================

export interface VacationPeriodTaking {
  id: string;
  startDate: Date | null;
  days: number;
  status: VACATION_STATUS;
}

export interface VacationPeriodBalance {
  /** Dias de direito (escala art. 130). */
  entitledDays: number;
  /** Abono pecuniário da PRIMEIRA tomada do período. */
  abonoDays: number;
  /** Dias de gozo disponíveis = entitledDays - abonoDays. */
  gozoEntitled: number;
  /** Soma de days das tomadas do grupo. */
  scheduledDays: number;
  /** Saldo de gozo restante = max(0, gozoEntitled - scheduledDays). */
  remainingDays: number;
  /** Histórico das tomadas-irmãs do período. */
  takings: VacationPeriodTaking[];
}

// =====================
// Recibo (payable férias receipt) — NOT embedded in the monthly folha
// =====================

export interface VacationReciboLine {
  /** Provento (>0) ou desconto (<0). */
  label: string;
  amount: number;
}

export interface VacationRecibo {
  vacationId: string;
  userId: string;
  /** Dias gozados DESTA tomada (single-period). */
  vacationDays: number;
  abonoPecuniarioDays: number;
  /** Base de cálculo das férias (remuneração + média de variáveis). */
  baseRemuneration: number;
  oneThird: number;
  abonoAmount: number;
  /** Terço sobre o abono (verba indenizatória, isenta). */
  abonoOneThird: number;
  isDouble: boolean;
  taxableBase: number;
  inss: number;
  irrf: number;
  earnings: number;
  discounts: number;
  /** Líquido a receber no recibo de férias. */
  net: number;
  lines: VacationReciboLine[];
}

// =====================
// Responses
// =====================

export type VacationGetUniqueResponse = BaseGetUniqueResponse<Vacation>;
export type VacationGetManyResponse = BaseGetManyResponse<Vacation>;
export type VacationCreateResponse = BaseCreateResponse<Vacation>;
export type VacationUpdateResponse = BaseUpdateResponse<Vacation>;
export type VacationDeleteResponse = BaseDeleteResponse;
export type VacationBatchCreateResponse<T> = BaseBatchResponse<Vacation, T>;
export type VacationBatchUpdateResponse<T> = BaseBatchResponse<Vacation, T>;
export type VacationBatchDeleteResponse = BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }>;
export type VacationCalculateResponse = BaseGetUniqueResponse<{ vacation: Vacation; recibo: VacationRecibo }>;
export type VacationPeriodBalanceResponse = BaseGetUniqueResponse<VacationPeriodBalance>;
