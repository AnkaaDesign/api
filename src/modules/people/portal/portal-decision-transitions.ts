// api/src/modules/people/portal/portal-decision-transitions.ts
//
// AS DUAS ARESTAS QUE O PORTAL PERCORRE — e só elas.
//
// Arquivo separado, e PURO, por dois motivos concretos:
//
//  1. TESTE SEM BANCO. `portal-decision.service.ts` arrasta `PrismaService`,
//     `BudgetService` e o container do Nest; importá-lo num teste `tsx` levanta
//     meio sistema. Aqui não há import nenhum além do enum de status, que
//     também não importa nada. `tests/portal-decisao.test.ts` lê isto direto.
//
//  2. ESTE NÃO É UM SEGUNDO GRAFO. A tabela de transições continua sendo
//     `BUDGET_SYSTEM_TRANSITIONS` (`budget-transitions.ts`), e é ela que
//     autoriza — o serviço chama `assertTransitionAllowed` a cada decisão. O que
//     está aqui é o PAR (de onde, para onde) de cada ato do portal, que é
//     informação diferente: a máquina diz o que é PERMITIDO, isto diz o que a
//     aprovação do valor e a recusa SIGNIFICAM.
//
//     A consequência vale registro: se alguém tirar `IN_NEGOTIATION → APPROVED`
//     da tabela de sistema, este arquivo continua dizendo a mesma coisa e a rota
//     passa a devolver 400 com a mensagem da máquina. É o comportamento certo —
//     o portal não pode contornar a máquina afirmando uma aresta que ela não tem.
import { TASK_QUOTE_STATUS } from '../../../constants/enums';

/**
 * APROVAR O VALOR: `IN_NEGOTIATION → APPROVED` (Modelo C, D-35).
 *   O cliente concordou com o VALOR. `APPROVED` agora é "valor aprovado" — vem
 *   ANTES da assinatura e não destrava a cobrança sozinho (DD7: a cobrança espera
 *   o eixo `signatureStatus`). Grava `BudgetValueApproval{PORTAL}` com o contato
 *   como ator.
 *
 * RECUSAR: `IN_NEGOTIATION → PENDING`.
 *   Volta para a mesa da Ankaa REFAZER, com o mesmo número ("Pendente", §2A.3).
 *   Não é `CANCELLED`, que é terminal: quem recusa um preço quer outro preço, não
 *   o fim do orçamento. E não é `EXPIRED`, que é o relógio, não a vontade de
 *   ninguém. Era `REQUESTED` antes do Modelo C — mas a requisição é o pedido SEM
 *   preço, e este orçamento já tem um.
 *
 * As duas são arestas de SISTEMA (`BUDGET_SYSTEM_TRANSITIONS`): um evento do
 * cliente, não um botão da Ankaa.
 */
export const PORTAL_DECISION_TRANSITIONS = {
  APPROVE_VALUE: {
    from: TASK_QUOTE_STATUS.IN_NEGOTIATION,
    to: TASK_QUOTE_STATUS.APPROVED,
  },
  REFUSE: {
    from: TASK_QUOTE_STATUS.IN_NEGOTIATION,
    to: TASK_QUOTE_STATUS.PENDING,
  },
} as const;

export type PortalDecision = keyof typeof PORTAL_DECISION_TRANSITIONS;

/**
 * As quatro colunas de decisão de `BudgetRequest`, por ato.
 *
 * ⛔ A LISTA "APAGA" É A QUE IMPEDE O 500. O CHECK
 * `BudgetRequest_decisao_unica` (`preApprovedAt IS NULL OR refusedAt IS NULL`)
 * dispara no banco se as duas decisões coexistirem, e a máquina de estados
 * PERMITE a reversão: recusar, a Ankaa reenviar e o cliente aprovar (ou o
 * contrário) passa duas vezes pela mesma linha. Sem apagar a
 * oposta na MESMA instrução, a segunda decisão encontra a primeira de pé e o
 * cliente recebe um 500 no lugar de uma confirmação.
 */
export const PORTAL_DECISION_STAMPS = {
  APPROVE_VALUE: {
    escreve: ['preApprovedAt', 'preApprovedByResponsibleId'] as const,
    apaga: ['refusedAt', 'refusedByResponsibleId'] as const,
  },
  REFUSE: {
    escreve: ['refusedAt', 'refusedByResponsibleId'] as const,
    apaga: ['preApprovedAt', 'preApprovedByResponsibleId'] as const,
  },
} as const;
