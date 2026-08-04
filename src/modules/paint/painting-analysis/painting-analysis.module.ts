import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { FileModule } from '@modules/common/file/file.module';
import { PaintingAnalysisController } from './painting-analysis.controller';
import { PaintingAnalysisService } from './painting-analysis.service';
import { PaintingComputeService } from './painting-compute.service';
import { PaintingConfigService } from './painting-config.service';
import { PaintingEngineRunnerService } from './engine-runner.service';

@Module({
  imports: [PrismaModule, FileModule],
  controllers: [PaintingAnalysisController],
  providers: [
    PaintingAnalysisService,
    PaintingComputeService,
    PaintingConfigService,
    PaintingEngineRunnerService,
  ],
  exports: [PaintingAnalysisService, PaintingComputeService],
})
export class PaintingAnalysisModule {}
