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
  ],
  exports: [
    ReconciliationService,
    ReconciliationMatcherService,
    ReconciliationAliasService,
    ReconciliationClassifierService,
    TransactionCategoryService,
    ItemCategoryClassifierService,
  ],
})
export class ReconciliationModule {}
