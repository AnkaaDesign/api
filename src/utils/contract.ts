// contract.ts
// Centraliza a TAXONOMIA de vínculo (EmploymentContract) — modalidade (CONTRACT_TYPE)
// vs situação (CONTRACT_STATUS) vs categoria (EMPLOYEE_TYPE) — e as regras de:
//  - elegibilidade à bonificação (isBonifiable)
//  - máquina de transição de situação (CONTRACT_STATUS)
//  - integridade EmployeeType ↔ ContractType
//
// É a ÚNICA fonte da verdade para o antigo gate `contractType === EFFECTED`.
// (Part A — Contract taxonomy & vínculo lifecycle.)

import { CONTRACT_STATUS, CONTRACT_TYPE, EMPLOYEE_TYPE } from '@constants';

/**
 * Situações que representam um vínculo ABERTO (pessoa empregada).
 * Tudo que NÃO é TERMINATED.
 */
export const OPEN_CONTRACT_STATUSES = [CONTRACT_STATUS.ACTIVE] as const;

/**
 * Modalidades legais válidas para um vínculo CLT (folha).
 * APPRENTICE e as fases de experiência (EXPERIENCE_PERIOD_1/2) só existem sob CLT.
 */
export const CLT_CONTRACT_TYPES = [
  CONTRACT_TYPE.INDETERMINATE,
  CONTRACT_TYPE.FIXED_TERM,
  CONTRACT_TYPE.INTERMITTENT,
  CONTRACT_TYPE.APPRENTICE,
  CONTRACT_TYPE.TEMPORARY,
  CONTRACT_TYPE.EXPERIENCE_PERIOD_1,
  CONTRACT_TYPE.EXPERIENCE_PERIOD_2,
] as const;

/**
 * Forma mínima de um vínculo (EmploymentContract ou o cache espelhado no User)
 * para avaliar elegibilidade/transições.
 */
export interface ContractLike {
  employeeType?: EMPLOYEE_TYPE | string | null;
  status?: CONTRACT_STATUS | string | null;
  contractType?: CONTRACT_TYPE | string | null;
}

/**
 * ELEGIBILIDADE À BONIFICAÇÃO — predicado canônico (substitui o antigo gate
 * `contractType === EFFECTED` espalhado em 8+ sites).
 *
 * Elegível ⇔ vínculo CLT efetivado E em situação ATIVA:
 *   employeeType === CLT && status === ACTIVE && contractType === INDETERMINATE
 *
 * Em experiência (contractType = EXPERIENCE_PERIOD_1/2) NÃO é bonificável,
 * mesmo com status ACTIVE — a efetivação é o gate (EXPERIENCE_PERIOD_2 → INDETERMINATE).
 */
export function isBonifiable(contract: ContractLike | null | undefined): boolean {
  if (!contract) return false;
  return (
    contract.employeeType === EMPLOYEE_TYPE.CLT &&
    contract.status === CONTRACT_STATUS.ACTIVE &&
    contract.contractType === CONTRACT_TYPE.INDETERMINATE
  );
}

/**
 * Fragmento de `where` Prisma sobre o CACHE do User (currentEmployeeType /
 * currentContractStatus / currentContractType) que reproduz `isBonifiable` no banco.
 * Use para filtrar usuários bonificáveis em queries (substitui o antigo
 * `currentContractType: CONTRACT_TYPE.EFFECTED` + `currentEmployeeType IN payroll`).
 */
export const BONIFIABLE_USER_WHERE = {
  currentEmployeeType: EMPLOYEE_TYPE.CLT,
  currentContractStatus: CONTRACT_STATUS.ACTIVE,
  currentContractType: CONTRACT_TYPE.INDETERMINATE,
} as const;

/**
 * `true` se a situação representa um vínculo aberto (não encerrado).
 */
export function isOpenStatus(status: CONTRACT_STATUS | string | null | undefined): boolean {
  return status != null && status !== CONTRACT_STATUS.TERMINATED;
}

/**
 * Forma mínima do CACHE de vínculo espelhado no User (`currentContractStatus`)
 * para avaliar "tem vínculo ativo / pode acessar o sistema".
 */
export interface UserContractCacheLike {
  currentContractStatus?: CONTRACT_STATUS | string | null;
}

/**
 * Predicado canônico "usuário com vínculo ATIVO" — SUBSTITUI o antigo flag
 * `User.isActive` (removido). Verdadeiro ⇔ a situação do vínculo atual é ACTIVE.
 *
 * Um usuário SEM vínculo (`currentContractStatus = null`) ou DESLIGADO
 * (TERMINATED) NÃO é ativo — exatamente o que o antigo `isActive` derivava
 * (`isActive = isOpenStatus(currentContractStatus)`), agora lido direto da
 * situação (fonte da verdade) em vez do espelho redundante.
 *
 * É também o gate de LOGIN: só acessa o sistema quem tem vínculo ativo.
 */
export function isUserEmployed(
  user: UserContractCacheLike | null | undefined,
): boolean {
  return user?.currentContractStatus === CONTRACT_STATUS.ACTIVE;
}

/**
 * Fragmento `where` Prisma que reproduz `isUserEmployed` no banco — SUBSTITUI o
 * antigo `{ isActive: true }`. Use para filtrar usuários ativos/empregados.
 *
 * Importante: usa IGUALDADE (`= ACTIVE`), não `{ not: TERMINATED }`. O filtro
 * `not` do Prisma é NULL-inclusivo (traria usuários sem vínculo), enquanto o
 * antigo `isActive: true` os excluía. A igualdade preserva esse comportamento.
 */
export const EMPLOYED_USER_WHERE = {
  currentContractStatus: CONTRACT_STATUS.ACTIVE,
} as const;

// =====================
// Máquina de transição de situação (CONTRACT_STATUS)
// =====================

/**
 * Transições de situação PERMITIDAS (situação agora é binária):
 *   ACTIVE     → TERMINATED
 *   TERMINATED → (terminal)
 *
 * Experiência e efetivação são mudanças de MODALIDADE (contractType), não de situação.
 * afastado e aviso prévio são feições do Leave/Termination, não situações de vínculo.
 */
export const CONTRACT_STATUS_TRANSITIONS: Record<CONTRACT_STATUS, CONTRACT_STATUS[]> = {
  [CONTRACT_STATUS.ACTIVE]: [CONTRACT_STATUS.TERMINATED],
  [CONTRACT_STATUS.TERMINATED]: [],
};

/**
 * `true` se a mudança de situação `from → to` é permitida. Idempotência
 * (from === to) é permitida (não-mudança).
 */
export function canTransitionContractStatus(
  from: CONTRACT_STATUS | string | null | undefined,
  to: CONTRACT_STATUS | string,
): boolean {
  if (from == null) return true; // novo vínculo / sem situação anterior
  if (from === to) return true; // no-op
  const allowed = CONTRACT_STATUS_TRANSITIONS[from as CONTRACT_STATUS];
  if (!allowed) return false;
  return allowed.includes(to as CONTRACT_STATUS);
}

/**
 * Mensagem de erro padronizada para transição inválida.
 */
export function invalidContractStatusTransitionMessage(
  from: CONTRACT_STATUS | string,
  to: CONTRACT_STATUS | string,
): string {
  return `Transição de situação inválida: ${from} → ${to}. Não é permitida.`;
}

// =====================
// Integridade EmployeeType ↔ ContractType
// =====================

/**
 * `true` quando a categoria está na folha CLT (único tipo com vínculo CLT).
 */
export function isPayrollEmployeeType(
  employeeType: EMPLOYEE_TYPE | string | null | undefined,
): boolean {
  return employeeType === EMPLOYEE_TYPE.CLT;
}

/**
 * `true` para prestadores de serviço (terceirizado/PJ). Estes não passam pelo
 * processo padrão de admissão CLT: sem cargo obrigatório, sem checklist de
 * documentos e sem exame admissional (ASO).
 */
export function isProviderEmployeeType(
  employeeType: EMPLOYEE_TYPE | string | null | undefined,
): boolean {
  return employeeType === EMPLOYEE_TYPE.PJ;
}

/**
 * Valida a coerência categoria × modalidade de um vínculo:
 *  - CLT  → contractType OBRIGATÓRIO e ∈ CLT_CONTRACT_TYPES (APPRENTICE só com CLT).
 *  - off-folha (INTERN/PJ/AUTONOMOUS) → contractType DEVE ser NULL.
 * Retorna null se OK ou uma mensagem de erro.
 */
export function validateEmployeeContractTypeIntegrity(input: {
  employeeType: EMPLOYEE_TYPE | string | null | undefined;
  contractType: CONTRACT_TYPE | string | null | undefined;
}): string | null {
  const { employeeType, contractType } = input;

  if (employeeType === EMPLOYEE_TYPE.CLT) {
    if (contractType == null) {
      return 'Vínculo CLT exige a modalidade do contrato (tipo de contrato).';
    }
    if (!CLT_CONTRACT_TYPES.includes(contractType as CONTRACT_TYPE)) {
      return `Modalidade de contrato inválida para CLT: ${contractType}.`;
    }
    return null;
  }

  // Off-folha: APPRENTICE só pode existir sob CLT.
  if (contractType === CONTRACT_TYPE.APPRENTICE) {
    return 'A modalidade Aprendiz (APPRENTICE) só é válida para vínculos CLT.';
  }
  if (contractType != null) {
    return 'Vínculos fora da folha (PJ/autônomo/estagiário) não devem ter modalidade de contrato.';
  }
  return null;
}
