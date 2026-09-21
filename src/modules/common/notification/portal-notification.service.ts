// api/src/modules/common/notification/portal-notification.service.ts
//
// OS DOIS AVISOS DO PORTAL DO RESPONSÁVEL — e o único lugar onde eles nascem.
//
// O fluxo do portal é uma passagem de bastão entre três pessoas de duas
// empresas: o contato do cliente ABRE a requisição, o comercial da Ankaa
// PRECIFICA, o vendedor do cliente PRÉ-APROVA ou RECUSA. Cada troca de mão é um
// bastão que o outro lado não vê cair — e até 20/09/2026 o sistema não tinha
// como avisar ninguém do lado de fora: `Notification.userId → User` era a única
// FK de pessoa.
//
// Por que um serviço e não `dispatchByConfiguration`: aquele caminho resolve
// destinatário por SETOR (`targetRule.allowedSectors`), a partir de uma linha de
// `NotificationConfiguration` no banco. Os dois avisos daqui têm destinatário
// NOMINAL — o comercial DAQUELE orçamento, o contato que ABRIU aquela requisição
// —, que nenhuma regra de setor sabe encontrar. `configKey` continua indo no
// metadata, porque é dele que a política do WhatsApp e o filtro de preferências
// dependem; o que não se usa é a resolução por setor.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  NOTIFICATION_ACTION_TYPE,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_TYPE,
  SECTOR_PRIVILEGES,
} from '../../../constants';
import { EMPLOYED_USER_WHERE } from '../../../utils/contract';
import { NotificationDispatchService } from './notification-dispatch.service';
import {
  recipientColumns,
  responsibleRecipient,
  userRecipient,
  type NotificationRecipient,
} from './notification-recipient';

/** As chaves de config destes avisos. Viajam no metadata e nomeiam a origem. */
export const PORTAL_NOTIFICATION_KEYS = {
  /** O vendedor do cliente PRÉ-APROVOU. Vai para o comercial da Ankaa. */
  PRE_APPROVED: 'budget.portal_pre_approved',
  /** O vendedor do cliente RECUSOU. Vai para o comercial da Ankaa, com o motivo. */
  REFUSED: 'budget.portal_refused',
  /** A Ankaa precificou: os valores já aparecem no portal. Vai para o contato. */
  VALUES_VISIBLE: 'budget.portal_values_visible',
  /** O contato do cliente ABRIU uma requisição. Vai para o comercial da Ankaa. */
  REQUESTED: 'budget.portal_requested',
} as const;

interface PortalNotificationInput {
  recipient: NotificationRecipient;
  title: string;
  body: string;
  configKey: string;
  budgetId: string;
  /** A tarefa-âncora, quando há: é o id que as telas internas usam na URL. */
  taskId?: string | null;
  webUrl: string;
  /** Rótulo legível do orçamento ("nº 984 · Marquespan"), para o WhatsApp e o e-mail. */
  quoteLabel: string;
  importance?: NOTIFICATION_IMPORTANCE;
  extraMetadata?: Record<string, unknown>;
}

@Injectable()
export class PortalNotificationService {
  private readonly logger = new Logger(PortalNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: NotificationDispatchService,
  ) {}

  /**
   * O contato do cliente decidiu — avisa o comercial da Ankaa.
   *
   * DESTINATÁRIO: `Budget.commercialUserId`, que é a única relação com `User`
   * que o orçamento tem. Ele é NULO em todo o acervo (ver `resolveAnkaaSigner`),
   * então o caminho real é o segundo: todo mundo do setor COMERCIAL com vínculo
   * ativo. Sem a queda, o aviso mais importante do fluxo — o cliente decidiu —
   * não chegaria a ninguém em 100% dos casos de hoje.
   *
   * ⚠️ NÃO LANÇA. A decisão já está gravada; um aviso que falha não pode
   * desfazê-la.
   */
  async notifyBudgetCommercial(args: {
    budgetId: string;
    taskId?: string | null;
    quoteLabel: string;
    configKey: string;
    title: string;
    body: string;
    importance?: NOTIFICATION_IMPORTANCE;
    extraMetadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const recipients = await this.resolveCommercialUserIds(args.budgetId);

      if (recipients.length === 0) {
        this.logger.warn(
          `Orçamento ${args.budgetId}: nenhum comercial com vínculo ativo para avisar ` +
            `(${args.configKey}). Confira o setor COMERCIAL.`,
        );
        return;
      }

      const webUrl = args.taskId
        ? `/financeiro/orcamento/detalhes/${args.taskId}`
        : '/financeiro/orcamento';

      for (const userId of recipients) {
        await this.create({
          recipient: userRecipient(userId),
          title: args.title,
          body: args.body,
          configKey: args.configKey,
          budgetId: args.budgetId,
          taskId: args.taskId ?? null,
          webUrl,
          quoteLabel: args.quoteLabel,
          importance: args.importance,
          extraMetadata: args.extraMetadata,
        });
      }
    } catch (error) {
      this.logger.error(
        `Falha ao avisar o comercial do orçamento ${args.budgetId} (${args.configKey}): ` +
          `${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * A Ankaa precificou — avisa quem abriu a requisição.
   *
   * DESTINATÁRIO: `BudgetRequest.requestedByResponsibleId`. É o único contato
   * que se sabe interessado neste orçamento específico — avisar "todos os
   * contatos da empresa" mandaria preço para quem não pode vê-lo (o Marketing
   * não tem a seção `PRICING`) e faria do aviso uma lista de distribuição.
   *
   * Orçamento que NÃO nasceu de requisição não tem a quem avisar, e isso é
   * normal: a maioria dos orçamentos é aberta por dentro. Sai em silêncio.
   */
  async notifyRequesterValuesVisible(args: {
    budgetId: string;
    taskId?: string | null;
    quoteLabel: string;
  }): Promise<void> {
    try {
      const request = await this.prisma.budgetRequest.findUnique({
        where: { budgetId: args.budgetId },
        select: { requestedByResponsibleId: true },
      });

      if (!request?.requestedByResponsibleId) {
        this.logger.debug(
          `Orçamento ${args.budgetId} não nasceu de requisição do portal — ninguém a avisar.`,
        );
        return;
      }

      await this.create({
        recipient: responsibleRecipient(request.requestedByResponsibleId),
        title: 'Seu orçamento já tem valores',
        body:
          `O orçamento ${args.quoteLabel} foi precificado e já pode ser conferido no portal. ` +
          'Depois de analisar, você pode pré-aprovar ou pedir revisão.',
        configKey: PORTAL_NOTIFICATION_KEYS.VALUES_VISIBLE,
        budgetId: args.budgetId,
        taskId: args.taskId ?? null,
        // Plural, sempre: `/cliente/:customerId/orcamento/:id` (a pública)
        // pontua ACIMA de `/cliente/painel/*`, e uma seção do portal chamada
        // `orcamento` no singular nunca é alcançada. Fixado em teste no web.
        webUrl: `/cliente/painel/orcamentos/${args.budgetId}`,
        quoteLabel: args.quoteLabel,
        importance: NOTIFICATION_IMPORTANCE.HIGH,
      });
    } catch (error) {
      this.logger.error(
        `Falha ao avisar o requisitante do orçamento ${args.budgetId}: ` +
          `${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Grava a linha e a despacha.
   *
   * ⚠️ O PAR DE COLUNAS SAI DE `recipientColumns`, NUNCA ESCRITO À MÃO.
   * `Notification_exactly_one_recipient` recusa os dois preenchidos e os dois
   * nulos; escrever `{ userId }` aqui e `{ responsibleId }` ali é exatamente
   * como se chega ao primeiro caso, e o CHECK viraria 500 na cara de quem
   * acabou de pré-aprovar. A união discriminada torna o erro impossível de
   * escrever.
   */
  private async create(input: PortalNotificationInput): Promise<void> {
    const notification = await this.prisma.notification.create({
      data: {
        ...recipientColumns(input.recipient),
        type: NOTIFICATION_TYPE.GENERAL as any,
        importance: (input.importance ?? NOTIFICATION_IMPORTANCE.NORMAL) as any,
        title: input.title,
        body: input.body,
        actionType: NOTIFICATION_ACTION_TYPE.VIEW_DETAILS as any,
        actionUrl: null,
        relatedEntityType: 'TASK_QUOTE',
        relatedEntityId: input.taskId ?? input.budgetId,
        // Canal vazio = "decida pelas preferências". Para o contato de cliente
        // o campo é irrelevante: `dispatchToResponsible` não consulta canal
        // nenhum, porque não existe preferência de notificação de contato.
        channel: [],
        metadata: {
          configKey: input.configKey,
          webUrl: input.webUrl,
          budgetId: input.budgetId,
          taskId: input.taskId ?? undefined,
          quoteLabel: input.quoteLabel,
          ...(input.extraMetadata ?? {}),
        },
      },
    });

    await this.dispatch.dispatchNotification(notification.id);
  }

  /**
   * Quem é "o comercial" deste orçamento.
   *
   * Ordem: o designado no orçamento (se tiver vínculo ativo), senão o setor
   * COMERCIAL inteiro. Devolve ids, não usuários: quem grava a notificação só
   * precisa da chave, e carregar setor/cargo/preferência aqui seria trabalho
   * que o dispatch refaz.
   */
  private async resolveCommercialUserIds(budgetId: string): Promise<string[]> {
    const budget = await this.prisma.budget.findUnique({
      where: { id: budgetId },
      select: { commercialUserId: true },
    });

    if (budget?.commercialUserId) {
      const designado = await this.prisma.user.findFirst({
        where: { id: budget.commercialUserId, ...EMPLOYED_USER_WHERE },
        select: { id: true },
      });
      if (designado) return [designado.id];
      this.logger.warn(
        `O comercial designado do orçamento ${budgetId} (${budget.commercialUserId}) não tem ` +
          'vínculo ativo — o aviso vai para o setor COMERCIAL.',
      );
    }

    const setor = await this.prisma.user.findMany({
      where: {
        ...EMPLOYED_USER_WHERE,
        sector: { is: { privileges: SECTOR_PRIVILEGES.COMMERCIAL as any } },
      },
      select: { id: true },
    });

    return setor.map(u => u.id);
  }
}
