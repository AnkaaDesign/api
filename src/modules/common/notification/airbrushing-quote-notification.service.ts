import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import { AIRBRUSHING_STATUS } from '../../../constants/enums';

/**
 * Chaves do registry (seed-notification-configs) de cada evento da cotação.
 *
 * Lado do AEROGRAFISTA — direcionadas (sectors: [] no seed), exceto o aviso de
 * serviço novo, que vai para o setor Aerografia inteiro porque TODOS podem cotar:
 *   requested · countered · selected · closed
 * Lado do COMERCIAL — por setor (ADMIN, COMMERCIAL):
 *   proposed · accepted · declined
 */
export const AIRBRUSHING_QUOTE_NOTIFICATION_KEYS = {
  requested: 'airbrushing.quote.requested',
  proposed: 'airbrushing.quote.proposed',
  countered: 'airbrushing.quote.countered',
  accepted: 'airbrushing.quote.accepted',
  declined: 'airbrushing.quote.declined',
  selected: 'airbrushing.quote.selected',
  closed: 'airbrushing.quote.closed',
} as const;

/** Um evento de negociação já decidido, esperando o commit. */
export type AirbrushingQuoteNotifyIntent =
  | {
      kind: 'proposed' | 'accepted' | 'declined';
      airbrushingId: string;
      painterId: string;
      actorUserId: string;
      amount: number | null;
      note: string | null;
    }
  | {
      kind: 'countered';
      airbrushingId: string;
      painterId: string;
      actorUserId: string;
      amount: number;
      note: string | null;
    }
  | {
      kind: 'selected';
      airbrushingId: string;
      painterId: string;
      actorUserId: string;
      amount: number;
    }
  | {
      kind: 'closed';
      airbrushingId: string;
      painterIds: string[];
      actorUserId: string | null;
      reason: 'OTHER_SELECTED' | 'CANCELLED' | 'REOPENED';
    };

/**
 * =============================================================================
 * NOTIFICAÇÕES DA COTAÇÃO DA AEROGRAFIA
 * =============================================================================
 *
 * Mesmo contrato de AirbrushingNotificationService: a decisão acontece dentro
 * da transação (o serviço de cotação monta a intenção), o despacho é SEMPRE
 * pós-commit e best-effort — uma falha de push nunca desfaz um lance gravado.
 *
 * O AVISO DE "NOVO SERVIÇO PARA COTAR" É UMA VARREDURA, NÃO UM EVENTO
 *   Aerografias em cotação nascem por cinco caminhos (POST /airbrushings, lote,
 *   formulário da tarefa na criação e na edição, cópia de tarefa). Em vez de
 *   espalhar o aviso pelos cinco, cada um só chama `notifyPendingRequests` depois
 *   do commit, e um cron repete a varredura como rede de segurança. A trava de
 *   idempotência é `Airbrushing.quotationNotifiedAt`: o UPDATE condicional
 *   (`quotationNotifiedAt IS NULL`) garante que só um despachante avisa, mesmo
 *   com duas instâncias da API varrendo ao mesmo tempo.
 *
 * LINKS
 *   Para o aerografista, `AIRBRUSHING_QUOTE` (tela de cotação do app). Para o
 *   comercial, `AIRBRUSHING` (o detalhe da aerografia, onde as propostas são
 *   comparadas) — ver generateDeepLinksForEntity.
 * =============================================================================
 */
@Injectable()
export class AirbrushingQuoteNotificationService {
  private readonly logger = new Logger(AirbrushingQuoteNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  /**
   * Avisa os aerografistas das aerografias em cotação que ainda não foram
   * anunciadas. Sem `airbrushingIds`, varre todas (uso do cron).
   */
  async notifyPendingRequests(
    airbrushingIds?: string[],
    actorUserId?: string | null,
  ): Promise<void> {
    try {
      const pending = await this.prisma.airbrushing.findMany({
        where: {
          status: AIRBRUSHING_STATUS.QUOTING,
          quotationNotifiedAt: null,
          ...(airbrushingIds ? { id: { in: airbrushingIds } } : {}),
        },
        select: { id: true },
        take: 50,
      });

      for (const { id } of pending) {
        // Reivindica o aviso ANTES de despachar: quem perder a corrida não avisa.
        const claimed = await this.prisma.airbrushing.updateMany({
          where: { id, status: AIRBRUSHING_STATUS.QUOTING, quotationNotifiedAt: null },
          data: { quotationNotifiedAt: new Date() },
        });
        if (claimed.count !== 1) continue;

        try {
          const data = await this.loadTemplateData(id);
          if (!data) continue;
          await this.dispatchService.dispatchByConfiguration(
            AIRBRUSHING_QUOTE_NOTIFICATION_KEYS.requested,
            actorUserId ?? 'system',
            {
              entityType: 'AIRBRUSHING_QUOTE',
              entityId: id,
              action: 'quote_requested',
              data,
              overrides: { relatedEntityType: 'AIRBRUSHING_QUOTE', relatedEntityId: id },
            },
          );
        } catch (error) {
          this.logger.error(
            `[AIRBRUSHING_QUOTE_NOTIFY] Falha ao anunciar a cotação da aerografia ${id}:`,
            error,
          );
        }
      }
    } catch (error) {
      this.logger.error('[AIRBRUSHING_QUOTE_NOTIFY] Falha na varredura de cotações novas:', error);
    }
  }

  /** Despacha as intenções acumuladas numa ação. SEMPRE pós-commit. */
  async flush(bucket: AirbrushingQuoteNotifyIntent[]): Promise<void> {
    for (const intent of bucket) {
      try {
        await this.dispatchIntent(intent);
      } catch (error) {
        this.logger.error(
          `[AIRBRUSHING_QUOTE_NOTIFY] Falha ao notificar "${intent.kind}" da aerografia ${intent.airbrushingId}:`,
          error,
        );
      }
    }
  }

  private async dispatchIntent(intent: AirbrushingQuoteNotifyIntent): Promise<void> {
    const base = await this.loadTemplateData(intent.airbrushingId);
    if (!base) return;

    switch (intent.kind) {
      // ── lado do comercial: o aerografista agiu ─────────────────────────────
      case 'proposed':
      case 'accepted':
      case 'declined': {
        const painterName = await this.painterName(intent.painterId);
        await this.dispatchService.dispatchByConfiguration(
          AIRBRUSHING_QUOTE_NOTIFICATION_KEYS[intent.kind],
          intent.actorUserId,
          {
            entityType: 'AIRBRUSHING',
            entityId: intent.airbrushingId,
            action: `quote_${intent.kind}`,
            data: {
              ...base,
              painterName,
              amount: this.formatBRL(intent.amount),
              note: intent.note ?? '',
            },
            overrides: { relatedEntityType: 'AIRBRUSHING', relatedEntityId: intent.airbrushingId },
          },
        );
        return;
      }

      // ── lado do aerografista: o comercial agiu ─────────────────────────────
      case 'countered':
        await this.toPainters(
          AIRBRUSHING_QUOTE_NOTIFICATION_KEYS.countered,
          intent.actorUserId,
          [intent.painterId],
          intent.airbrushingId,
          'quote_countered',
          {
            ...base,
            amount: this.formatBRL(intent.amount),
            note: intent.note ?? '',
          },
        );
        return;

      case 'selected':
        await this.toPainters(
          AIRBRUSHING_QUOTE_NOTIFICATION_KEYS.selected,
          intent.actorUserId,
          [intent.painterId],
          intent.airbrushingId,
          'quote_selected',
          {
            ...base,
            amount: this.formatBRL(intent.amount),
          },
        );
        return;

      case 'closed':
        if (!intent.painterIds.length) return;
        await this.toPainters(
          AIRBRUSHING_QUOTE_NOTIFICATION_KEYS.closed,
          intent.actorUserId ?? 'system',
          intent.painterIds,
          intent.airbrushingId,
          'quote_closed',
          {
            ...base,
            reason: {
              CANCELLED: 'o serviço foi cancelado',
              REOPENED: 'a cotação foi reaberta e o serviço voltou para todos os aerografistas',
              OTHER_SELECTED: 'outra proposta foi selecionada',
            }[intent.reason],
          },
        );
        return;
    }
  }

  private async toPainters(
    key: string,
    actorUserId: string,
    painterIds: string[],
    airbrushingId: string,
    action: string,
    data: Record<string, string>,
  ): Promise<void> {
    await this.dispatchService.dispatchByConfigurationToUsers(
      key,
      actorUserId,
      {
        entityType: 'AIRBRUSHING_QUOTE',
        entityId: airbrushingId,
        action,
        data,
        overrides: { relatedEntityType: 'AIRBRUSHING_QUOTE', relatedEntityId: airbrushingId },
      },
      painterIds,
    );
  }

  /** Variáveis comuns aos templates — conferidas contra o registry do seed. */
  private async loadTemplateData(airbrushingId: string): Promise<Record<string, string> | null> {
    const row = await this.prisma.airbrushing.findUnique({
      where: { id: airbrushingId },
      select: {
        id: true,
        description: true,
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
        `[AIRBRUSHING_QUOTE_NOTIFY] Aerografia ${airbrushingId} sumiu antes do despacho. Nada notificado.`,
      );
      return null;
    }

    return {
      airbrushingId: row.id,
      taskId: row.task?.id ?? '',
      taskName: row.task?.name ?? '',
      serialNumber: row.task?.serialNumber ?? '',
      customerName: row.task?.customer?.fantasyName ?? '',
      description: row.description ?? '',
    };
  }

  private async painterName(painterId: string): Promise<string> {
    const painter = await this.prisma.user.findUnique({
      where: { id: painterId },
      select: { name: true },
    });
    return painter?.name ?? 'Aerografista';
  }

  private formatBRL(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '';
    return value.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
