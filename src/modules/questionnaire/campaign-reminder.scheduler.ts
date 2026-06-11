import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { QuestionnaireService } from './questionnaire.service';
import { SkillService } from '@modules/skill/skill.service';

/**
 * CampaignReminderScheduler
 *
 * Daily cron that, for both questionnaire and skill-assessment campaigns:
 *  (a) AUTO-CLOSES campaigns whose periodEnd has passed while still OPEN, by
 *      routing through the existing close methods so the canonical
 *      questionnaire.closed / assessment.closed notifications fire (and any
 *      other side effects in those methods are preserved).
 *  (b) Sends REMINDERS (questionnaire.reminder / assessment.reminder) to the
 *      respondents / evaluators that still have PENDING or IN_PROGRESS entries
 *      on campaigns that are still OPEN (and not yet past periodEnd).
 *
 * Everything is additive and fully guarded: a notification or close failure on
 * one campaign never aborts the rest of the run.
 *
 * Config keys emitted:
 *  - questionnaire.closed     (existing, via QuestionnaireService.closeQuestionnaire)
 *  - assessment.closed        (NEW, via SkillService.closeAssessment)
 *  - questionnaire.reminder   (NEW)
 *  - assessment.reminder      (NEW)
 *
 * TODO: the reminder cadence is "every day while pending"; if the product wants
 *       a gentler cadence (e.g. only N days before periodEnd) tune the where
 *       clause / add a lastRemindedAt column.
 */
@Injectable()
export class CampaignReminderScheduler {
  private readonly logger = new Logger(CampaignReminderScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
    private readonly questionnaireService: QuestionnaireService,
    private readonly skillService: SkillService,
  ) {}

  /**
   * Runs daily at 08:00 (America/Sao_Paulo). Auto-close first (so closed
   * campaigns are excluded from the reminder pass), then reminders.
   */
  @Cron('0 8 * * *', { timeZone: 'America/Sao_Paulo' })
  async handleDailyCampaignMaintenance(): Promise<void> {
    this.logger.log('Running daily campaign maintenance (auto-close + reminders)...');
    try {
      await this.autoCloseExpiredQuestionnaires();
    } catch (error) {
      this.logger.error('Error auto-closing expired questionnaires:', error);
    }
    try {
      await this.autoCloseExpiredAssessments();
    } catch (error) {
      this.logger.error('Error auto-closing expired assessments:', error);
    }
    try {
      await this.sendQuestionnaireReminders();
    } catch (error) {
      this.logger.error('Error sending questionnaire reminders:', error);
    }
    try {
      await this.sendAssessmentReminders();
    } catch (error) {
      this.logger.error('Error sending assessment reminders:', error);
    }
    this.logger.log('Daily campaign maintenance finished.');
  }

  // -------------------------------------------------------------------------
  // (a) AUTO-CLOSE
  // -------------------------------------------------------------------------

  private async autoCloseExpiredQuestionnaires(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.questionnaire.findMany({
      where: { status: 'OPEN', deletedAt: null, periodEnd: { lt: now } },
      select: { id: true, name: true },
    });

    if (expired.length === 0) return;
    this.logger.log(`Auto-closing ${expired.length} expired questionnaire campaign(s).`);

    for (const q of expired) {
      try {
        // Route through the existing close method so questionnaire.closed fires.
        await this.questionnaireService.closeQuestionnaire(q.id);
      } catch (error) {
        this.logger.error(`Failed to auto-close questionnaire ${q.id}:`, error);
      }
    }
  }

  private async autoCloseExpiredAssessments(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.assessment.findMany({
      where: { status: 'OPEN', deletedAt: null, periodEnd: { lt: now } },
      select: { id: true, name: true },
    });

    if (expired.length === 0) return;
    this.logger.log(`Auto-closing ${expired.length} expired assessment campaign(s).`);

    for (const a of expired) {
      try {
        // Route through the existing close method so assessment.closed fires.
        await this.skillService.closeAssessment(a.id);
      } catch (error) {
        this.logger.error(`Failed to auto-close assessment ${a.id}:`, error);
      }
    }
  }

  // -------------------------------------------------------------------------
  // (b) REMINDERS
  // -------------------------------------------------------------------------

  private async sendQuestionnaireReminders(): Promise<void> {
    const now = new Date();
    // Only still-OPEN campaigns that have not yet reached periodEnd (expired
    // ones were closed above).
    const open = await this.prisma.questionnaire.findMany({
      where: { status: 'OPEN', deletedAt: null, periodEnd: { gte: now } },
      select: { id: true, name: true },
    });

    for (const q of open) {
      try {
        const pendingEntries = await this.prisma.questionnaireEntry.findMany({
          where: {
            questionnaireId: q.id,
            deletedAt: null,
            status: { in: ['PENDING', 'IN_PROGRESS'] },
          },
          select: { respondentId: true },
        });

        const respondentIds = [...new Set(pendingEntries.map(e => e.respondentId))];
        if (respondentIds.length === 0) continue;

        await this.dispatchService.dispatchByConfigurationToUsers(
          'questionnaire.reminder',
          'system',
          {
            entityType: 'Questionnaire',
            entityId: q.id,
            action: 'reminder',
            data: { questionnaireName: q.name },
            overrides: {
              title: 'Questionário Pendente',
              body: `Você ainda não concluiu o questionário "${q.name}". Por favor, responda antes do encerramento da campanha.`,
              // Respondent-facing list ("meus questionários"); the fill route is
              // keyed by entryId, not campaign id, so we link to the list.
              webUrl: `/pessoal/questionarios`,
              relatedEntityType: 'QUESTIONNAIRE',
            },
          },
          respondentIds,
        );
        this.logger.log(
          `Sent questionnaire.reminder to ${respondentIds.length} respondent(s) for ${q.id}.`,
        );
      } catch (error) {
        this.logger.error(`Failed to send questionnaire reminders for ${q.id}:`, error);
      }
    }
  }

  private async sendAssessmentReminders(): Promise<void> {
    const now = new Date();
    const open = await this.prisma.assessment.findMany({
      where: { status: 'OPEN', deletedAt: null, periodEnd: { gte: now } },
      select: { id: true, name: true },
    });

    for (const a of open) {
      try {
        const pendingEntries = await this.prisma.assessmentEntry.findMany({
          where: {
            assessmentId: a.id,
            deletedAt: null,
            status: { in: ['PENDING', 'IN_PROGRESS'] },
          },
          select: { evaluatorId: true },
        });

        // Remind the EVALUATORS (the leaders who must fill the entries), not the
        // evaluatees.
        const evaluatorIds = [...new Set(pendingEntries.map(e => e.evaluatorId))];
        if (evaluatorIds.length === 0) continue;

        await this.dispatchService.dispatchByConfigurationToUsers(
          'assessment.reminder',
          'system',
          {
            entityType: 'Assessment',
            entityId: a.id,
            action: 'reminder',
            data: { assessmentName: a.name },
            overrides: {
              title: 'Avaliação Pendente',
              body: `Você possui fichas pendentes na avaliação "${a.name}". Por favor, conclua antes do encerramento da campanha.`,
              // Evaluator-facing pending-assessments page (the /producao/
              // avaliacao-competencias route is not mounted on web).
              webUrl: `/meu-pessoal/avaliacoes-competencias`,
              relatedEntityType: 'ASSESSMENT',
            },
          },
          evaluatorIds,
        );
        this.logger.log(
          `Sent assessment.reminder to ${evaluatorIds.length} evaluator(s) for ${a.id}.`,
        );
      } catch (error) {
        this.logger.error(`Failed to send assessment reminders for ${a.id}:`, error);
      }
    }
  }
}
