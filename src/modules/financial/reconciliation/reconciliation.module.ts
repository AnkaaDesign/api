import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { SiegModule } from '@modules/integrations/sieg/sieg.module';
import { PayrollModule } from '@modules/human-resources/payroll/payroll.module';
import { ThirteenthModule } from '@modules/human-resources/thirteenth/thirteenth.module';
import { VacationModule } from '@modules/human-resources/vacation/vacation.module';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationImportService } from './reconciliation-import.service';
import { ReconciliationMatcherService } from './reconciliation-matcher.service';
import { ReconciliationStatisticsService } from './reconciliation-statistics.service';
import { ReconciliationScheduler } from './reconciliation.scheduler';
import { OfxParserService } from './ofx-parser.service';
import { ManualXmlImportService } from './manual-xml-import.service';
import { ReconciliationAliasService } from './reconciliation-alias.service';
import { ReconciliationClassifierService } from './reconciliation-classifier.service';
import { TransactionCategoryService } from './transaction-category.service';
import { ItemCategoryClassifierService } from './item-category-classifier.service';
import { ItemCategoryAliasService } from './item-category-alias.service';
import { ItemCategoryMirrorListener } from './item-category-mirror.listener';
import { CounterpartyLearningService } from './counterparty-learning.service';
import { MemoCategoryLearnerService } from './memo-category-learner.service';
import { FiscalDerivedLearnerService } from './fiscal-derived-learner.service';
import { RecurrenceLearnerService } from './recurrence-learner.service';
import { LadderLearner } from './learning/ladder.learner';
import { CategoryFusionService } from './learning/category-fusion.service';
import { OutflowForecastService } from './outflow-forecast.service';
import { PayablesService } from './payables.service';
import { PayablesController } from './payables.controller';
import { RecurrentPayableService } from '../recurrent-payable/recurrent-payable.service';
import { RecurrentPayableScheduler } from '../recurrent-payable/recurrent-payable.scheduler';
import { RecurrentPayableController } from '../recurrent-payable/recurrent-payable.controller';
import { ReceivablesService } from './receivables.service';
import { ReceivablesController } from './receivables.controller';
import { ReceivableMatchService } from './receivable-match.service';
import { PayableMatchService } from './payable-match.service';
import { OrderModule } from '@modules/inventory/order/order.module';
import { TaskQuoteModule } from '@modules/production/task-quote/task-quote.module';
import { CATEGORY_LEARNERS } from './learning/category-signal';

// Order matters only for display tie-breaks; fusion is order-independent. The
// ladder (day-one fallback) is listed first so behavior is identical before any
// learning accumulates.
const categoryLearnersProvider = {
  provide: CATEGORY_LEARNERS,
  useFactory: (
    ladder: LadderLearner,
    counterparty: CounterpartyLearningService,
    memo: MemoCategoryLearnerService,
    fiscal: FiscalDerivedLearnerService,
  ) => [ladder, counterparty, memo, fiscal],
  inject: [
    LadderLearner,
    CounterpartyLearningService,
    MemoCategoryLearnerService,
    FiscalDerivedLearnerService,
  ],
};

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    NotificationModule,
    forwardRef(() => SiegModule),
    // Payroll aggregate for the "Previsão de Saídas" composite (folha com
    // bonificação). One-directional: nothing payroll-side imports this module.
    PayrollModule,
    // 13º + férias: consumed READ-ONLY via getForecastProjection() for the
    // scheduled-payroll section (13º em Nov/Dez + recibos de férias). One-
    // directional: neither HR module imports this one.
    ThirteenthModule,
    VacationModule,
    // Orders + airbrushing + schedules payables, composed into the unified
    // Contas a Pagar by PayablesService. financial → inventory direction.
    OrderModule,
    // Task-quote status cascade — reused by ReceivableMatchService to flip
    // Installment → Invoice → TaskQuote when an inflow is conciliated (same
    // cascade the Sicredi webhook runs for boletos).
    TaskQuoteModule,
  ],
  controllers: [
    ReconciliationController,
    PayablesController,
    RecurrentPayableController,
    ReceivablesController,
  ],
  providers: [
    PayablesService,
    RecurrentPayableService,
    RecurrentPayableScheduler,
    ReceivablesService,
    ReceivableMatchService,
    PayableMatchService,
    ReconciliationService,
    ReconciliationImportService,
    ReconciliationMatcherService,
    ReconciliationStatisticsService,
    ReconciliationScheduler,
    OfxParserService,
    ManualXmlImportService,
    ReconciliationAliasService,
    ReconciliationClassifierService,
    TransactionCategoryService,
    ItemCategoryClassifierService,
    ItemCategoryAliasService,
    ItemCategoryMirrorListener,
    CounterpartyLearningService,
    MemoCategoryLearnerService,
    FiscalDerivedLearnerService,
    RecurrenceLearnerService,
    LadderLearner,
    CategoryFusionService,
    OutflowForecastService,
    categoryLearnersProvider,
  ],
  exports: [
    ReconciliationService,
    ReconciliationMatcherService,
    ReconciliationAliasService,
    ReconciliationClassifierService,
    TransactionCategoryService,
    ItemCategoryClassifierService,
    CounterpartyLearningService,
    MemoCategoryLearnerService,
    FiscalDerivedLearnerService,
    RecurrenceLearnerService,
    CategoryFusionService,
    RecurrentPayableService,
  ],
})
export class ReconciliationModule {}
