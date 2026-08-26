import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { MessageScheduleService } from './message-schedule.service';
import { SCHEDULE_RUN_STATUS } from '../../../constants/enums';

/**
 * Dispara os `MessageSchedule` cujo `nextRun` já passou, publicando UMA
 * ocorrência por agendamento vencido e avançando `nextRun` no lugar.
 *
 * Concorrência / idempotência — defesa em profundidade, porque o `@Cron` é
 * registrado em TODO worker do cluster e todos disparam no mesmo tick:
 *   - cada agendamento é RECLAMADO com um UPDATE condicional atômico
 *     (`lastFiredAt`) antes de ser processado; só um worker vence, o outro pula.
 *     É seguro com pool de conexões (nada de advisory lock preso à sessão);
 *   - o piso `MIN_FIRE_INTERVAL_MS` sobre `lastFiredAt` também debounça
 *     re-disparo;
 *   - e, por último, a `@@unique([scheduleId, occurrenceDate])` de `Message`
 *     recusa a segunda materialização da mesma data mesmo que as duas travas
 *     acima falhem — é o que fecha a janela entre criar e avançar.
 *
 * Fora de produção o cron só roda com `MESSAGE_SCHEDULE_CRON_DEV=1`. Em
 * produção há a chave de desligamento `MESSAGE_SCHEDULE_CRON_ENABLED=0`.
 */
@Injectable()
export class MessageScheduleScheduler {
  private readonly logger = new Logger(MessageScheduleScheduler.name);
  private static readonly MIN_FIRE_INTERVAL_MS = 60 * 60 * 1000; // 1 hora

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: MessageScheduleService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  /**
   * De hora em hora no minuto 10. O deslocamento evita colisão com os crons do
   * minuto 0 e com o de agendamento de pedidos (minuto 5). A hora é a menor
   * unidade que ainda entrega `publishHour` no horário certo.
   */
  @Cron('10 * * * *', { timeZone: 'America/Sao_Paulo' })
  async processDueMessageSchedules(): Promise<void> {
    const devEnabled = process.env.MESSAGE_SCHEDULE_CRON_DEV === '1';
    if (process.env.NODE_ENV !== 'production' && !devEnabled) {
      return;
    }
    if (process.env.MESSAGE_SCHEDULE_CRON_ENABLED === '0') {
      this.logger.warn('Cron de mensagens recorrentes desligado via MESSAGE_SCHEDULE_CRON_ENABLED=0');
      return;
    }
    await this.runDueSchedules();
  }

  /** Exposto para o disparo manual do controller e para teste. */
  async runDueSchedules(): Promise<{ published: number; skipped: number; failed: number }> {
    const now = new Date();
    const fireFloor = new Date(now.getTime() - MessageScheduleScheduler.MIN_FIRE_INTERVAL_MS);

    const due = await this.prisma.messageSchedule.findMany({
      where: {
        isActive: true,
        finishedAt: null,
        nextRun: { lte: now },
        OR: [{ lastFiredAt: null }, { lastFiredAt: { lt: fireFloor } }],
      },
      select: { id: true, name: true, nextRun: true },
    });

    if (due.length === 0) {
      this.logger.debug('Nenhum agendamento de mensagem vencido');
      return { published: 0, skipped: 0, failed: 0 };
    }

    this.logger.log(`Processando ${due.length} agendamento(s) de mensagem vencido(s)`);

    let published = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of due) {
      try {
        // RECLAME atômico: o WHERE só casa se nenhum outro worker já tiver
        // empurrado `lastFiredAt` para dentro da janela.
        const claim = await this.prisma.messageSchedule.updateMany({
          where: {
            id: row.id,
            isActive: true,
            finishedAt: null,
            OR: [{ lastFiredAt: null }, { lastFiredAt: { lt: fireFloor } }],
          },
          data: { lastFiredAt: now },
        });
        if (claim.count === 0) {
          continue;
        }

        const outcome = await this.fireOnce(row.id, row.nextRun ?? now, now);
        if (outcome === SCHEDULE_RUN_STATUS.SUCCESS) published++;
        else if (outcome === SCHEDULE_RUN_STATUS.SKIPPED_NO_ITEMS) skipped++;
        else failed++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Falha ao disparar agendamento ${row.id}: ${msg}`);
        await this.recordRunFailure(row.id, row.name, msg);
      }
    }

    this.logger.log(
      `Agendamentos de mensagem: ${published} publicado(s), ${skipped} pulado(s), ${failed} com falha`,
    );
    return { published, skipped, failed };
  }

  /**
   * Publica a ocorrência devida e escritura o agendamento.
   *
   * ⚠️ Em caso de FALHA o `nextRun` NÃO avança — o próximo tick tenta de novo.
   * Só o sucesso (ou o pulo deliberado) move a régua.
   */
  private async fireOnce(
    scheduleId: string,
    occurrenceDay: Date,
    now: Date,
  ): Promise<SCHEDULE_RUN_STATUS> {
    const schedule = await this.prisma.messageSchedule.findUnique({
      where: { id: scheduleId },
      include: { weeklyConfig: true, monthlyConfig: true, yearlyConfig: true },
    });
    if (!schedule) return SCHEDULE_RUN_STATUS.FAILED;

    // Limites da recorrência, checados ANTES de publicar.
    if (schedule.endsOn && occurrenceDay.getTime() > schedule.endsOn.getTime()) {
      await this.finalize(scheduleId, now, 'Vigência encerrada');
      return SCHEDULE_RUN_STATUS.SKIPPED_NO_ITEMS;
    }
    if (
      schedule.maxOccurrences !== null &&
      schedule.occurrenceCount >= schedule.maxOccurrences
    ) {
      await this.finalize(scheduleId, now, 'Número máximo de ocorrências atingido');
      return SCHEDULE_RUN_STATUS.SKIPPED_NO_ITEMS;
    }

    const result = await this.service.materializeOccurrence(scheduleId, occurrenceDay, now);

    const nextRun = this.service.computeNextRun(
      schedule as any,
      schedule.nextRun ?? occurrenceDay,
      now,
    );

    const publishedSomething = result.status === SCHEDULE_RUN_STATUS.SUCCESS && !!result.message;

    await this.prisma.messageSchedule.update({
      where: { id: scheduleId },
      data: {
        lastFiredAt: now,
        ...(publishedSomething
          ? { lastRun: now, occurrenceCount: { increment: 1 } }
          : {}),
        nextRun,
        lastRunStatus: result.status as any,
        lastRunError: result.status === SCHEDULE_RUN_STATUS.SUCCESS ? null : (result.reason ?? null),
        // Sem próxima data, o agendamento se encerra em vez de ficar vivo e mudo.
        ...(nextRun ? {} : { finishedAt: now, isActive: false }),
      },
    });

    // Um público que resolveu para vazio é falha silenciosa clássica: o
    // administrador acha que o aviso saiu. Avisa-se quem cuida do agendamento.
    if (result.status === SCHEDULE_RUN_STATUS.SKIPPED_NO_ITEMS) {
      await this.notifyFailure(
        scheduleId,
        schedule.name,
        result.reason ?? 'Público vazio',
        'skipped',
      );
    }

    return result.status;
  }

  /** Encerra o agendamento sem apagá-lo — o histórico continua consultável. */
  private async finalize(scheduleId: string, now: Date, reason: string): Promise<void> {
    await this.prisma.messageSchedule.update({
      where: { id: scheduleId },
      data: {
        isActive: false,
        finishedAt: now,
        nextRun: null,
        lastFiredAt: now,
        lastRunStatus: SCHEDULE_RUN_STATUS.SKIPPED_NO_ITEMS as any,
        lastRunError: reason,
      },
    });
    this.logger.log(`Agendamento ${scheduleId} encerrado: ${reason}`);
  }

  /** Registra a falha SEM avançar `nextRun`, para o tick seguinte tentar de novo. */
  private async recordRunFailure(
    scheduleId: string,
    scheduleName: string,
    error: string,
  ): Promise<void> {
    await this.prisma.messageSchedule
      .update({
        where: { id: scheduleId },
        data: {
          lastRunStatus: SCHEDULE_RUN_STATUS.FAILED as any,
          lastRunError: error.slice(0, 1000),
        },
      })
      .catch(() => undefined);

    await this.notifyFailure(scheduleId, scheduleName, error, 'failed');
  }

  /**
   * Espelha `order_schedule.run.failed`: um agendamento que para de publicar em
   * silêncio é indistinguível de um que nunca existiu.
   */
  private async notifyFailure(
    scheduleId: string,
    scheduleName: string,
    error: string,
    kind: 'failed' | 'skipped',
  ): Promise<void> {
    try {
      const shortError = (error ?? '')
        .split('\n')[0]
        .replace(/[{}[\]"]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);

      const title =
        kind === 'skipped' ? 'Comunicado agendado não publicado' : 'Falha no comunicado agendado';
      const body =
        kind === 'skipped'
          ? `O comunicado "${scheduleName}" não foi publicado: ${shortError}`
          : `Falha ao publicar o comunicado agendado "${scheduleName}": ${shortError}`;

      await this.dispatchService.dispatchByConfiguration(
        'message_schedule.run.failed',
        'system',
        {
          entityType: 'MessageSchedule',
          entityId: scheduleId,
          action: `run_${kind}`,
          data: { scheduleName, errorMessage: error.slice(0, 500) },
          overrides: {
            title,
            body,
            webUrl: `/administracao/mensagens/agendamentos/detalhes/${scheduleId}`,
            relatedEntityType: 'MESSAGE_SCHEDULE',
          },
        },
      );
    } catch (notifyErr) {
      this.logger.error(
        'Falha ao notificar problema de agendamento (message_schedule.run.failed):',
        notifyErr,
      );
    }
  }
}
