import { Module } from '@nestjs/common';
import { RepresentativeController } from './representative.controller';
import { RepresentativeService } from './representative.service';
import { RepresentativeRepository } from './repositories/representative.repository';
import { RepresentativePrismaRepository } from './repositories/representative-prisma.repository';
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
  controllers: [RepresentativeController],
  providers: [
    RepresentativeService,
    {
      provide: RepresentativeRepository,
      useClass: RepresentativePrismaRepository,
    },
  ],
  exports: [RepresentativeService, RepresentativeRepository],
})
export class RepresentativeModule {}
