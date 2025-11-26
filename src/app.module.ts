import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import {
  SecurityMiddleware,
  SecurityValidationMiddleware,
} from './common/middleware/security.middleware';
import { SecurityModule } from './modules/common/security/security.module';

import { ActivityModule } from './modules/inventory/activity/activity.module';
import { AirbrushingModule } from './modules/production/airbrushing/airbrushing.module';
import { AuthModule } from './modules/common/auth/auth.module';
import { BonusModule } from './modules/people/bonus/bonus.module';
import { BorrowModule } from './modules/inventory/borrow/borrow.module';
import { CustomerModule } from './modules/production/customer/customer.module';
import { CutModule } from './modules/production/cut/cut.module';
import { DashboardModule } from './modules/domain/dashboard/dashboard.module';
import { EconomicActivityModule } from './modules/production/economic-activity/economic-activity.module';
import { PpeModule } from './modules/inventory/ppe/ppe.module';
import { EventEmitterModule } from './modules/common/event-emitter/event-emitter.module';
import { ExternalWithdrawalModule } from './modules/inventory/external-withdrawal/external-withdrawal.module';
import { FileModule } from './modules/common/file/file.module';
import { ItemModule } from './modules/inventory/item/item.module';
import { MailerModule } from './modules/common/mailer/mailer.module';
import { MaintenanceModule } from './modules/inventory/maintenance/maintenance.module';
import { NotificationModule } from './modules/common/notification/notification.module';
import { OrderModule } from './modules/inventory/order/order.module';
import { PaintModule } from './modules/paint/paint.module';
import { PositionModule } from './modules/people/position/position.module';
import { PreferencesModule } from './modules/people/preferences/preferences.module';
import { PrismaModule } from './modules/common/prisma/prisma.module';
import { WarningModule } from './modules/people/warning/warning.module';
import { SectorModule } from './modules/people/sector/sector.module';
import { ServiceOrderModule } from './modules/production/service-order/service-order.module';
import { SupplierModule } from './modules/inventory/supplier/supplier.module';
import { TaskModule } from './modules/production/task/task.module';
import { ObservationModule } from './modules/production/task-observation/observation.module';
import { LayoutModule } from './modules/production/layout/layout.module';
import { UserModule } from './modules/people/user/user.module';
import { ProfileModule } from './modules/people/profile/profile.module';
import { VacationModule } from './modules/people/vacation/vacation.module';
import { PersonalModule } from './modules/people/personal/personal.module';
import { ThrottlerModule } from './modules/common/throttler/throttler.module';
import { SchedulerModule } from './modules/common/scheduler/scheduler.module';
import { SecullumModule } from './modules/integrations/secullum/secullum.module';
import { ServerModule } from './modules/common/server/server.module';
import { BackupModule } from './modules/common/backup/backup.module';
import { MonitoringModule } from './modules/common/monitoring/monitoring.module';
import { HumanResourcesModule } from './modules/human-resources/human-resources.module';
import { DeploymentModule } from './modules/system/deployment/deployment.module';
import { SystemThrottlerModule } from './modules/system/throttler/throttler.module';
import { RepositoryModule } from './modules/system/repository/repository.module';
import { GitCommitModule } from './modules/system/git-commit/git-commit.module';
import { AppsModule } from './modules/system/app/app.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
        // Retry strategy to prevent crashes on connection errors
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 500, 2000);
          console.log(`Redis connection attempt ${times}, retrying in ${delay}ms`);
          return delay;
        },
        // Prevent unhandled error events from crashing the app
        lazyConnect: false,
      },
    }),
    SecurityModule,
    AuthModule,
    ThrottlerModule,
    ActivityModule,
    AirbrushingModule,
    BonusModule,
    HumanResourcesModule,
    BorrowModule,
    CustomerModule,
    CutModule,
    DashboardModule,
    EconomicActivityModule,
    PpeModule,
    EventEmitterModule,
    ExternalWithdrawalModule,
    FileModule,
    ItemModule,
    MailerModule,
    MaintenanceModule,
    NotificationModule,
    ObservationModule,
    OrderModule,
    PaintModule,
    PositionModule,
    PreferencesModule,
    PrismaModule,
    WarningModule,
    SectorModule,
    ServiceOrderModule,
    SupplierModule,
    TaskModule,
    LayoutModule,
    UserModule,
    ProfileModule,
    VacationModule,
    PersonalModule,
    SchedulerModule,
    SecullumModule,
    ServerModule,
    BackupModule,
    MonitoringModule,
    DeploymentModule,
    SystemThrottlerModule,
    RepositoryModule,
    GitCommitModule,
    AppsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply security middleware to all routes
    consumer.apply(SecurityValidationMiddleware, SecurityMiddleware).forRoutes('*');
  }
}
