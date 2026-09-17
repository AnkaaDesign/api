// service-order.module.ts

import { Module } from '@nestjs/common';
import { ServiceOrderController } from './service-order.controller';
import { ServiceOrderService } from './service-order.service';
import { ServiceOrderListener } from './service-order.listener';
import { ServiceOrderRepository } from './repositories/service-order/service-order.repository';
import { ServiceOrderPrismaRepository } from './repositories/service-order/service-order-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { BillingStatusModule } from '@modules/financial/billing/billing-status.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, NotificationModule, BillingStatusModule],
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
