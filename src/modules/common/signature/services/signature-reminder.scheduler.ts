/**
 * Lembrete de assinatura pendente.
 *
 * O QUE NÃO EXISTIA
 *   Um orçamento saía para assinatura e, se o cliente não abrisse, ninguém
 *   voltava a falar com ele. O reenvio era MANUAL, um signatário por vez, e
 *   dependia de alguém do comercial lembrar de conferir uma lista que não
 *   mostrava há quantos dias cada coleta estava parada. Na prática, orçamento
 *   que não era assinado na primeira semana morria em silêncio — e o primeiro
 *   sinal era a validade vencendo.
 *
 * A CADÊNCIA mora em `signature-reminder-cadence.ts`. Este arquivo é só o
 * relógio: decidir QUANDO acordar é dele, decidir QUEM está na hora é de lá.
 * São duas cadências e não uma — `dueCustomerReminder` para o cliente (quatro
 * toques, dois deles mirando o vencimento) e `isInternalReminderDue` para a
 * nossa contra-assinatura.
 *
 * UMA RODADA POR DIA, às 8h de São Paulo (era 9h até 25/09/2026). Não é de hora
 * em hora com filtro de dia porque as cadências são contadas em dias civis: acordar
 * 24 vezes para mandar no máximo uma mensagem por signatário é trabalho para
 * produzir o mesmo resultado. 8h é a abertura do expediente — o limite inferior da
 * janela de notificações (seg-sex 08-18h) — e o lembrete chega no começo do dia de
 * quem precisa decidir.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SignatureEnvelopeService } from './signature-envelope.service';

@Injectable()
export class SignatureReminderScheduler {
  private readonly logger = new Logger(SignatureReminderScheduler.name);

  /**
   * Trava de processo. A rodada percorre envelopes e fala com dois transportes
   * de rede; uma rodada lenta que ainda não terminou quando a próxima dispara
   * mandaria o lembrete em duplicidade — o carimbo `lastReminderAt` só é gravado
   * DEPOIS da entrega, então as duas leriam o mesmo estado.
   */
  private running = false;

  constructor(private readonly envelopes: SignatureEnvelopeService) {}

  @Cron('0 8 * * *', {
    name: 'signature-pending-reminder',
    timeZone: 'America/Sao_Paulo',
  })
  async sweepReminders(): Promise<void> {
    // O mesmo portão que o lembrete de parcela usa. Sem ele, qualquer máquina de
    // desenvolvimento com uma cópia do banco de produção começaria a mandar
    // WhatsApp para cliente de verdade às 8 da manhã.
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log('Lembretes de assinatura ignorados fora de produção.');
      return;
    }
    if (this.running) {
      this.logger.warn('Rodada de lembretes anterior ainda em andamento — pulando esta.');
      return;
    }

    this.running = true;
    try {
      const { sent, failed } = await this.envelopes.dispatchDueReminders();
      if (sent || failed) {
        this.logger.log(`Lembretes de assinatura: ${sent} entregue(s), ${failed} falha(s).`);
      }
    } catch (error) {
      this.logger.error(
        `Falha na rodada de lembretes de assinatura: ${
          error instanceof Error ? error.message : error
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
