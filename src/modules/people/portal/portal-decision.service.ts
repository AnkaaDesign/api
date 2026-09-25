// api/src/modules/people/portal/portal-decision.service.ts
//
// A APROVAÇÃO DO VALOR PELO CLIENTE — a razão de ser do portal (D-35).
//
// O orçamento sai da Ankaa precificado e para na mesa do VENDEDOR DO CLIENTE,
// que aprova o valor para seguir ou devolve pedindo revisão. Até aqui esse momento não
// existia como estado: era a `description` — texto livre — de uma `ServiceOrder`
// comercial chamada "Em Negociação", comparada em três lugares com três
// normalizações diferentes, e concluí-la APROVAVA o orçamento enquanto reabri-la
// o rebaixava. Agora são dois estados de verdade, com dois carimbos e um autor.
//
// AS QUATRO REGRAS DESTE ARQUIVO
//
//  1. ESCOPO ANTES DE TUDO. O orçamento só é alcançável pelos três caminhos de
//     `PortalScopeService.budgetScopeWhere`. Um `findUnique` por id, sem o
//     `where` do escopo, deixaria qualquer contato autenticado decidir sobre o
//     orçamento de qualquer empresa — e o id vem da URL.
//
//  2. A MÁQUINA DE ESTADOS É DE `BudgetService`, e passa-se por ela, não ao lado
//     dela. `assertTransitionAllowed` confere a tabela de SISTEMA; o movimento é
//     `applyPortalDecision`, que grava changelog, a `BudgetValueApproval{PORTAL}`
//     na mesma transação do status e aplica as travas de dinheiro. Escrever `status` direto no Prisma é o defeito que a
//     automação da O.S. tem em quatro pontos, e não se reproduz aqui.
//
//  3. NENHUM `@UserId()`, NENHUM `request.user`. O ator é um `Responsible`, e os
//     carimbos vão para FKs de `Responsible`. São 827 pontos de `@UserId()` no
//     sistema e 46 FKs NOT NULL de `User`: um único cruzamento grava UUID de
//     contato em coluna de funcionário.
//
//  4. O CHECK `BudgetRequest_decisao_unica` NÃO PODE VIRAR 500. O banco recusa
//     aprovado E recusado ao mesmo tempo, e as duas decisões se sucedem pela
//     máquina de estados (recusa, a Ankaa reenvia, o cliente aprova). Toda gravação de decisão APAGA a decisão oposta na
//     mesma linha do `update` — o CHECK nunca chega a ser consultado com os dois
//     preenchidos.
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BudgetService } from '@modules/production/budget/budget.service';
import {
  PortalNotificationService,
  PORTAL_NOTIFICATION_KEYS,
} from '@modules/common/notification/portal-notification.service';
import {
  NOTIFICATION_IMPORTANCE,
  TASK_QUOTE_STATUS,
  TASK_QUOTE_STATUS_LABELS,
} from '@constants';
import type { ResponsiblePrincipal } from '../responsible-auth/responsible-auth.guard';
import { PortalScopeService } from './portal-scope.service';
// As duas arestas, num arquivo PURO — ver o cabeçalho de lá para por que não
// moram aqui dentro.
import {
  PORTAL_DECISION_TRANSITIONS,
  type PortalDecision,
} from './portal-decision-transitions';

export { PORTAL_DECISION_TRANSITIONS, type PortalDecision };



@Injectable()
export class PortalDecisionService {
  private readonly logger = new Logger(PortalDecisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: PortalScopeService,
    private readonly budgets: BudgetService,
    private readonly notifications: PortalNotificationService,
  ) {}

  /** `PUT /cliente/me/orcamentos/:id/aprovar-valor` */
  async preApprove(principal: ResponsiblePrincipal, budgetId: string, nota?: string | null) {
    return this.decide(principal, budgetId, 'APPROVE_VALUE', nota ?? null);
  }

  /** `PUT /cliente/me/orcamentos/:id/recusar` — `motivo` é OBRIGATÓRIO. */
  async refuse(principal: ResponsiblePrincipal, budgetId: string, motivo: string) {
    return this.decide(principal, budgetId, 'REFUSE', motivo);
  }

  // ───────────────────────────────────────────────────────────────────────────

  private async decide(
    principal: ResponsiblePrincipal,
    budgetId: string,
    decision: PortalDecision,
    note: string | null,
  ) {
    const { responsibleId } = this.scope.assertScoped(principal);
    const { from, to } = PORTAL_DECISION_TRANSITIONS[decision];

    // ── 1. O ORÇAMENTO, DENTRO DO ESCOPO ────────────────────────────────────
    //
    // `findFirst` com o `where` do escopo, e NÃO `findUnique` pelo id. O id vem
    // da URL: sem o `AND` abaixo, qualquer contato autenticado decide sobre o
    // orçamento de qualquer empresa.
    //
    // 404 e não 403 quando não casa: dizer "existe, mas não é seu" confirma a
    // existência de um orçamento de outra empresa a partir de um id adivinhado.
    const budget = await this.prisma.budget.findFirst({
      where: { AND: [{ id: budgetId }, this.scope.budgetScopeWhere(principal)] },
      select: { id: true, status: true, budgetNumber: true },
    });

    if (!budget) {
      throw new NotFoundException('Orçamento não encontrado.');
    }

    const current = budget.status as TASK_QUOTE_STATUS;

    // ── 2. A MÁQUINA DE ESTADOS, ANTES DE QUALQUER ESCRITA ──────────────────
    //
    // Falha aqui é barata e a mensagem já sai com os rótulos em português. O
    // caso comum não é ataque: são duas abas abertas, e a segunda decide sobre
    // um orçamento que a primeira já moveu.
    if (current !== from) {
      throw new BadRequestException(
        `Este orçamento está "${TASK_QUOTE_STATUS_LABELS[current] ?? current}" e não ` +
          `pode mais ser ${decision === 'APPROVE_VALUE' ? 'aprovado' : 'recusado'}. ` +
          'Atualize a página.',
      );
    }
    this.budgets.assertTransitionAllowed(current, to);

    // ── 3. O CARIMBO, ANTES DO MOVIMENTO ────────────────────────────────────
    //
    // A ordem é deliberada. O carimbo é interno (ninguém o vê numa lista); o
    // STATUS é o que muda a tela de todo mundo. Gravando o carimbo primeiro,
    // uma falha no movimento deixa um carimbo órfão que o passo 4 desfaz —
    // enquanto a ordem inversa deixaria o orçamento movido e a decisão sem
    // autor, que é a metade que ninguém consegue reconstruir depois.
    const stampedAt = new Date();
    const previous = await this.stampDecision(budgetId, decision, responsibleId, note, stampedAt);

    // ── 4. O MOVIMENTO, PELA MÁQUINA ────────────────────────────────────────
    try {
      await this.budgets.applyPortalDecision(budgetId, decision, responsibleId, note);
    } catch (error) {
      // Compensação: devolve o carimbo ao que era. Sem isto, um orçamento que
      // mudou de estado entre o passo 2 e o passo 4 (outra aba, o comercial
      // cancelando) ficaria marcado como decidido sem ter se movido.
      await this.restoreDecision(budgetId, previous).catch(erroDoUndo =>
        this.logger.error(
          `Orçamento ${budgetId}: a decisão foi carimbada e o movimento falhou, e o desfazer ` +
            `também: ${erroDoUndo instanceof Error ? erroDoUndo.message : erroDoUndo}`,
        ),
      );
      throw error;
    }

    // ── 5. O AVISO ──────────────────────────────────────────────────────────
    //
    // Depois do commit, e sem poder derrubá-lo: `notifyBudgetCommercial` não
    // lança. O comercial precisa saber que o cliente decidiu — é a outra ponta
    // da passagem de bastão, e sem ela o orçamento fica parado esperando alguém
    // reparar numa lista.
    const { label, taskId } = await this.budgets.buildQuoteLabel(budgetId);
    const quoteLabel = `nº ${budget.budgetNumber} · ${label}`;

    if (decision === 'APPROVE_VALUE') {
      // O aviso diz O QUE FALTA para emitir (§2A.5): o valor era uma das peças,
      // e o comercial precisa saber se ainda depende de arte.
      const emission = await this.budgets.emissionOf(budgetId);
      const falta = emission.blockers.filter(b => b.code !== 'VALUE_NOT_APPROVED');
      await this.notifications.notifyBudgetCommercial({
        budgetId,
        taskId,
        quoteLabel,
        configKey: PORTAL_NOTIFICATION_KEYS.PRE_APPROVED,
        title: 'Valor aprovado pelo cliente',
        body:
          `${principal.name} aprovou o valor do orçamento ${quoteLabel}` +
          `${principal.companyName ? ` (${principal.companyName})` : ''}. ` +
          (falta.length === 0
            ? 'Nada mais falta: emita para assinatura.'
            : `Para emitir falta: ${falta.map(b => b.message).join(' ')}`) +
          (note ? ` Observação do cliente: "${note}"` : ''),
        importance: NOTIFICATION_IMPORTANCE.HIGH,
        extraMetadata: { decidedByResponsibleId: responsibleId, decisionNote: note },
      });
    } else {
      await this.notifications.notifyBudgetCommercial({
        budgetId,
        taskId,
        quoteLabel,
        configKey: PORTAL_NOTIFICATION_KEYS.REFUSED,
        title: 'Orçamento recusado pelo cliente',
        // O MOTIVO VAI NO CORPO, inteiro. É o que o comercial precisa para
        // refazer, e é o único texto que o cliente se deu ao trabalho de
        // escrever — resumi-lo aqui seria perdê-lo.
        body:
          `${principal.name} pediu revisão do orçamento ${quoteLabel}` +
          `${principal.companyName ? ` (${principal.companyName})` : ''}. ` +
          `Motivo: "${note}"`,
        importance: NOTIFICATION_IMPORTANCE.HIGH,
        extraMetadata: { decidedByResponsibleId: responsibleId, decisionNote: note },
      });
    }

    return {
      success: true,
      message:
        decision === 'APPROVE_VALUE'
          ? 'Valor aprovado. O comercial foi avisado e emite o documento para assinatura assim que a arte estiver aprovada.'
          : 'Pedido de revisão enviado. O comercial foi avisado e vai refazer o orçamento.',
      data: {
        id: budgetId,
        status: to,
        decision,
        decidedAt: stampedAt,
        decidedByResponsibleId: responsibleId,
        decisionNote: note,
      },
    };
  }

  /**
   * Grava a decisão em `BudgetRequest` e devolve o que estava lá antes.
   *
   * ⛔ AS DUAS DECISÕES SÃO ESCRITAS NA MESMA INSTRUÇÃO, uma preenchida e a
   * outra APAGADA. É isto que impede o CHECK `BudgetRequest_decisao_unica`
   * (`preApprovedAt IS NULL OR refusedAt IS NULL`) de virar 500 na cara do
   * cliente: pré-aprovar depois de ter recusado, ou recusar depois de ter
   * pré-aprovado, são caminhos LEGAIS da máquina de estados
   * (PRE_APPROVED → IN_NEGOTIATION → REQUESTED e a volta), e sem o apagamento a
   * segunda decisão encontraria a primeira ainda de pé.
   *
   * ⚠️ SÓ QUANDO A REQUISIÇÃO EXISTE (D-35). Antes era `upsert`, e o portal
   * FABRICAVA uma `BudgetRequest` (com briefing de mentira) para todo orçamento
   * nascido por dentro — só para ter onde carimbar a decisão. A fonte de verdade
   * da aprovação agora é `BudgetValueApproval{PORTAL}`, gravada com o status; a
   * recusa vai para a trilha com o motivo. O carimbo em `BudgetRequest` continua
   * para quem tem requisição, porque a tela e o changelog o leem.
   */
  private async stampDecision(
    budgetId: string,
    decision: PortalDecision,
    responsibleId: string,
    note: string | null,
    at: Date,
  ): Promise<DecisionSnapshot> {
    const anterior = await this.prisma.budgetRequest.findUnique({
      where: { budgetId },
      select: {
        preApprovedAt: true,
        preApprovedByResponsibleId: true,
        refusedAt: true,
        refusedByResponsibleId: true,
        decisionNote: true,
      },
    });

    const campos =
      decision === 'APPROVE_VALUE'
        ? {
            preApprovedAt: at,
            preApprovedByResponsibleId: responsibleId,
            refusedAt: null,
            refusedByResponsibleId: null,
            decisionNote: note,
          }
        : {
            refusedAt: at,
            refusedByResponsibleId: responsibleId,
            preApprovedAt: null,
            preApprovedByResponsibleId: null,
            decisionNote: note,
          };

    if (!anterior) return { existia: false };
    await this.prisma.budgetRequest.update({ where: { budgetId }, data: campos });

    return anterior
      ? { existia: true, ...anterior }
      : { existia: false };
  }

  /** Desfaz `stampDecision`. Ver a compensação no passo 4 de `decide`. */
  private async restoreDecision(budgetId: string, previous: DecisionSnapshot): Promise<void> {
    // Sem requisição não houve carimbo (D-35): nada a desfazer.
    if (!previous.existia) return;

    await this.prisma.budgetRequest.update({
      where: { budgetId },
      data: {
        preApprovedAt: previous.preApprovedAt ?? null,
        preApprovedByResponsibleId: previous.preApprovedByResponsibleId ?? null,
        refusedAt: previous.refusedAt ?? null,
        refusedByResponsibleId: previous.refusedByResponsibleId ?? null,
        decisionNote: previous.decisionNote ?? null,
      },
    });
  }
}


interface DecisionSnapshotFields {
  preApprovedAt?: Date | null;
  preApprovedByResponsibleId?: string | null;
  refusedAt?: Date | null;
  refusedByResponsibleId?: string | null;
  decisionNote?: string | null;
}

/**
 * O estado da decisão ANTES da gravação.
 *
 * `existia` é o discriminante e não um `null`: sem requisição não há carimbo a
 * desfazer; com ela, desfazer é devolver a linha ao valor anterior.
 */
type DecisionSnapshot =
  | ({ existia: true } & DecisionSnapshotFields)
  | { existia: false };
