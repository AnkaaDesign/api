import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';

// Controllers
import { ItemUnifiedController } from './item.controller';

// Services
import { ItemService } from './item.service';
import { ItemBrandService } from './item-brand.service';
import { ItemCategoryService } from './item-category.service';
import { ItemPriceService } from './item-price.service';

// Repositories
import { ItemRepository } from './repositories/item/item.repository';
import { ItemPrismaRepository } from './repositories/item/item-prisma.repository';
import { ItemBrandRepository } from './repositories/item-brand/item-brand.repository';
import { ItemBrandPrismaRepository } from './repositories/item-brand/item-brand-prisma.repository';
import { ItemCategoryRepository } from './repositories/item-category/item-category.repository';
import { ItemCategoryPrismaRepository } from './repositories/item-category/item-category-prisma.repository';
import { ItemPriceRepository } from './repositories/item-price/item-price.repository';
import { ItemPricePrismaRepository } from './repositories/item-price/item-price-prisma.repository';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [ItemUnifiedController],
  providers: [
    // Services
    ItemService,
    ItemBrandService,
    ItemCategoryService,
    ItemPriceService,
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
    {
      provide: ItemPriceRepository,
      useClass: ItemPricePrismaRepository,
    },
  ],
  exports: [ItemService, ItemBrandService, ItemCategoryService, ItemPriceService, ItemRepository],
})
export class ItemModule {}
