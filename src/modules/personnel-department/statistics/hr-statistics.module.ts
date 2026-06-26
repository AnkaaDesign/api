import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { SecullumModule } from '@modules/integrations/secullum/secullum.module';
import { HrStatisticsController } from './hr-statistics.controller';
import { HrStatisticsService } from './hr-statistics.service';

@Module({
  imports: [PrismaModule, SecullumModule],
  controllers: [HrStatisticsController],
  providers: [HrStatisticsService],
  exports: [HrStatisticsService],
})
export class HrStatisticsModule {}
