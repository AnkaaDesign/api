import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { DashboardRepository } from './repositories/dashboard/dashboard.repository';
import { DashboardPrismaRepository } from './repositories/dashboard/dashboard-prisma.repository';

@Module({
  imports: [PrismaModule],
  controllers: [DashboardController],
  providers: [
    DashboardService,
    {
      provide: DashboardRepository,
      useClass: DashboardPrismaRepository,
    },
  ],
  exports: [DashboardService, DashboardRepository],
})
export class DashboardModule {}
