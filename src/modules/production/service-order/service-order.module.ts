// service-order.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { ServiceOrderController } from './service-order.controller';
import { ServiceOrderService } from './service-order.service';
import { ServiceOrderListener } from './service-order.listener';
import { ServiceOrderRepository } from './repositories/service-order/service-order.repository';
import { ServiceOrderPrismaRepository } from './repositories/service-order/service-order-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { BillingStatusModule } from '@modules/financial/billing/billing-status.module';
import { SignatureModule } from '@modules/common/signature/signature.module';

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    NotificationModule,
    BillingStatusModule,
    // O espelho O.S. → orçamento reescreve `BudgetItem` e recalcula totais; o
    // motor de assinatura precisa reavaliar a coleta depois disso. forwardRef:
    // `SignatureModule` puxa NFS-e e Sicredi, e um ciclo futuro quebraria o boot.
    forwardRef(() => SignatureModule),
  ],
  controllers: [ServiceOrderController],
  providers: [
    ServiceOrderService,
    ServiceOrderListener,
    {
      provide: ServiceOrderRepository,
      useClass: ServiceOrderPrismaRepository,
    },
  ],
  exports: [ServiceOrderService, ServiceOrderRepository],
})
export class ServiceOrderModule {}
