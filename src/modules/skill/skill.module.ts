import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { SkillController } from './skill.controller';
import { SkillService } from './skill.service';
import { SkillSeedService } from './skill-seed.service';

/**
 * Skill-Assessment module.
 *
 * Exposes Skill / Topic / Assessment / AssessmentEntry CRUD + lifecycle +
 * analytics under their respective REST prefixes (the controller registers
 * each prefix individually since it owns multiple resources).
 *
 * `SkillSeedService.onModuleInit` populates the 3 Skills + 17 Topics + 102
 * TopicLevels from /tmp/skill_matrix_extracted.json on boot. The seed is
 * idempotent (upserts by unique fields) so re-runs are safe.
 *
 * Registered in api/src/app.module.ts via `SkillModule`.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SkillController],
  providers: [SkillService, SkillSeedService],
  exports: [SkillService],
})
export class SkillModule {}
