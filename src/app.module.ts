import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bull';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MoneyRedactionInterceptor } from './modules/common/interceptors/money-redaction.interceptor';
import { getRedisConfig } from './common/config/redis.config';
import { SchedulerGuardService } from './common/services/scheduler-guard.service';

import {
  SecurityMiddleware,
  SecurityValidationMiddleware,
} from './common/middleware/security.middleware';
import { SecurityModule } from './modules/common/security/security.module';

import { ActivityModule } from './modules/inventory/activity/activity.module';
import { AirbrushingModule } from './modules/production/airbrushing/airbrushing.module';
import { AuthModule } from './modules/common/auth/auth.module';
import { BorrowModule } from './modules/inventory/borrow/borrow.module';
import { CustomerModule } from './modules/production/customer/customer.module';
import { CutModule } from './modules/production/cut/cut.module';
import { DashboardModule } from './modules/domain/dashboard/dashboard.module';
import { SearchModule } from './modules/domain/search/search.module';
import { EconomicActivityModule } from './modules/production/economic-activity/economic-activity.module';
import { PpeModule } from './modules/inventory/ppe/ppe.module';
import { EventEmitterModule } from './modules/common/event-emitter/event-emitter.module';
import { ExternalOperationModule } from './modules/inventory/external-operation/external-operation.module';
import { FileModule } from './modules/common/file/file.module';
import { ItemModule } from './modules/inventory/item/item.module';
import { MailerModule } from './modules/common/mailer/mailer.module';
import { MaintenanceModule } from './modules/inventory/maintenance/maintenance.module';
import { NotificationModule } from './modules/common/notification/notification.module';
import { AttentionModule } from './modules/common/attention/attention.module';
import { OrderModule } from './modules/inventory/order/order.module';
import { PaintModule } from './modules/paint/paint.module';
import { PositionModule } from './modules/people/position/position.module';
import { PreferencesModule } from './modules/people/preferences/preferences.module';
import { StatisticsPreferencesModule } from './modules/people/statistics-preferences/statistics-preferences.module';
import { ResponsibleModule } from './modules/people/responsible/responsible.module';
import { PrismaModule } from './modules/common/prisma/prisma.module';
import { WarningModule } from './modules/people/warning/warning.module';
import { SectorModule } from './modules/people/sector/sector.module';
import { GoalModule } from './modules/people/goal/goal.module';
import { ServiceOrderModule } from './modules/production/service-order/service-order.module';
import { SupplierModule } from './modules/inventory/supplier/supplier.module';
import { WarehouseLocationModule } from './modules/inventory/warehouse-location/warehouse-location.module';
import { FispqModule } from './modules/inventory/fispq/fispq.module';
import { TaskModule } from './modules/production/task/task.module';
import { TaskQuoteModule } from './modules/production/task-quote/task-quote.module';
import { ObservationModule } from './modules/production/task-observation/observation.module';
import { ImplementMeasureModule } from './modules/production/implement-measure/implement-measure.module';
import { LayoutDimensionsModule } from './modules/production/layout-dimensions/layout-dimensions.module';
import { TruckModule } from './modules/production/truck/truck.module';
import { UserModule } from './modules/people/user/user.module';
import { ProfileModule } from './modules/people/profile/profile.module';
import { PersonalModule } from './modules/people/personal/personal.module';
import { TeamStaffModule } from './modules/people/team-staff/team-staff.module';
import { ThrottlerModule } from './modules/common/throttler/throttler.module';
import { SchedulerModule } from './modules/common/scheduler/scheduler.module';
import { SecullumModule } from './modules/integrations/secullum/secullum.module';
import { SecullumSmokeTestModule } from './modules/integrations/secullum/smoke-test/smoke-test.module';
import { ServerModule } from './modules/common/server/server.module';
import { BackupModule } from './modules/common/backup/backup.module';
import { MonitoringModule } from './modules/common/monitoring/monitoring.module';
import { PersonnelDepartmentModule } from './modules/personnel-department/personnel-department.module';
import { DeploymentModule } from './modules/system/deployment/deployment.module';
import { SystemThrottlerModule } from './modules/system/throttler/throttler.module';
import { RepositoryModule } from './modules/system/repository/repository.module';
import { GitCommitModule } from './modules/system/git-commit/git-commit.module';
import { AppsModule } from './modules/system/app/app.module';
import { UpdateModule } from './modules/system/update/update.module';
import { InstallModule } from './modules/system/install/install.module';
import { WhatsAppModule } from './modules/common/whatsapp/whatsapp.module';
import { SignatureModule } from './modules/common/signature/signature.module';
import { SignatureWhatsAppBridgeModule } from './modules/common/signature/signature-whatsapp-bridge.module';
import { MessageModule } from './modules/system/message/message.module';
import { DeepLinkModule } from './modules/common/deep-link/deep-link.module';
import { SicrediModule } from './modules/integrations/sicredi/sicredi.module';
import { NfseModule } from './modules/integrations/nfse/nfse.module';
import { SiegModule } from './modules/integrations/sieg/sieg.module';
import { InvoiceModule } from './modules/financial/invoice/invoice.module';
import { ReconciliationModule } from './modules/financial/reconciliation/reconciliation.module';
import { SkillModule } from './modules/skill/skill.module';
import { QuestionnaireModule } from './modules/questionnaire/questionnaire.module';
import { WasteCertificateModule } from './modules/waste-certificate/waste-certificate.module';
import { PaintingAnalysisModule } from './modules/paint/painting-analysis/painting-analysis.module';
import { PrinterLogModule } from './modules/printer-log/printer-log.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRoot({
      redis: {
        ...getRedisConfig(),
        // Retry strategy to prevent crashes on connection errors
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 500, 2000);
          if (process.env.NODE_ENV !== 'production') {
            console.log(`Redis connection attempt ${times}, retrying in ${delay}ms`);
          }
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
    PersonnelDepartmentModule, // Includes BonusModule and PayrollModule
    BorrowModule,
    CustomerModule,
    CutModule,
    DashboardModule,
    SearchModule,
    EconomicActivityModule,
    PpeModule,
    EventEmitterModule,
    ExternalOperationModule,
    FileModule,
    ItemModule,
    MailerModule,
    MaintenanceModule,
    NotificationModule,
    AttentionModule,
    ObservationModule,
    OrderModule,
    PaintModule,
    PositionModule,
    PreferencesModule,
    StatisticsPreferencesModule,
    ResponsibleModule,
    PrismaModule,
    WarningModule,
    SectorModule,
    GoalModule,
    ServiceOrderModule,
    SupplierModule,
    WarehouseLocationModule,
    FispqModule,
    TaskModule,
    TaskQuoteModule,
    ImplementMeasureModule,
    LayoutDimensionsModule,
    TruckModule,
    UserModule,
    ProfileModule,
    PersonalModule,
    TeamStaffModule,
    SchedulerModule,
    SecullumModule,
    SecullumSmokeTestModule,
    ServerModule,
    BackupModule,
    MonitoringModule,
    DeploymentModule,
    SystemThrottlerModule,
    RepositoryModule,
    GitCommitModule,
    AppsModule,
    UpdateModule,
    InstallModule,
    WhatsAppModule,
    SignatureModule,
    // Registra o transporte de WhatsApp na cerimônia de assinatura sem que
    // SignatureModule precise importar WhatsAppModule — ver o cabeçalho da ponte.
    SignatureWhatsAppBridgeModule,
    MessageModule,
    DeepLinkModule,
    SicrediModule,
    NfseModule,
    SiegModule,
    InvoiceModule,
    ReconciliationModule,
    SkillModule,
    QuestionnaireModule,
    WasteCertificateModule,
    PaintingAnalysisModule,
    PrinterLogModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Desliga os schedulers quando o entrypoint é um script de manutenção — ver
    // o comentário do arquivo. Mora na raiz porque `onApplicationBootstrap` da
    // raiz roda depois do ScheduleExplorer.
    SchedulerGuardService,
    // Global: strips monetary fields from every response for sectors outside
    // MONEY_PRIVILEGES. Registered app-wide on purpose — per-controller opt-in
    // is what let `GET /items` and `GET /users` ship prices and salaries to
    // every sector for as long as they did.
    { provide: APP_INTERCEPTOR, useClass: MoneyRedactionInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply security middleware to all routes
    consumer.apply(SecurityValidationMiddleware, SecurityMiddleware).forRoutes('*');
  }
}
