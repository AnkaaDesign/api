import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { ImplementController } from './implement.controller';
import { TruckAliasController } from './truck-alias.controller';
import { ImplementService } from './implement.service';

@Module({
  imports: [PrismaModule, ChangeLogModule, NotificationModule],
  // O alias da rota velha vive até a R-D (P32).
  controllers: [ImplementController, TruckAliasController],
  providers: [ImplementService],
  exports: [ImplementService],
})
export class ImplementModule {}
