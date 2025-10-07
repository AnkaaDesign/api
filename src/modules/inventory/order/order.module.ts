import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderItemService } from './order-item.service';
import { OrderScheduleService } from './order-schedule.service';
import { OrderController, OrderItemController, OrderScheduleController } from './order.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { OrderRepository } from './repositories/order/order.repository';
import { OrderPrismaRepository } from './repositories/order/order-prisma.repository';
import { OrderItemRepository } from './repositories/order-item/order-item.repository';
import { OrderItemPrismaRepository } from './repositories/order-item/order-item-prisma.repository';
import { OrderScheduleRepository } from './repositories/order-schedule/order-schedule.repository';
import { OrderSchedulePrismaRepository } from './repositories/order-schedule/order-schedule-prisma.repository';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { ItemModule } from '../item/item.module';
import { ActivityModule } from '../activity/activity.module';
import { FileModule } from '@modules/common/file/file.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, ItemModule, ActivityModule, FileModule],
  controllers: [OrderController, OrderItemController, OrderScheduleController],
  providers: [
    OrderService,
    OrderItemService,
    OrderScheduleService,
    {
      provide: OrderRepository,
      useClass: OrderPrismaRepository,
    },
    {
      provide: OrderItemRepository,
      useClass: OrderItemPrismaRepository,
    },
    {
      provide: OrderScheduleRepository,
      useClass: OrderSchedulePrismaRepository,
    },
  ],
  exports: [OrderService, OrderRepository],
})
export class OrderModule {}
