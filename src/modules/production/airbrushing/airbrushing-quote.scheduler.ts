import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AirbrushingQuoteNotificationService } from '@modules/common/notification/airbrushing-quote-notification.service';

/**
 * Rede de segurança do aviso "novo serviço para cotar".
 *
 * Os caminhos de criação já anunciam a cotação logo depois do commit. Esta
 * varredura pega o que escapou — um caminho novo que esqueceu de chamar o
 * aviso, ou um despacho que caiu no meio. A trava `quotationNotifiedAt`
 * garante que ninguém é avisado duas vezes.
 */
@Injectable()
export class AirbrushingQuoteScheduler {
  constructor(private readonly notifier: AirbrushingQuoteNotificationService) {}

  @Cron('*/5 * * * *', { timeZone: 'America/Sao_Paulo' })
  async announcePendingQuotations(): Promise<void> {
    await this.notifier.notifyPendingRequests();
  }
}
