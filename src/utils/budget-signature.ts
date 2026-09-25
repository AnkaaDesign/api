// O EIXO DA ASSINATURA DO ORÇAMENTO — a pergunta "já se pode cobrar?" (DD7, DD11).
//
// A regra do dono é uma frase: "a cobrança só é aprovada depois de assinado". O
// eixo (`Budget.signatureStatus`) tem nove valores e três deles querem dizer
// "assinado" para a cobrança:
//
//   SIGNED          a coleta eletrônica terminou (cliente e Ankaa);
//   SIGNED_OFFLINE  "Assinado fora do sistema" (DD11): papel, WhatsApp — com nota
//                   e anexo, registrado por COMMERCIAL/ADMIN;
//   WAIVED          legado: aprovado sem coleta nenhuma antes da R-B (só a
//                   migração e a conciliação escrevem; não há ato de tela).
//
// ⛔ UM predicado, usado em TODO lugar que pergunta isso: o portão de
// `internalApprove`, o `billable` da leitura e o filtro do financeiro. Três
// listas escritas à mão divergem no primeiro valor novo do enum — e o valor
// novo desta rodada (`SIGNED_OFFLINE`) é exatamente o que seria esquecido.
import { BUDGET_SIGNATURE_STATUS, TASK_QUOTE_STATUS } from '../constants/enums';

/** Os estados do eixo que liberam a aprovação da cobrança (DD7 + DD11). */
export const BILLABLE_SIGNATURE_STATUSES: readonly BUDGET_SIGNATURE_STATUS[] = [
  BUDGET_SIGNATURE_STATUS.SIGNED,
  BUDGET_SIGNATURE_STATUS.SIGNED_OFFLINE,
  BUDGET_SIGNATURE_STATUS.WAIVED,
] as const;

/** A frase da DD7 — a mesma no 400 da API, no toast do app e no motivo da tela. */
export const BILLING_REQUIRES_SIGNATURE_MESSAGE =
  'A cobrança só pode ser aprovada depois da assinatura do orçamento.';

/**
 * O eixo libera a cobrança?
 *
 * `null`/`undefined` é NÃO: um orçamento lido sem a coluna (select enumerado que
 * esqueceu `signatureStatus`) não pode virar faturável por omissão.
 */
export function isBillableSignatureStatus(
  status: BUDGET_SIGNATURE_STATUS | string | null | undefined,
): boolean {
  if (!status) return false;
  return (BILLABLE_SIGNATURE_STATUSES as readonly string[]).includes(status);
}

/**
 * O orçamento inteiro está pronto para cobrar: valor aprovado (`APPROVED`) E
 * assinatura resolvida. É o `billable` da leitura.
 */
export function isQuoteBillable(quote: {
  status?: TASK_QUOTE_STATUS | string | null;
  signatureStatus?: BUDGET_SIGNATURE_STATUS | string | null;
}): boolean {
  return (
    quote.status === TASK_QUOTE_STATUS.APPROVED && isBillableSignatureStatus(quote.signatureStatus)
  );
}

/**
 * O mesmo predicado em `where` do Prisma (sobre `Budget`), para o filtro do
 * financeiro e para as contagens. POSITIVO (X6): lista o que entra, nunca o que
 * sai — um estado novo do enum fica de fora até alguém decidir que ele cobra.
 */
export const BILLABLE_QUOTE_WHERE = {
  status: TASK_QUOTE_STATUS.APPROVED,
  signatureStatus: { in: [...BILLABLE_SIGNATURE_STATUSES] },
} as const;
