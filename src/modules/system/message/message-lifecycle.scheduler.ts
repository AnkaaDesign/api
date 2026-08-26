import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { MessagePublishedEvent } from './message.events';
import { resolveLifecycleStatus } from './message-scheduling.util';

/**
 * Move as mensagens pela janela de exibição.
 *
 * O enum `MessageStatus` sempre teve SCHEDULED e EXPIRED, mas nada no sistema
 * jamais escrevia esses valores: uma mensagem publicada ficava ACTIVE para sempre.
 * Na prática:
 *   - comunicado com prazo vencido sumia do feed (a leitura respeita `endDate`)
 *     mas continuava aparecendo como "Ativa" na administração;
 *   - comunicado sem prazo nenhum nunca tinha como ser encerrado, só arquivado
 *     à mão;
 *   - comunicado agendado para o futuro nascia ACTIVE e a notificação NUNCA era
 *     disparada, porque o create suprimia a emissão e ninguém a retomava depois
 *     (o TODO em message.service.ts).
 *
 * Este agendador fecha os três casos. `ARCHIVED` e `DRAFT` são decisões humanas e
 * ele nunca encosta nelas.
 *
 * Desligável via MESSAGE_LIFECYCLE_ENABLED=false.
 */
@Injectable()
export class MessageLifecycleScheduler {
  private readonly logger = new Logger(MessageLifecycleScheduler.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {}

  /** A cada 5 minutos: é a granularidade máxima que uma janela por DIA exige. */
  @Cron('*/5 * * * *', { timeZone: 'America/Sao_Paulo' })
  async syncMessageLifecycle(): Promise<void> {
    if (!this.config.get<boolean>('MESSAGE_LIFECYCLE_ENABLED', true)) {
      this.logger.debug('Ciclo de vida de mensagens desabilitado; pulando execução');
      return;
    }
    if (this.isRunning) {
      this.logger.warn('Ciclo de vida de mensagens já em execução; evitando sobreposição');
      return;
    }
    this.isRunning = true;

    try {
      const now = new Date();

      // Só as situações derivadas da janela. DRAFT e ARCHIVED ficam de fora.
      const candidates = await this.prisma.message.findMany({
        where: { status: { in: ['SCHEDULED', 'ACTIVE', 'EXPIRED'] } },
        select: {
          id: true,
          title: true,
          status: true,
          startDate: true,
          endDate: true,
          publishedAt: true,
          createdById: true,
        },
      });

      let transitioned = 0;

      for (const message of candidates) {
        const next = resolveLifecycleStatus(message.startDate, message.endDate, now);
        if (next === message.status) continue;

        // Uma mensagem que abre a janela agora está indo ao ar pela primeira vez
        // se nunca foi publicada — é aqui que a notificação adiada sai.
        const isFirstPublish = next === 'ACTIVE' && !message.publishedAt;

        try {
          // Transição CONDICIONAL, não `update` direto.
          //
          // O `@Cron` é registrado em TODO worker do cluster e a única proteção
          // que existia aqui era o `isRunning` acima — uma flag DE PROCESSO, que
          // não enxerga os outros workers. Dois deles liam a mesma mensagem
          // SCHEDULED, os dois a transicionavam para ACTIVE e os dois emitiam
          // `message.published`: push duplicado para todo o quadro.
          //
          // Com o status anterior no WHERE, só o primeiro update casa; o segundo
          // devolve count 0 e desiste sem anunciar nada.
          const claimed = await this.prisma.message.updateMany({
            where: { id: message.id, status: message.status },
            data: {
              status: next,
              ...(isFirstPublish ? { publishedAt: now } : {}),
            },
          });

          if (claimed.count === 0) {
            // Outro worker já transicionou esta mensagem neste tick.
            continue;
          }

          transitioned++;
          this.logger.log(
            `Mensagem "${message.title}" (${message.id}): ${message.status} → ${next}`,
          );

          if (isFirstPublish) {
            const updated = await this.prisma.message.findUnique({ where: { id: message.id } });
            if (updated) {
              await this.announce(updated.id, updated, message.createdById);
            }
          }
        } catch (err) {
          this.logger.error(`Falha ao transicionar mensagem ${message.id}: ${err}`);
        }
      }

      if (transitioned > 0) {
        this.logger.log(
          `Ciclo de vida concluído: ${transitioned}/${candidates.length} mensagem(ns) transicionada(s)`,
        );
      }
    } catch (err) {
      this.logger.error(`Sincronização do ciclo de vida de mensagens falhou: ${err}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Dispara `message.published` para a mensagem que acabou de abrir a janela.
   * Lista de alvos vazia significa "todo o quadro" — quem decide é o listener.
   */
  private async announce(messageId: string, message: any, createdById: string): Promise<void> {
    try {
      const targetRows = await this.prisma.messageTarget.findMany({
        where: { messageId },
        select: { userId: true },
      });

      this.eventEmitter.emit(
        'message.published',
        new MessagePublishedEvent(
          message,
          targetRows.map(t => t.userId),
          createdById,
        ),
      );
    } catch (err) {
      // Notificação nunca derruba a transição de situação.
      this.logger.error(`Falha ao notificar publicação da mensagem ${messageId}: ${err}`);
    }
  }
}
