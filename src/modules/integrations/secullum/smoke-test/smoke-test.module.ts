import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { SecullumModule } from '../secullum.module';
import { SecullumSmokeTestService } from './smoke-test.service';
import { SecullumSmokeTestScheduler } from './smoke-test.scheduler';
import { SecullumSmokeTestController } from './smoke-test.controller';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, forwardRef(() => NotificationModule), forwardRef(() => SecullumModule)],
  controllers: [SecullumSmokeTestController],
  providers: [SecullumSmokeTestService, SecullumSmokeTestScheduler],
  exports: [SecullumSmokeTestService, SecullumSmokeTestScheduler],
})
export class SecullumSmokeTestModule {}
