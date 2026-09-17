import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { BillingStatusCascadeService } from './billing-status-cascade.service';

/**
 * Módulo MÍNIMO só para a cascata de estado do faturamento.
 *
 * Existe separado do `BillingModule` por uma razão de grafo: `BillingModule`
 * importa `BudgetModule` (aprovar cobrança dispara a geração de faturas, que
 * vive lá), e o `BudgetModule` precisa da cascata. Importar um do outro nos
 * dois sentidos resolveria com `forwardRef` duplo — que funciona e esconde o
 * ciclo. Este módulo não depende de nada além do Prisma, então os dois o importam
 * e o ciclo simplesmente não existe.
 */
@Module({
  imports: [PrismaModule],
  providers: [BillingStatusCascadeService],
  exports: [BillingStatusCascadeService],
})
export class BillingStatusModule {}
