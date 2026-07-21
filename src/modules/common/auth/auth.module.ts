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
      // Access tokens are now short-lived and backed by refresh tokens. AuthService
      // signs each access token with an explicit expiresIn (JWT_ACCESS_EXPIRATION,
      // default 1h), so this module default only applies to any stray signAsync
      // call without options. The old JWT_EXPIRATION ("7d"/"365d") is no longer the
      // access-token lifetime.
      signOptions: { expiresIn: process.env.JWT_ACCESS_EXPIRATION || '1h' },
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
