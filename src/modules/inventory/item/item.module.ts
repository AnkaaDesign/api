import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { EventEmitterModule } from '@modules/common/event-emitter/event-emitter.module';

// Controllers
import { ItemUnifiedController } from './item.controller';

// Services
import { ItemService } from './item.service';
import { ItemBrandService } from './item-brand.service';
import { ItemCategoryService } from './item-category.service';

// Event Listeners and Schedulers
import { ItemListener } from './item.listener';
import { StockNotificationService } from '../services/stock-notification.service';
import { ItemRecomputeService } from '../services/item-recompute.service';

// Repositories
import { ItemRepository } from './repositories/item/item.repository';
import { ItemPrismaRepository } from './repositories/item/item-prisma.repository';
import { ItemBrandRepository } from './repositories/item-brand/item-brand.repository';
import { ItemBrandPrismaRepository } from './repositories/item-brand/item-brand-prisma.repository';
import { ItemCategoryRepository } from './repositories/item-category/item-category.repository';
import { ItemCategoryPrismaRepository } from './repositories/item-category/item-category-prisma.repository';

@Module({
  imports: [PrismaModule, ChangeLogModule, NotificationModule, EventEmitterModule],
  controllers: [ItemUnifiedController],
  providers: [
    // Services
    ItemService,
    ItemBrandService,
    ItemCategoryService,
    StockNotificationService,
    ItemRecomputeService,
    // Event Listeners and Schedulers
    ItemListener,
    // Repositories
    {
      provide: ItemRepository,
      useClass: ItemPrismaRepository,
    },
    {
      provide: ItemBrandRepository,
      useClass: ItemBrandPrismaRepository,
    },
    {
      provide: ItemCategoryRepository,
      useClass: ItemCategoryPrismaRepository,
    },
  ],
  exports: [
    ItemService,
    ItemBrandService,
    ItemCategoryService,
    ItemRepository,
    ItemCategoryRepository,
    StockNotificationService,
    ItemRecomputeService,
  ],
})
export class ItemModule {}
