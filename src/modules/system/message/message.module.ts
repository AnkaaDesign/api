import { Module } from '@nestjs/common';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';
import { MessageListener } from './message.listener';
import { MessageLifecycleScheduler } from './message-lifecycle.scheduler';
import { MessageScheduleController } from './message-schedule.controller';
import { MessageScheduleService } from './message-schedule.service';
import { MessageScheduleScheduler } from './message-schedule.scheduler';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { NotificationModule } from '@modules/common/notification/notification.module';

/**
 * Message Module
 *
 * Provides message/announcement functionality with:
 * - CRUD operations (admin only)
 * - User targeting (all users, specific users, roles)
 * - Message view tracking
 * - Rich content blocks
 * - Ciclo de vida por janela de exibição (SCHEDULED → ACTIVE → EXPIRED)
 * - Comunicados RECORRENTES: uma regra (`MessageSchedule`) que materializa uma
 *   `Message` filha por período. Ocorrência é mensagem de verdade, então o app
 *   Flutter continua lendo `/messages/*` sem saber que agendamento existe.
 */
@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [MessageController, MessageScheduleController],
  providers: [
    MessageService,
    MessageListener,
    MessageLifecycleScheduler,
    MessageScheduleService,
    MessageScheduleScheduler,
  ],
  exports: [MessageService, MessageScheduleService],
})
export class MessageModule {}
