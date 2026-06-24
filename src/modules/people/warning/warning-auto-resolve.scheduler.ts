import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { WarningSeverity } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants';

/**
 * Encerra automaticamente ("Resolvida") advertências cujo período de acompanhamento
 * (followUpDate) venceu sem reincidência — o "perdão tácito" / caráter pedagógico da pena.
 *
 * Regras (decididas com o RH):
 *   - Só atinge advertências com `autoResolve = true` (opt-in, ligado por padrão no form).
 *   - NUNCA encerra SUSPENSION nem FINAL_WARNING — essas exigem encerramento manual do RH.
 *   - Marca `autoResolved = true` para distinguir do encerramento manual.
 *   - Registra no Histórico de Alterações como tarefa agendada (SCHEDULED_JOB).
 *
 * Desligável via WARNING_AUTO_RESOLVE_ENABLED=false.
 */
@Injectable()
export class WarningAutoResolveScheduler {
  private readonly logger = new Logger(WarningAutoResolveScheduler.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /** Diariamente às 01:00 (horário de São Paulo). */
  @Cron('0 1 * * *', { timeZone: 'America/Sao_Paulo' })
  async autoResolveExpiredWarnings(): Promise<void> {
    const enabled = this.config.get<boolean>('WARNING_AUTO_RESOLVE_ENABLED', true);
    if (!enabled) {
      this.logger.debug('Auto-resolução de advertências desabilitada; pulando execução');
      return;
    }
    if (this.isRunning) {
      this.logger.warn('Auto-resolução já em execução; evitando sobreposição');
      return;
    }
    this.isRunning = true;
    try {
      const now = new Date();
      const candidates = await this.prisma.warning.findMany({
        where: {
          isActive: true,
          autoResolve: true,
          resolvedAt: null,
          followUpDate: { lt: now },
          // Medidas graves nunca são auto-resolvidas — sempre encerramento manual.
          severity: { notIn: [WarningSeverity.SUSPENSION, WarningSeverity.FINAL_WARNING] },
        },
        select: { id: true, followUpDate: true },
      });

      if (candidates.length === 0) {
        this.logger.debug('Nenhuma advertência vencida para auto-resolver');
        return;
      }

      let resolved = 0;
      for (const warning of candidates) {
        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.warning.update({
              where: { id: warning.id },
              data: { isActive: false, resolvedAt: now, autoResolved: true },
            });

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.WARNING,
              entityId: warning.id,
              action: CHANGE_ACTION.UPDATE,
              field: 'isActive',
              oldValue: true,
              newValue: false,
              reason: 'Advertência resolvida automaticamente por decurso do prazo de acompanhamento, sem reincidência',
              triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULED_JOB,
              triggeredById: warning.id,
              userId: null,
              transaction: tx,
            });

            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.WARNING,
              entityId: warning.id,
              action: CHANGE_ACTION.UPDATE,
              field: 'resolvedAt',
              oldValue: null,
              newValue: now,
              reason: 'Encerramento automático ao fim do acompanhamento',
              triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULED_JOB,
              triggeredById: warning.id,
              userId: null,
              transaction: tx,
            });
          });
          resolved++;
        } catch (err) {
          this.logger.error(`Falha ao auto-resolver advertência ${warning.id}: ${err}`);
        }
      }

      this.logger.log(`Auto-resolução concluída: ${resolved}/${candidates.length} advertências encerradas`);
    } catch (err) {
      this.logger.error(`Auto-resolução de advertências falhou: ${err}`);
    } finally {
      this.isRunning = false;
    }
  }
}
