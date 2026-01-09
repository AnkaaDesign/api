import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { TruckController } from './truck.controller';
import { TruckService } from './truck.service';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [TruckController],
  providers: [TruckService],
  exports: [TruckService],
})
export class TruckModule {}
