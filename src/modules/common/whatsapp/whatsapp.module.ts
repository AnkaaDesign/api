import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventEmitterModule as NestEventEmitterModule } from '@nestjs/event-emitter';
import { BaileysWhatsAppService } from './baileys-whatsapp.service';
import { BaileysAuthStateStore } from './baileys-auth-state.store';
import { WhatsAppController } from './whatsapp.controller';
import { UserRepository } from '@modules/people/user/repositories/user.repository';
import { UserPrismaRepository } from '@modules/people/user/repositories/user-prisma.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '../cache/cache.module';
import { NotificationModule } from '../notification/notification.module';

/**
 * WhatsApp module for managing WhatsApp integration
 * Provides WhatsApp messaging capabilities using Baileys (official multi-device protocol)
 * Includes caching for QR codes and connection status, Redis-backed auth state
 *
 * Benefits over whatsapp-web.js:
 * - No browser/Puppeteer dependency (saves 250MB+ memory)
 * - Eliminates "No LID" errors
 * - Faster startup (2-7s vs 40-70s)
 * - Lower resource usage (50-100MB vs 200-400MB)
 * - Better stability and reconnection handling
 */
@Module({
  imports: [
    PrismaModule,
    CacheModule,
    forwardRef(() => NotificationModule),
    NestEventEmitterModule.forRoot(),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [WhatsAppController],
  providers: [
    BaileysAuthStateStore,
    {
      provide: 'WhatsAppService',
      useClass: BaileysWhatsAppService,
    },
    {
      provide: UserRepository,
      useClass: UserPrismaRepository,
    },
  ],
  exports: ['WhatsAppService', BaileysAuthStateStore],
})
export class WhatsAppModule {}
