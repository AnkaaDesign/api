// apps/api/src/modules/production/layout/layout.module.ts

import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { LayoutController } from './layout.controller';
import { LayoutService } from './layout.service';
import { LayoutPrismaRepository } from './repositories/layout-prisma.repository';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [LayoutController],
  providers: [LayoutService, LayoutPrismaRepository],
  exports: [LayoutService],
})
export class LayoutModule {}
