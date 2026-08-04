import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { FilesStorageModule } from '@modules/common/file/services/files-storage.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { TaskQuoteModule } from '@modules/production/task-quote/task-quote.module';
import { SicrediAuthService } from './sicredi-auth.service';
import { SicrediService } from './sicredi.service';
import { SicrediWebhookController } from './sicredi-webhook.controller';
import { SicrediWebhookService } from './sicredi-webhook.service';
import { SicrediBoletoScheduler } from './sicredi-boleto.scheduler';

@Module({
  imports: [
    // Caminho canonico dos arquivos gravados por este modulo (antes iam para
    // process.cwd()/uploads, fora do FILES_ROOT e fora do backup).
    FilesStorageModule,PrismaModule, NotificationModule, forwardRef(() => TaskQuoteModule)],
  controllers: [SicrediWebhookController],
  providers: [SicrediAuthService, SicrediService, SicrediWebhookService, SicrediBoletoScheduler],
  exports: [SicrediService, SicrediAuthService, SicrediWebhookService, SicrediBoletoScheduler],
})
export class SicrediModule {}
