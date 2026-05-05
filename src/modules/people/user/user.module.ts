import { Module, forwardRef } from '@nestjs/common';
import { UserService } from './user.service';
import { UserAnalyticsService } from './user-analytics.service';
import { AdministrationAnalyticsService } from './administration-analytics.service';
import { UserController } from './user.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { UserRepository } from './repositories/user.repository';
import { UserPrismaRepository } from './repositories/user-prisma.repository';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { FileModule } from '@modules/common/file/file.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { SecullumModule } from '@modules/integrations/secullum/secullum.module';

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    forwardRef(() => FileModule),
    forwardRef(() => NotificationModule),
    // forwardRef breaks the cycle: SecullumModule imports UserModule, and we
    // import SecullumModule here so UserService can `await` the sync directly
    // and surface its result to the web UI.
    forwardRef(() => SecullumModule),
  ],
  controllers: [UserController],
  providers: [
    UserService,
    UserAnalyticsService,
    AdministrationAnalyticsService,
    {
      provide: UserRepository,
      useClass: UserPrismaRepository,
    },
  ],
  exports: [UserService, UserRepository],
})
export class UserModule {}
