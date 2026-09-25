// O GRAFO DO EIXO DO VALOR — `Budget.status` (Modelo C, PLANO §2A.2 e §2A.5).
//
// DUAS TABELAS, e a separação é o ponto (fecha o X2):
//
//   · MANUAIS  — o que um operador pode pedir por `PUT /budgets/:id/status` e
//                pelos atos dedicados (enviar ao cliente, aprovar em nome dele,
//                retirar, reprovar, cancelar). É a tabela que web e app espelham
//                para decidir que botão mostrar.
//   · SISTEMA  — o que só acontece por um EVENTO: o cliente decide no portal, o
//                valor muda e o auto-revert devolve (DD8), uma coleta LEGADA vence
//                ou conclui, o desmonte cancela, a O.S. comercial reativa.
//                Ninguém digita estas arestas; mostrá-las como botão seria
//                oferecer um ato que não existe.
//
// Antes era UMA tabela privada (`ALLOWED` dentro do `BudgetService`) que misturava
// as duas coisas — e por isso `PENDING` servia de destino manual "fingindo
// coleta" (155 no clone sem envelope nenhum). As duas saem no contrato gerado
// (`contracts/enums.json` → `orcamento.transicoesManuais` / `transicoesDoSistema`),
// e o G26 confere que o validador do serviço responde exatamente o que a tabela diz.
//
// ⚠️ A ASSINATURA NÃO ESTÁ AQUI. Emitir, colher, vencer, recusar, invalidar são o
// eixo `signatureStatus`, escrito só pela cerimônia (D-28). Nenhuma aresta deste
// arquivo move o eixo da assinatura, e a emissão não move este (D-29).
import { TASK_QUOTE_STATUS } from '../../../constants/enums';

const S = TASK_QUOTE_STATUS;

/**
 * As arestas MANUAIS. Os papéis de cada uma estão em `validateQuoteStatusChangeRole`
 * (`budget.guards.ts`): aprovar o valor é ADMIN/COMMERCIAL e exige nota (X7).
 */
export const BUDGET_MANUAL_TRANSITIONS: Readonly<Record<TASK_QUOTE_STATUS, readonly TASK_QUOTE_STATUS[]>> = {
  // A requisição do portal: enviar o valor ao cliente, assumir por dentro
  // (cliente sem vendedor no portal), aprovar em nome dele (nota) ou cancelar.
  [S.REQUESTED]: [S.IN_NEGOTIATION, S.PENDING, S.APPROVED, S.CANCELLED],
  // Em montagem pela Ankaa: enviar ao cliente ou aprovar em nome dele (nota).
  [S.PENDING]: [S.IN_NEGOTIATION, S.APPROVED, S.CANCELLED],
  // Com o cliente: "Retirar do cliente" (volta à mesa) ou aprovar em nome dele.
  [S.IN_NEGOTIATION]: [S.PENDING, S.APPROVED, S.CANCELLED],
  // Valor aprovado: "Reprovar valor" (motivo obrigatório; é o que o app manda
  // como `{PENDING, reason}`) ou cancelar. Com cobrança aprovada, a reprovação
  // é recusada e o caminho é "Reverter Faturamento".
  [S.APPROVED]: [S.PENDING, S.CANCELLED],
  // Coleta legada vencida/recusada: reanálise — de volta à mesa ou direto ao
  // cliente — ou cancelar.
  [S.EXPIRED]: [S.PENDING, S.IN_NEGOTIATION, S.CANCELLED],
  // LEGADO (0 em produção depois da M3o-b). Declarado para o app instalado, que
  // aprova ou reprova daqui.
  [S.SIGNED]: [S.APPROVED, S.PENDING, S.CANCELLED],
  // Terminal. Recotar é criar outro orçamento.
  [S.CANCELLED]: [],
};

/** As arestas de SISTEMA — cada uma com o evento que a move. */
export const BUDGET_SYSTEM_TRANSITIONS: Readonly<Record<TASK_QUOTE_STATUS, readonly TASK_QUOTE_STATUS[]>> = {
  // Desmonte (tarefa cancelada, último veículo excluído).
  [S.REQUESTED]: [S.CANCELLED],
  // Coleta LEGADA sobre PENDING: vence/é recusada (→ EXPIRED) ou conclui (→
  // APPROVED com `BudgetValueApproval{SIGNATURE}`). Desmonte.
  [S.PENDING]: [S.EXPIRED, S.APPROVED, S.CANCELLED],
  // O cliente decide no portal: aprovar o valor (`APPROVE_VALUE`) ou recusar
  // (motivo; volta à mesa da Ankaa). Desmonte.
  [S.IN_NEGOTIATION]: [S.APPROVED, S.PENDING, S.CANCELLED],
  // O valor mudou sem status fixado: o auto-revert de hoje (DD8). Desmonte.
  [S.APPROVED]: [S.PENDING, S.CANCELLED],
  // Desmonte.
  [S.EXPIRED]: [S.CANCELLED],
  [S.SIGNED]: [S.CANCELLED],
  // A O.S. comercial reativada devolve o estado anterior — NUNCA `APPROVED` sem
  // aprovação vigente (e o cancelamento a fechou): volta a PENDING.
  [S.CANCELLED]: [S.REQUESTED, S.PENDING, S.IN_NEGOTIATION, S.EXPIRED],
};

export function isManualBudgetTransition(from: TASK_QUOTE_STATUS, to: TASK_QUOTE_STATUS): boolean {
  return (BUDGET_MANUAL_TRANSITIONS[from] ?? []).includes(to);
}

export function isSystemBudgetTransition(from: TASK_QUOTE_STATUS, to: TASK_QUOTE_STATUS): boolean {
  return (BUDGET_SYSTEM_TRANSITIONS[from] ?? []).includes(to);
}
