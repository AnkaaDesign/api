// service-order.module.ts

import { Module } from '@nestjs/common';
import { ServiceOrderController, ServiceController } from './service-order.controller';
import { ServiceOrderService } from './service-order.service';
import { ServiceService } from './service.service';
import { ServiceOrderListener } from './service-order.listener';
import { ServiceOrderRepository } from './repositories/service-order/service-order.repository';
import { ServiceOrderPrismaRepository } from './repositories/service-order/service-order-prisma.repository';
import { ServiceRepository } from './repositories/service/service.repository';
import { ServicePrismaRepository } from './repositories/service/service-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationModule } from '@modules/common/notification/notification.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, NotificationModule],
  controllers: [ServiceOrderController, ServiceController],
  providers: [
    ServiceOrderService,
    ServiceService,
    ServiceOrderListener,
    {
      provide: ServiceOrderRepository,
      useClass: ServiceOrderPrismaRepository,
    },
    {
      provide: ServiceRepository,
      useClass: ServicePrismaRepository,
    },
  ],
  exports: [ServiceOrderService, ServiceService, ServiceOrderRepository, ServiceRepository],
})
export class ServiceOrderModule {}
