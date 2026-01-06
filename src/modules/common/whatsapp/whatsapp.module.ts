import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventEmitterModule as NestEventEmitterModule } from '@nestjs/event-emitter';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { UserRepository } from '@modules/people/user/repositories/user.repository';
import { UserPrismaRepository } from '@modules/people/user/repositories/user-prisma.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '../cache/cache.module';

/**
 * WhatsApp module for managing WhatsApp Web integration
 * Provides WhatsApp messaging capabilities using whatsapp-web.js
 * Includes caching for QR codes and connection status
 */
@Module({
  imports: [
    PrismaModule,
    CacheModule,
    NestEventEmitterModule.forRoot(),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    {
      provide: UserRepository,
      useClass: UserPrismaRepository,
    },
  ],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
