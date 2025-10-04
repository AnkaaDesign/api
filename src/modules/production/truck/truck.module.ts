import { Module } from '@nestjs/common';
import { TruckService } from './truck.service';
import { TruckController } from './truck.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { TruckRepository } from './repositories/truck.repository';
import { TruckPrismaRepository } from './repositories/truck-prisma.repository';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [TruckController],
  providers: [
    TruckService,
    {
      provide: TruckRepository,
      useClass: TruckPrismaRepository,
    },
  ],
  exports: [TruckService, TruckRepository],
})
export class TruckModule {}
