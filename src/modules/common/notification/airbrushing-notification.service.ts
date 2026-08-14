import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from './notification-dispatch.service';

/**
 * As duas colunas da aerografia que decidem uma notificação do aerografista.
 * Lidas cruas da linha, antes e depois da escrita.
 */
export interface AirbrushingNotifySnapshot {
  painterId?: string | null;
  paymentStatus?: string | null;
}

/**
 * Uma notificação já DECIDIDA, esperando o commit para ser despachada.
 * `painterId` nunca é nulo aqui: sem destinatário não existe intenção.
 */
export interface AirbrushingNotifyIntent {
  airbrushingId: string;
  painterId: string;
  actorUserId: string | null;
  assigned: boolean;
  paymentReceived: boolean;
}

/**
 * =============================================================================
 * NOTIFICAÇÕES DO AEROGRAFISTA — atribuição e pagamento
 * =============================================================================
 *
 * POR QUE ESTA CLASSE EXISTE
 *   `painterId` e `paymentStatus` são escritos por QUATRO caminhos —
 *   AirbrushingService.create/update/batchUpdate e a seção de aerografia dentro
 *   de TaskService.update (que fala com `tx.airbrushing` cru). É exatamente o
 *   problema que o docblock de `registerNfseIntent` descreve: espalhar a regra
 *   pelos quatro significa que um deles vai divergir e o pintor perde a
 *   notificação sem ninguém perceber. A REGRA mora aqui; os call sites só
 *   entregam o antes e o depois.
 *
 * DUAS FASES, PELO MESMO MOTIVO DA NFS-e
 *   `registerIntent` é decisão pura, sem I/O, e roda DENTRO da transação, onde o
 *   estado anterior ainda está em mãos. `flush` roda DEPOIS do commit: o
 *   despacho grava linhas de Notification com o PrismaService (fora da `tx`) e
 *   dispara push — rede dentro de transação Prisma segura conexão do pool pelo
 *   tempo da rede, e uma notificação de um pagamento que deu rollback é pior que
 *   nenhuma.
 *
 * DIRECIONADAS, NÃO POR SETOR
 *   As duas usam `dispatchByConfigurationToUsers([painterId])`. O setor
 *   Aerografia inteiro no `allowedSectors` faria o pintor A receber o serviço e
 *   o pagamento do pintor B. Por isso os dois configs nascem com
 *   `sectors: []` — o fallback por setor do dispatch resolve para ninguém e a
 *   notificação é descartada com aviso, que é o comportamento certo quando o
 *   destinatário não existe mais.
 *
 * O ATOR NUNCA RECEBE
 *   `dispatchByConfigurationToUsers` já exclui `triggeringUserId`. Passamos o
 *   usuário que fez a escrita justamente para isso: quem marcou como pago não
 *   precisa ser avisado de que marcou como pago.
 * =============================================================================
 */
@Injectable()
export class AirbrushingNotificationService {
  private readonly logger = new Logger(AirbrushingNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  /**
   * Decide, dentro da transação, se esta escrita gera notificação para o pintor.
   *
   * Ambas as regras são de TRANSIÇÃO, não de estado: salvar de novo uma
   * aerografia que já estava atribuída e já estava paga não notifica nada. Sem
   * isso, cada edição de preço ou de observação reenviava "pagamento recebido".
   */
  registerIntent(
    bucket: AirbrushingNotifyIntent[],
    params: {
      airbrushingId: string;
      actorUserId?: string | null;
      /** Estado ANTES da escrita. `null` na criação. */
      previous: AirbrushingNotifySnapshot | null;
      /** Estado DEPOIS da escrita, lido da linha gravada. */
      next: AirbrushingNotifySnapshot;
    },
  ): void {
    const painterId = params.next.painterId ?? null;

    // Sem pintor não há a quem notificar. Vale para os dois eventos: uma
    // aerografia paga sem pintor designado é um caso de Contas a Pagar, não uma
    // notificação pessoal.
    if (!painterId) return;

    const assigned = painterId !== (params.previous?.painterId ?? null);
    const paymentReceived =
      params.next.paymentStatus === 'PAID' && params.previous?.paymentStatus !== 'PAID';

    if (!assigned && !paymentReceived) return;

    bucket.push({
      airbrushingId: params.airbrushingId,
      painterId,
      actorUserId: params.actorUserId ?? null,
      assigned,
      paymentReceived,
    });
  }

  /**
   * Despacha as intenções acumuladas. SEMPRE pós-commit.
   *
   * Best-effort por intenção: uma falha de despacho não pode derrubar uma
   * atribuição ou um pagamento que já está gravado. O mesmo contrato de
   * `flushAfterCompletion` da NFS-e.
   */
  async flush(bucket: AirbrushingNotifyIntent[]): Promise<void> {
    if (!bucket.length) return;

    for (const intent of bucket) {
      try {
        await this.dispatchIntent(intent);
      } catch (error) {
        this.logger.error(
          `[AIRBRUSHING_NOTIFY] Falha ao notificar o aerografista ${intent.painterId} ` +
            `sobre a aerografia ${intent.airbrushingId}:`,
          error,
        );
      }
    }
  }

  private async dispatchIntent(intent: AirbrushingNotifyIntent): Promise<void> {
    const row = await this.prisma.airbrushing.findUnique({
      where: { id: intent.airbrushingId },
      select: {
        id: true,
        description: true,
        price: true,
        task: {
          select: {
            id: true,
            name: true,
            serialNumber: true,
            customer: { select: { fantasyName: true } },
          },
        },
      },
    });

    if (!row) {
      this.logger.warn(
        `[AIRBRUSHING_NOTIFY] Aerografia ${intent.airbrushingId} sumiu antes do despacho ` +
          '(apagada entre o commit e o flush). Nada notificado.',
      );
      return;
    }

    // Vars conferidas contra os templates do registry (seed-notification-configs).
    // Tudo opcional é envolvido em {{#if}} lá, então string vazia some do texto.
    const data = {
      airbrushingId: row.id,
      taskId: row.task?.id ?? '',
      taskName: row.task?.name ?? '',
      serialNumber: row.task?.serialNumber ?? '',
      customerName: row.task?.customer?.fantasyName ?? '',
      description: row.description ?? '',
      price: this.formatBRL(row.price),
    };

    // O tipo de entidade AIRBRUSHING tem rota própria de detalhe na web e no
    // mobile — ver o case no generateDeepLinksForEntity. Sem override de URL: o
    // gerador de deep link produz web + mobile + universal de uma vez.
    const overrides = {
      relatedEntityType: 'AIRBRUSHING',
      relatedEntityId: row.id,
    };

    const actor = intent.actorUserId ?? 'system';

    if (intent.assigned) {
      await this.dispatchService.dispatchByConfigurationToUsers(
        'airbrushing.assigned',
        actor,
        { entityType: 'AIRBRUSHING', entityId: row.id, action: 'assigned', data, overrides },
        [intent.painterId],
      );
    }

    if (intent.paymentReceived) {
      await this.dispatchService.dispatchByConfigurationToUsers(
        'airbrushing.payment.received',
        actor,
        { entityType: 'AIRBRUSHING', entityId: row.id, action: 'paid', data, overrides },
        [intent.painterId],
      );
    }
  }

  /**
   * `Airbrushing.price` é Float e vai direto para o corpo da notificação, então
   * a formatação é feita aqui: o Handlebars do template não formata número, e
   * "1234.5" no push de um pagamento é pior que não citar o valor.
   */
  private formatBRL(price: number | null | undefined): string {
    if (price === null || price === undefined || !Number.isFinite(price)) return '';
    return price.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
