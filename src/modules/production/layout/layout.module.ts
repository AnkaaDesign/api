// apps/api/src/modules/production/layout/layout.module.ts

import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { FileModule } from '@modules/common/file/file.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { LayoutController } from './layout.controller';
import { LayoutService } from './layout.service';
import { LayoutPrismaRepository } from './repositories/layout-prisma.repository';

@Module({
  imports: [PrismaModule, ChangeLogModule, FileModule, NotificationModule],
  controllers: [LayoutController],
  providers: [LayoutService, LayoutPrismaRepository],
  exports: [LayoutService],
})
export class LayoutModule {}
