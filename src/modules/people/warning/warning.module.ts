import { Module } from '@nestjs/common';
import { WarningController } from './warning.controller';
import { WarningService } from './warning.service';
import { WarningRepository } from './repositories/warning.repository';
import { WarningPrismaRepository } from './repositories/warning-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { FileModule } from '@modules/common/file/file.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, FileModule],
  controllers: [WarningController],
  providers: [
    WarningService,
    {
      provide: WarningRepository,
      useClass: WarningPrismaRepository,
    },
  ],
  exports: [WarningService, WarningRepository],
})
export class WarningModule {}
