// apps/api/src/modules/production/implement-measure/implement-measure.module.ts

import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { FileModule } from '@modules/common/file/file.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { ImplementMeasureController } from './implement-measure.controller';
import { ImplementMeasureService } from './implement-measure.service';
import { ImplementMeasurePrismaRepository } from './repositories/implement-measure-prisma.repository';

@Module({
  imports: [PrismaModule, ChangeLogModule, FileModule, NotificationModule],
  controllers: [ImplementMeasureController],
  providers: [ImplementMeasureService, ImplementMeasurePrismaRepository],
  exports: [ImplementMeasureService],
})
export class ImplementMeasureModule {}
