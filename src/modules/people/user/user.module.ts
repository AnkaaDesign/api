import { Module, forwardRef } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { UserRepository } from './repositories/user.repository';
import { UserPrismaRepository } from './repositories/user-prisma.repository';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { FileModule } from '@modules/common/file/file.module';
import { NotificationModule } from '@modules/common/notification/notification.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, forwardRef(() => FileModule), forwardRef(() => NotificationModule)],
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
