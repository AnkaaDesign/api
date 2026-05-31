import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { SkillModule } from '@modules/skill/skill.module';
import { QuestionnaireController } from './questionnaire.controller';
import { QuestionnaireService } from './questionnaire.service';
import { CampaignReminderScheduler } from './campaign-reminder.scheduler';

@Module({
  imports: [PrismaModule, NotificationModule, SkillModule],
  controllers: [QuestionnaireController],
  providers: [QuestionnaireService, CampaignReminderScheduler],
  exports: [QuestionnaireService],
})
export class QuestionnaireModule {}
