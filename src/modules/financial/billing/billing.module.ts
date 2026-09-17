import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { TaskQuoteModule } from '@modules/production/task-quote/task-quote.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingStatusModule } from './billing-status.module';

/**
 * O MÓDULO DO FATURAMENTO.
 *
 * Separado do orçamento de propósito, e é a separação que o dono pediu: o que é
 * VENDIDO (serviços, preço, garantia, prazo, assinatura) é do `TaskQuote`; o que
 * é COBRADO (quais veículos, para quem, em quantas parcelas, com que nota) é do
 * `Billing`. Eram a mesma linha, e por isso a mesma tela.
 *
 * `forwardRef` para o TaskQuote: aprovar uma cobrança dispara a geração de
 * faturas, que vive lá — e o módulo de orçamento não pode importar este de volta
 * sem o ciclo.
 */
@Module({
  imports: [PrismaModule, BillingStatusModule, forwardRef(() => TaskQuoteModule)],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService, BillingStatusModule],
})
export class BillingModule {}
