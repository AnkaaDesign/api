import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { PushService } from './push.service';
import { PushController } from './push.controller';
import { ExpoPushService } from './expo-push.service';
import { DeepLinkService } from '../notification/deep-link.service';
import { UserRepository } from '@modules/people/user/repositories/user.repository';
import { UserPrismaRepository } from '@modules/people/user/repositories/user-prisma.repository';
import { FirebaseConfigService } from '../notification/push/firebase-config.service';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  providers: [
    FirebaseConfigService,
    ExpoPushService,
    PushService,
    DeepLinkService,
    {
      provide: UserRepository,
      useClass: UserPrismaRepository,
    },
  ],
  controllers: [PushController],
  exports: [PushService, ExpoPushService, FirebaseConfigService],
})
export class PushModule {}
