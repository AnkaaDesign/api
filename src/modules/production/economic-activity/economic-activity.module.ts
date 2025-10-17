import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { EconomicActivityController } from './economic-activity.controller';
import { EconomicActivityService } from './economic-activity.service';

@Module({
  imports: [PrismaModule],
  controllers: [EconomicActivityController],
  providers: [EconomicActivityService],
  exports: [EconomicActivityService],
})
export class EconomicActivityModule {}
