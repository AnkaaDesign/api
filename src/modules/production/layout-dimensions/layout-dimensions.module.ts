import { Module } from '@nestjs/common';

import { PrismaModule } from '@modules/common/prisma/prisma.module';

import { LayoutDimensionsController } from './layout-dimensions.controller';
import { LayoutDimensionsService } from './layout-dimensions.service';

@Module({
  imports: [PrismaModule],
  controllers: [LayoutDimensionsController],
  providers: [LayoutDimensionsService],
  exports: [LayoutDimensionsService],
})
export class LayoutDimensionsModule {}
