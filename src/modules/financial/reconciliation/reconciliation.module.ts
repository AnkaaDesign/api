import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
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

@Module({
  imports: [ConfigModule, PrismaModule, forwardRef(() => SiegModule)],
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
  ],
  exports: [ReconciliationService, ReconciliationMatcherService, ReconciliationAliasService],
})
export class ReconciliationModule {}
