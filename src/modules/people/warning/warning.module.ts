import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WarningController } from './warning.controller';
import { WarningService } from './warning.service';
import { WarningSignatureService } from './warning-signature.service';
import { WarningDocumentService } from './warning-document.service';
import { WarningAutoResolveScheduler } from './warning-auto-resolve.scheduler';
import { WarningRepository } from './repositories/warning.repository';
import { WarningPrismaRepository } from './repositories/warning-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { FileModule } from '@modules/common/file/file.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
// PpeModule exports the entity-agnostic PpePadesSignerService (PAdES seal of an
// arbitrary PDF buffer); reused here instead of duplicating the signer.
import { PpeModule } from '@modules/inventory/ppe/ppe.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ChangeLogModule,
    FileModule,
    NotificationModule,
    PpeModule,
  ],
  controllers: [WarningController],
  providers: [
    WarningService,
    WarningSignatureService,
    WarningDocumentService,
    WarningAutoResolveScheduler,
    {
      provide: WarningRepository,
      useClass: WarningPrismaRepository,
    },
  ],
  exports: [WarningService, WarningRepository, WarningSignatureService],
})
export class WarningModule {}
