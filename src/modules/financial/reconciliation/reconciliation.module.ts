import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { SiegModule } from '@modules/integrations/sieg/sieg.module';
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
  imports: [ConfigModule, PrismaModule, NotificationModule, forwardRef(() => SiegModule)],
  controllers: [ReconciliationController],
  providers: [
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
  ],
})
export class ReconciliationModule {}
