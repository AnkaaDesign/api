import { Module } from '@nestjs/common';
import { WarehouseLocationController } from './warehouse-location.controller';
import { WarehouseLocationService } from './warehouse-location.service';
import { WarehouseLocationRepository } from './repositories/warehouse-location.repository';
import { WarehouseLocationPrismaRepository } from './repositories/warehouse-location-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [WarehouseLocationController],
  providers: [
    WarehouseLocationService,
    {
      provide: WarehouseLocationRepository,
      useClass: WarehouseLocationPrismaRepository,
    },
  ],
  exports: [WarehouseLocationService, WarehouseLocationRepository],
})
export class WarehouseLocationModule {}
