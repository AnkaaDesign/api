import { Module } from '@nestjs/common';
import { ResponsibleController } from './responsible.controller';
import { ResponsibleService } from './responsible.service';
import { ResponsibleRepository } from './repositories/responsible.repository';
import { ResponsiblePrismaRepository } from './repositories/responsible-prisma.repository';
import { HashModule } from '@/modules/common/hash/hash.module';
import { ChangeLogModule } from '@/modules/common/changelog/changelog.module';
import { PrismaModule } from '@/modules/common/prisma/prisma.module';
import { UserModule } from '../user/user.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    PrismaModule,
    HashModule,
    ChangeLogModule,
    UserModule, // Import UserModule to provide UserRepository for AuthGuard
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRATION') || '7d',
        },
      }),
    }),
  ],
  controllers: [ResponsibleController],
  providers: [
    ResponsibleService,
    {
      provide: ResponsibleRepository,
      useClass: ResponsiblePrismaRepository,
    },
  ],
  exports: [ResponsibleService, ResponsibleRepository],
})
export class ResponsibleModule {}
