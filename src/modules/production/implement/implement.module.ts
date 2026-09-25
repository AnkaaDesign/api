import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { FileModule } from '@modules/common/file/file.module';
import { ImplementController } from './implement.controller';
import { ImplementService } from './implement.service';

@Module({
  imports: [PrismaModule, ChangeLogModule, NotificationModule, FileModule],
  // O alias da rota velha vive até a R-D (P32).
  controllers: [ImplementController],
  providers: [ImplementService],
  exports: [ImplementService],
})
export class ImplementModule {}
