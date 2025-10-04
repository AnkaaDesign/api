// external-withdrawal.module.ts

import { Module } from '@nestjs/common';
import {
  ExternalWithdrawalController,
  ExternalWithdrawalItemController,
} from './external-withdrawal.controller';
import { ExternalWithdrawalService } from './external-withdrawal.service';
import { ExternalWithdrawalItemService } from './external-withdrawal-item.service';
import { ExternalWithdrawalRepository } from './repositories/external-withdrawal/external-withdrawal.repository';
import { ExternalWithdrawalPrismaRepository } from './repositories/external-withdrawal/external-withdrawal-prisma.repository';
import { ExternalWithdrawalItemRepository } from './repositories/external-withdrawal-item/external-withdrawal-item.repository';
import { ExternalWithdrawalItemPrismaRepository } from './repositories/external-withdrawal-item/external-withdrawal-item-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { ItemModule } from '@modules/inventory/item/item.module';
import { ActivityModule } from '@modules/inventory/activity/activity.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, ItemModule, ActivityModule],
  controllers: [ExternalWithdrawalController, ExternalWithdrawalItemController],
  providers: [
    ExternalWithdrawalService,
    ExternalWithdrawalItemService,
    {
      provide: ExternalWithdrawalRepository,
      useClass: ExternalWithdrawalPrismaRepository,
    },
    {
      provide: ExternalWithdrawalItemRepository,
      useClass: ExternalWithdrawalItemPrismaRepository,
    },
  ],
  exports: [
    ExternalWithdrawalService,
    ExternalWithdrawalRepository,
    ExternalWithdrawalItemRepository,
  ],
})
export class ExternalWithdrawalModule {}
