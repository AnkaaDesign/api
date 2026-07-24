import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UserModule } from '@modules/people/user/user.module';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { AttentionGateway } from './attention.gateway';
import { AttentionService } from './attention.service';
import { AttentionAckService } from './attention-ack.service';
import { AttentionController } from './attention.controller';

/**
 * Attention system module — isolated real-time channel for presence ("is-editing")
 * and manual/pushed attention warnings. Independent of NotificationModule so it can
 * never affect notification delivery.
 */
@Module({
  imports: [
    PrismaModule,
    forwardRef(() => UserModule),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AttentionController],
  providers: [AttentionGateway, AttentionService, AttentionAckService],
  exports: [AttentionService, AttentionGateway, AttentionAckService],
})
export class AttentionModule {}
