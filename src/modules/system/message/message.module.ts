import { Module } from '@nestjs/common';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';

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
  imports: [PrismaModule],
  controllers: [MessageController],
  providers: [MessageService],
  exports: [MessageService],
})
export class MessageModule {}
