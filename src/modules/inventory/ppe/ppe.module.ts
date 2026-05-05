import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { UserModule } from '@modules/people/user/user.module';
import { ItemModule } from '@modules/inventory/item/item.module';
import { ActivityModule } from '@modules/inventory/activity/activity.module';
import { EventEmitterModule } from '@modules/common/event-emitter/event-emitter.module';
import { FileModule } from '@modules/common/file/file.module';
import { WhatsAppModule } from '@modules/common/whatsapp/whatsapp.module';

// Controllers
import { PpeController } from './ppe.controller';

// Services
import { PpeSizeService } from './ppe-size.service';
import { PpeDeliveryService } from './ppe-delivery.service';
import { PpeDeliveryScheduleService } from './ppe-delivery-schedule.service';
import { PpeDocumentService } from './ppe-document.service';
import { PpeInAppSignatureService } from './ppe-inapp-signature.service';
import { PpePadesSignerService } from './ppe-pades-signer.service';
import { PpeSignatureAuditService } from './ppe-signature-audit.service';

// Listeners
import { PpeListener } from './ppe.listener';

// Repositories
import { PpeSizeRepository } from './repositories/ppe-size/ppe-size.repository';
import { PpeSizePrismaRepository } from './repositories/ppe-size/ppe-size-prisma.repository';
import { PpeDeliveryRepository } from './repositories/ppe-delivery/ppe-delivery.repository';
import { PpeDeliveryPrismaRepository } from './repositories/ppe-delivery/ppe-delivery-prisma.repository';
import { PpeDeliveryScheduleRepository } from './repositories/ppe-delivery-schedule/ppe-delivery-schedule.repository';
import { PpeDeliverySchedulePrismaRepository } from './repositories/ppe-delivery-schedule/ppe-delivery-schedule-prisma.repository';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ChangeLogModule,
    NotificationModule,
    UserModule,
    ItemModule,
    ActivityModule,
    EventEmitterModule,
    FileModule,
    WhatsAppModule,
  ],
  controllers: [PpeController],
  providers: [
    // Services
    PpeSizeService,
    PpeDeliveryService,
    PpeDeliveryScheduleService,
    PpeDocumentService,
    PpeInAppSignatureService,
    PpePadesSignerService,
    PpeSignatureAuditService,
    // Listeners
    PpeListener,
    // Repositories
    {
      provide: PpeSizeRepository,
      useClass: PpeSizePrismaRepository,
    },
    {
      provide: PpeDeliveryRepository,
      useClass: PpeDeliveryPrismaRepository,
    },
    {
      provide: PpeDeliveryScheduleRepository,
      useClass: PpeDeliverySchedulePrismaRepository,
    },
  ],
  exports: [
    PpeSizeService,
    PpeDeliveryService,
    PpeDeliveryScheduleService,
    PpeDocumentService,
    PpeInAppSignatureService,
    PpePadesSignerService,
    PpeSignatureAuditService,
  ],
})
export class PpeModule {}
