import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { SkillController } from './skill.controller';
import { SkillService } from './skill.service';

@Module({
  imports: [PrismaModule],
  controllers: [SkillController],
  providers: [SkillService],
  exports: [SkillService],
})
export class SkillModule {}
