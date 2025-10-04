import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserModule } from '@modules/people/user/user.module';
import { SectorModule } from '@modules/people/sector/sector.module';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { HashModule } from '@modules/common/hash/hash.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { VerificationModule } from '@modules/common/verification/verification.module';
import { SmsModule } from '@modules/common/sms/sms.module';
import { MailerModule } from '@modules/common/mailer/mailer.module';

@Module({
  imports: [
    UserModule,
    SectorModule,
    PrismaModule,
    HashModule,
    ChangeLogModule,
    VerificationModule,
    SmsModule,
    MailerModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: process.env.JWT_EXPIRATION || '7d' },
    }),
  ],
  providers: [
    AuthService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
