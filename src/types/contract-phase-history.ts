// src/types/contract-phase-history.ts
// Histórico de fases do vínculo (ContractPhaseHistory) — trilha de auditoria da
// linha do tempo de modalidades (contractType) que um EmploymentContract assumiu.
// O vínculo avança a MODALIDADE no lugar (EXPERIENCE_PERIOD_1 → EXPERIENCE_PERIOD_2
// → INDETERMINATE) sem rescisão/recriação; cada linha é uma fase (startDate..endDate,
// endDate NULL = fase atual/aberta). No máximo uma fase aberta por vínculo.

import type { BaseEntity } from './common';
import type { CONTRACT_TYPE, CHANGE_TRIGGERED_BY } from '@constants';
import type { EmploymentContract } from './employment-contract';
import type { User } from './user';

// =====================
// Main Entity Interface
// =====================

export interface ContractPhaseHistory extends BaseEntity {
  contractId: string;
  userId: string;
  contractType: CONTRACT_TYPE;
  startDate: Date;
  /** NULL = fase atual/aberta. */
  endDate: Date | null;
  triggeredBy: CHANGE_TRIGGERED_BY | null;
  reason: string | null;

  // Relations (optional, populated based on query)
  contract?: EmploymentContract;
  user?: User;
}

// =====================
// Include Types
// =====================

export interface ContractPhaseHistoryIncludes {
  contract?: boolean | { include?: any };
  user?: boolean | { include?: any };
}
