// external-operation.module.ts

import { Module, forwardRef } from '@nestjs/common';
import {
  ExternalOperationController,
  ExternalOperationItemController,
} from './external-operation.controller';
import { ExternalOperationService } from './external-operation.service';
import { ExternalOperationItemService } from './external-operation-item.service';
import { ExternalOperationRepository } from './repositories/external-operation/external-operation.repository';
import { ExternalOperationPrismaRepository } from './repositories/external-operation/external-operation-prisma.repository';
import { ExternalOperationItemRepository } from './repositories/external-operation-item/external-operation-item.repository';
import { ExternalOperationItemPrismaRepository } from './repositories/external-operation-item/external-operation-item-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { FileModule } from '@modules/common/file/file.module';
import { ItemModule } from '@modules/inventory/item/item.module';
import { ActivityModule } from '@modules/inventory/activity/activity.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { InvoiceModule } from '@modules/financial/invoice/invoice.module';
import { NfseModule } from '@modules/integrations/nfse/nfse.module';
import { SicrediModule } from '@modules/integrations/sicredi/sicredi.module';

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    FileModule,
    ItemModule,
    ActivityModule,
    NotificationModule,
    // Billing pipeline dependencies (invoice generation, NFS-e emission, Sicredi boletos)
    forwardRef(() => InvoiceModule),
    NfseModule,
    SicrediModule,
  ],
  controllers: [ExternalOperationController, ExternalOperationItemController],
  providers: [
    ExternalOperationService,
    ExternalOperationItemService,
    {
      provide: ExternalOperationRepository,
      useClass: ExternalOperationPrismaRepository,
    },
    {
      provide: ExternalOperationItemRepository,
      useClass: ExternalOperationItemPrismaRepository,
    },
  ],
  exports: [
    ExternalOperationService,
    ExternalOperationRepository,
    ExternalOperationItemRepository,
  ],
})
export class ExternalOperationModule {}
