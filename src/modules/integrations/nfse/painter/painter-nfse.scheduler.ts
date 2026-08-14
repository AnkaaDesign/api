/**
 * Varreduras da emissão de NFS-e dos aerografistas.
 *
 * Mesma forma do `NfseEmissionScheduler`, e pela mesma razão: neste repositório
 * nenhum domínio de negócio usa fila. Bull existe, mas só carrega notificação,
 * thumbnail e backup, e o Redis é tratado como descartável. Uma linha PENDING no
 * banco sobrevive a flush de Redis e a restart; um job na fila, não. A linha
 * `AirbrushingNfse` É a fila, a trava e a trilha de auditoria.
 *
 * Três crons, cada um com seu guarda de reentrância e try/finally:
 *   - emissão      (padrão a cada 15 min, atrás de PAINTER_NFSE_SCHEDULER_ENABLED)
 *   - destravamento de PROCESSING preso (a cada 10 min, sem a trava mestra: não
 *     emite nada, só reconcilia — foi a ausência disso que já deixou nota da
 *     empresa presa em "Processando" sem erro, sem retentativa e sem botão)
 *   - alerta de esgotamento + certificado vencendo (diário)
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { NfseStatus } from '@prisma/client';
import { MAX_EMISSION_ATTEMPTS, PainterNfseService } from './painter-nfse.service';
import { FiscalCertificateService } from './fiscal-certificate.service';

const TZ = { timeZone: 'America/Sao_Paulo' };
/** Antecedências em que o alerta de vencimento de certificado dispara. */
const EXPIRY_ALERT_DAYS = [30, 15, 7, 3, 1];

@Injectable()
export class PainterNfseScheduler {
  private readonly logger = new Logger(PainterNfseScheduler.name);
  private isEmitting = false;
  private isRecovering = false;
  private isAlerting = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly painterNfse: PainterNfseService,
    private readonly certificates: FiscalCertificateService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  private get enabled(): boolean {
    return process.env.PAINTER_NFSE_SCHEDULER_ENABLED === 'true';
  }

  /**
   * Rede de segurança da emissão — NÃO é o caminho principal.
   *
   * Concluir uma aerografia já emite na hora (`flushAfterCompletion`, pós-commit).
   * Esta varredura existe para o que aquele caminho não alcança: retentativa de
   * falha transitória, linha cuja intenção foi gravada mas cujo flush morreu com o
   * processo entre o commit e a chamada, e linhas represadas de quando a trava
   * mestra (ou o `emissionEnabled` do pintor) ainda estava desligada.
   *
   * A cada 15 minutos e NÃO uma vez por dia. Não é sobre o caminho feliz — é que a
   * varredura é quem HONRA o backoff: quem decide quando retentar é o `retryAfter`
   * de cada linha (curva de 5min→12h em RETRY_BACKOFF_MS), e uma varredura diária
   * aplainaria todo esse desenho num piso de 24 h, tornando o backoff decorativo.
   * A consulta é indexada e devolve zero linha quase sempre.
   */
  @Cron('*/15 * * * *', TZ)
  async emitPending(): Promise<void> {
    if (!this.enabled) return;
    if (this.isEmitting) {
      this.logger.warn('[PAINTER_NFSE] Varredura anterior ainda em execução — pulando.');
      return;
    }

    this.isEmitting = true;
    try {
      const pending = await this.painterNfse.findPending();
      if (pending.length === 0) return;

      this.logger.log(`[PAINTER_NFSE] Varredura: ${pending.length} nota(s) a emitir.`);

      let authorized = 0;
      let errors = 0;
      let skipped = 0;

      for (const row of pending) {
        // Uma linha ruim nunca aborta a varredura inteira.
        const outcome = await this.painterNfse.emit(row.id).catch(error => {
          this.logger.error(
            `[PAINTER_NFSE] Erro inesperado em ${row.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return { nfseId: row.id, status: 'ERROR' as const };
        });

        if (outcome.status === 'AUTHORIZED') authorized += 1;
        else if (outcome.status === 'ERROR') errors += 1;
        else skipped += 1;

        if (outcome.status === 'AUTHORIZED' || outcome.status === 'ERROR') {
          await this.dispatchOutcome(row.id, outcome.status);
        }
      }

      this.logger.log(
        `[PAINTER_NFSE] Varredura concluída — autorizadas: ${authorized}, erros: ${errors}, ignoradas: ${skipped}.`,
      );
    } finally {
      this.isEmitting = false;
    }
  }

  /**
   * Destrava notas presas em PROCESSING.
   *
   * Deliberadamente NÃO está atrás de PAINTER_NFSE_SCHEDULER_ENABLED: não emite
   * nada, só reconcilia o que já foi enviado. Desligar a emissão e deixar notas
   * presas para sempre seria pior do que o problema que a trava resolve.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async recoverStuck(): Promise<void> {
    if (this.isRecovering) return;

    this.isRecovering = true;
    try {
      const { linked, reset } = await this.painterNfse.recoverStuck();
      if (linked || reset) {
        this.logger.log(
          `[PAINTER_NFSE_RECOVERY] ${linked} nota(s) vinculada(s), ${reset} devolvida(s) para nova tentativa.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[PAINTER_NFSE_RECOVERY] Falhou: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isRecovering = false;
    }
  }

  /** Alerta diário: notas que esgotaram tentativas e certificados perto de vencer. */
  @Cron('0 8 * * *', TZ)
  async dailyAlerts(): Promise<void> {
    if (this.isAlerting) return;

    this.isAlerting = true;
    try {
      await this.alertExhausted();
      await this.alertExpiringCertificates();
    } catch (error) {
      this.logger.error(
        `[PAINTER_NFSE_ALERT] Falhou: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isAlerting = false;
    }
  }

  private async alertExhausted(): Promise<void> {
    const stuck = await this.prisma.airbrushingNfse.findMany({
      where: {
        status: NfseStatus.ERROR,
        OR: [{ errorCount: { gte: MAX_EMISSION_ATTEMPTS } }, { retryAfter: null }],
      },
      select: {
        id: true,
        errorMessage: true,
        airbrushing: { select: { id: true, task: { select: { name: true } } } },
        painter: { select: { name: true } },
      },
      take: 50,
    });

    if (stuck.length === 0) return;

    this.logger.error(
      `[PAINTER_NFSE_ALERT] CRÍTICO: ${stuck.length} NFS-e de aerografista sem emissão e sem nova tentativa automática.`,
    );

    for (const row of stuck) {
      this.logger.error(
        `[PAINTER_NFSE_ALERT]   ${row.painter?.name ?? 'pintor desconhecido'} / ${
          row.airbrushing?.task?.name ?? 'tarefa desconhecida'
        }: ${row.errorMessage ?? 'sem detalhe'}`,
      );
    }

    await this.dispatch('airbrushing.nfse.rejected', {
      entityId: stuck[0].id,
      title: 'NFS-e de aerografia sem emissão',
      body: `${stuck.length} nota(s) de aerografista não foram emitidas e não serão tentadas novamente sem intervenção.`,
    });
  }

  private async alertExpiringCertificates(): Promise<void> {
    const expiring = await this.certificates.findExpiring(Math.max(...EXPIRY_ALERT_DAYS));
    if (expiring.length === 0) return;

    // Só avisa nos marcos, para não repetir o mesmo alerta 30 dias seguidos.
    const dueToday = expiring.filter(
      c => EXPIRY_ALERT_DAYS.includes(c.daysUntilExpiry) || c.isExpired,
    );
    if (dueToday.length === 0) return;

    for (const cert of dueToday) {
      const when = cert.isExpired
        ? `venceu em ${cert.notAfter.toLocaleDateString('pt-BR')}`
        : `vence em ${cert.daysUntilExpiry} dia(s)`;
      this.logger.warn(`[PAINTER_NFSE_ALERT] Certificado de ${cert.subjectCommonName} ${when}.`);

      await this.dispatch('airbrushing.nfse.certificate_expiring', {
        entityId: cert.id,
        title: 'Certificado digital de aerografista vencendo',
        body: `O certificado de ${cert.subjectCommonName} ${when}. Sem certificado válido a emissão automática para.`,
      });
    }
  }

  /** Notificação é melhor-esforço: nunca pode quebrar a varredura. */
  private async dispatch(
    configKey: string,
    payload: { entityId: string; title: string; body: string },
  ): Promise<void> {
    try {
      await this.dispatchService.dispatchByConfiguration(configKey, 'system', {
        entityType: 'AIRBRUSHING_NFSE',
        entityId: payload.entityId,
        action: 'ALERT',
        data: { title: payload.title, body: payload.body },
        overrides: {
          title: payload.title,
          body: payload.body,
        },
      } as never);
    } catch (error) {
      this.logger.warn(
        `[PAINTER_NFSE_ALERT] Notificação "${configKey}" não enviada: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async dispatchOutcome(nfseId: string, outcome: 'AUTHORIZED' | 'ERROR'): Promise<void> {
    const row = await this.prisma.airbrushingNfse.findUnique({
      where: { id: nfseId },
      select: {
        accessKey: true,
        errorMessage: true,
        painter: { select: { name: true } },
        airbrushing: { select: { id: true, task: { select: { name: true } } } },
      },
    });
    if (!row) return;

    const painter = row.painter?.name ?? 'aerografista';
    const task = row.airbrushing?.task?.name ?? 'tarefa';

    if (outcome === 'AUTHORIZED') {
      await this.dispatch('airbrushing.nfse.issued', {
        entityId: nfseId,
        title: 'NFS-e de aerografia emitida',
        body: `Nota de ${painter} referente a ${task} foi autorizada.`,
      });
      return;
    }

    await this.dispatch('airbrushing.nfse.rejected', {
      entityId: nfseId,
      title: 'NFS-e de aerografia rejeitada',
      body: `Nota de ${painter} referente a ${task} falhou: ${row.errorMessage ?? 'sem detalhe'}`,
    });
  }
}
