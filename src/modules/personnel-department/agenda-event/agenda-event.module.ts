import { Module } from '@nestjs/common';
import { AgendaEventController } from './agenda-event.controller';
import { AgendaEventService } from './agenda-event.service';
import { CalendarNotificationScheduler } from './calendar-notification.scheduler';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { UserModule } from '@modules/people/user/user.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { NotificationTemplateService } from '@modules/common/notification/templates/notification-template.service';

@Module({
  imports: [PrismaModule, ChangeLogModule, UserModule, NotificationModule],
  controllers: [AgendaEventController],
  // NotificationTemplateService é stateless e não é exportado pelo
  // NotificationModule — registrado aqui como provider local.
  providers: [AgendaEventService, CalendarNotificationScheduler, NotificationTemplateService],
  exports: [AgendaEventService],
})
export class AgendaEventModule {}
