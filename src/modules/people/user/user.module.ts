import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { UserRepository } from './repositories/user.repository';
import { UserPrismaRepository } from './repositories/user-prisma.repository';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [UserController],
  providers: [
    UserService,
    {
      provide: UserRepository,
      useClass: UserPrismaRepository,
    },
  ],
  exports: [UserService, UserRepository],
})
export class UserModule {}
