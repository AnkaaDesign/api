import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { TaskPricingModule } from '@modules/production/task-pricing/task-pricing.module';
import { SicrediAuthService } from './sicredi-auth.service';
import { SicrediService } from './sicredi.service';
import { SicrediWebhookController } from './sicredi-webhook.controller';
import { SicrediWebhookService } from './sicredi-webhook.service';
import { SicrediBoletoScheduler } from './sicredi-boleto.scheduler';

@Module({
  imports: [PrismaModule, NotificationModule, forwardRef(() => TaskPricingModule)],
  controllers: [SicrediWebhookController],
  providers: [SicrediAuthService, SicrediService, SicrediWebhookService, SicrediBoletoScheduler],
  exports: [SicrediService, SicrediAuthService, SicrediWebhookService],
})
export class SicrediModule {}
