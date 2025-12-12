import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { TruckController } from './truck.controller';
import { TruckService } from './truck.service';

@Module({
  imports: [PrismaModule],
  controllers: [TruckController],
  providers: [TruckService],
  exports: [TruckService],
})
export class TruckModule {}
