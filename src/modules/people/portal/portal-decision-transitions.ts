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
//     `ALLOWED`, dentro de `BudgetService.validateStatusTransition`, e é ela que
//     autoriza — o serviço chama `assertTransitionAllowed` a cada decisão. O que
//     está aqui é o PAR (de onde, para onde) de cada ato do portal, que é
//     informação diferente: a máquina diz o que é PERMITIDO, isto diz o que a
//     pré-aprovação e a recusa SIGNIFICAM.
//
//     A consequência vale registro: se alguém tirar `IN_NEGOTIATION →
//     PRE_APPROVED` de `ALLOWED`, este arquivo continua dizendo a mesma coisa e
//     a rota passa a devolver 400 com a mensagem da máquina. É o
//     comportamento certo — o portal não pode contornar a máquina afirmando uma
//     aresta que ela não tem.
import { TASK_QUOTE_STATUS } from '../../../constants/enums';

/**
 * PRÉ-APROVAR: `IN_NEGOTIATION → PRE_APPROVED`.
 *   O vendedor do cliente concordou. O orçamento espera a Ankaa LANÇAR as
 *   assinaturas — não vai direto a `APPROVED`, porque aprovar sem assinatura é
 *   exatamente o que a cerimônia existe para impedir, e é `APPROVED` que
 *   destrava a cobrança.
 *
 * RECUSAR: `IN_NEGOTIATION → REQUESTED`.
 *   Volta para o comercial REFAZER, com o mesmo número. Não é `CANCELLED`, que
 *   é terminal: quem recusa um preço quer outro preço, não o fim do orçamento.
 *   E não é `EXPIRED`, que é o relógio, não a vontade de ninguém.
 */
export const PORTAL_DECISION_TRANSITIONS = {
  APPROVE_VALUE: {
    from: TASK_QUOTE_STATUS.IN_NEGOTIATION,
    to: TASK_QUOTE_STATUS.PRE_APPROVED,
  },
  REFUSE: {
    from: TASK_QUOTE_STATUS.IN_NEGOTIATION,
    to: TASK_QUOTE_STATUS.REQUESTED,
  },
} as const;

export type PortalDecision = keyof typeof PORTAL_DECISION_TRANSITIONS;

/**
 * As quatro colunas de decisão de `BudgetRequest`, por ato.
 *
 * ⛔ A LISTA "APAGA" É A QUE IMPEDE O 500. O CHECK
 * `BudgetRequest_decisao_unica` (`preApprovedAt IS NULL OR refusedAt IS NULL`)
 * dispara no banco se as duas decisões coexistirem, e a máquina de estados
 * PERMITE a reversão: `PRE_APPROVED → IN_NEGOTIATION → REQUESTED` recusa um
 * orçamento já pré-aprovado, e a volta pré-aprova um já recusado. Sem apagar a
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
