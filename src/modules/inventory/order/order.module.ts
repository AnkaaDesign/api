import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderItemService } from './order-item.service';
import { OrderScheduleService } from './order-schedule.service';
import { OrderAnalyticsService } from './order-analytics.service';
import { AutoOrderService } from './auto-order.service';
import { OrderListener } from './order.listener';
import { OrderNotificationScheduler } from './order-notification.scheduler';
// import { AutoOrderScheduler } from './auto-order.scheduler'; // DISABLED: Needs update for new data structure
import { OrderController, OrderItemController, OrderScheduleController } from './order.controller';
import { AutoOrderController } from './auto-order.controller';
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
import { NotificationModule } from '@modules/common/notification/notification.module';
import { EventEmitterModule } from '@modules/common/event-emitter/event-emitter.module';

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    ItemModule,
    ActivityModule,
    FileModule,
    NotificationModule,
    EventEmitterModule,
  ],
  controllers: [OrderController, OrderItemController, OrderScheduleController, AutoOrderController],
  providers: [
    OrderService,
    OrderItemService,
    OrderScheduleService,
    OrderAnalyticsService,
    AutoOrderService,
    OrderListener,
    OrderNotificationScheduler,
    // AutoOrderScheduler, // DISABLED: Needs update for new data structure
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
