import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogService } from './changelog.service';
import { ChangeLogController } from './changelog.controller';
import { ChangeLogRepository } from './repositories/changelog.repository';
import { ChangeLogPrismaRepository } from './repositories/changelog-prisma.repository';

@Module({
  imports: [PrismaModule],
  controllers: [ChangeLogController],
  providers: [
    ChangeLogService,
    { provide: ChangeLogRepository, useClass: ChangeLogPrismaRepository },
  ],
  exports: [ChangeLogService, ChangeLogRepository],
})
export class ChangeLogModule {}
