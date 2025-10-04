// service-order.module.ts

import { Module } from '@nestjs/common';
import { ServiceOrderController, ServiceController } from './service-order.controller';
import { ServiceOrderService } from './service-order.service';
import { ServiceService } from './service.service';
import { ServiceOrderRepository } from './repositories/service-order/service-order.repository';
import { ServiceOrderPrismaRepository } from './repositories/service-order/service-order-prisma.repository';
import { ServiceRepository } from './repositories/service/service.repository';
import { ServicePrismaRepository } from './repositories/service/service-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [ServiceOrderController, ServiceController],
  providers: [
    ServiceOrderService,
    ServiceService,
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
