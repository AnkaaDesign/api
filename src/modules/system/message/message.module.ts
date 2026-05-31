import { Module } from '@nestjs/common';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';
import { MessageListener } from './message.listener';
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
 */
@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [MessageController],
  providers: [MessageService, MessageListener],
  exports: [MessageService],
})
export class MessageModule {}
