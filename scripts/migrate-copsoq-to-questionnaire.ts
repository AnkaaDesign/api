/**
 * Migrates COPSOQ-II data from the Assessment/Skill framework to the Questionnaire framework.
 *
 * Steps:
 *   1. Load COPSOQ-II Skills + Topics + TopicLevels from DB
 *   2. Create QuestionnaireGroups from Skills
 *   3. Create QuestionnaireQuestions + QuestionnaireOptions from Topics + TopicLevels
 *   4. Create Questionnaire (CLOSED) from the COPSOQ Assessment
 *   5. Create QuestionnaireEntries + QuestionnaireAnswers from AssessmentEntries + AssessmentResponses
 *   6. Delete Assessment data (entries cascade responses; assessment cascades skill/topic links)
 *   7. Soft-delete COPSOQ Skills and Topics
 *
 * Idempotent: checks before creating to avoid duplicates.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-copsoq-to-questionnaire.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ASSESSMENT_NAME = 'COPSOQ-II — Avaliação Psicossocial 2026';
const QUESTIONNAIRE_NAME = 'COPSOQ-II — Avaliação Psicossocial 2026';

async function main() {
  // ── 1. Load COPSOQ Skills + Topics + TopicLevels ────────────────────────────
  const copsoqSkills = await prisma.skill.findMany({
    where: { name: { startsWith: 'COPSOQ-II' } },
    include: {
      topics: {
        include: { levels: { orderBy: { score: 'asc' } } },
        orderBy: { order: 'asc' },
      },
    },
    orderBy: { order: 'asc' },
  });

  if (!copsoqSkills.length) {
    throw new Error('COPSOQ-II skills not found — run seed-copsoq-ii.ts first');
  }
  console.log(`[migrate] Loaded ${copsoqSkills.length} COPSOQ-II skills`);

  // ── 2. Load Assessment + Entries + Responses ────────────────────────────────
  const assessment = await prisma.assessment.findFirst({
    where: { name: ASSESSMENT_NAME },
    include: {
      entries: {
        include: { responses: true },
      },
    },
  });

  if (!assessment) {
    throw new Error(`Assessment "${ASSESSMENT_NAME}" not found — run seed-copsoq-assessment.ts first`);
  }
  console.log(`[migrate] Loaded assessment "${assessment.name}" (${assessment.entries.length} entries)`);

  // ── 3. Create QuestionnaireGroups from Skills ────────────────────────────────
  const groupBySkillId = new Map<string, string>(); // skillId → groupId

  for (const skill of copsoqSkills) {
    let group = await prisma.questionnaireGroup.findFirst({
      where: { name: skill.name },
    });

    if (!group) {
      // Normalize orders: skills are 4,5,6 → groups 1,2,3
      group = await prisma.questionnaireGroup.create({
        data: {
          name: skill.name,
          description: skill.description ?? null,
          order: skill.order - 3,
          isActive: true,
        },
      });
      console.log(`[migrate] Created group: ${group.name}`);
    } else {
      console.log(`[migrate] Group already exists: ${group.name}`);
    }

    groupBySkillId.set(skill.id, group.id);
  }

  // ── 4. Create QuestionnaireQuestions + Options from Topics + TopicLevels ────
  const questionByTopicId = new Map<string, string>(); // topicId → questionId
  let questionCount = 0;

  for (const skill of copsoqSkills) {
    const groupId = groupBySkillId.get(skill.id)!;

    for (const topic of skill.topics) {
      let question = await prisma.questionnaireQuestion.findFirst({
        where: { groupId, order: topic.order },
      });

      if (!question) {
        question = await prisma.$transaction(async tx => {
          const created = await tx.questionnaireQuestion.create({
            data: {
              groupId,
              order: topic.order,
              title: topic.title,
              description: topic.description,
              helpText: topic.counterBehaviors ?? null,
              isActive: true,
            },
          });

          if (topic.levels.length) {
            await tx.questionnaireOption.createMany({
              data: topic.levels.map((lvl, idx) => ({
                questionId: created.id,
                order: idx,
                value: lvl.score,
                label: lvl.name,
                description: lvl.description ?? null,
              })),
            });
          }

          return created;
        });
        questionCount++;
      }

      questionByTopicId.set(topic.id, question.id);
    }
  }
  console.log(`[migrate] Created ${questionCount} questions (${questionByTopicId.size} total mapped)`);

  // ── 5. Create Questionnaire (CLOSED) from Assessment ─────────────────────────
  let questionnaire = await prisma.questionnaire.findFirst({
    where: { name: QUESTIONNAIRE_NAME },
  });

  if (!questionnaire) {
    questionnaire = await prisma.questionnaire.create({
      data: {
        name: QUESTIONNAIRE_NAME,
        description: assessment.description ?? null,
        periodStart: assessment.periodStart,
        periodEnd: assessment.periodEnd,
        status: 'CLOSED',
        createdById: assessment.createdById,
        targetAllUsers: false,
        isAnonymous: false,
        questions: {
          create: Array.from(questionByTopicId.values()).map(questionId => ({ questionId })),
        },
      },
    });
    console.log(`[migrate] Created questionnaire: ${questionnaire.id}`);
  } else {
    console.log(`[migrate] Questionnaire already exists: ${questionnaire.id}`);
  }

  // ── 6. Create QuestionnaireEntries + QuestionnaireAnswers ────────────────────
  let entryCreated = 0;
  let answerCreated = 0;
  let entrySkipped = 0;

  for (const assessmentEntry of assessment.entries) {
    let entry = await prisma.questionnaireEntry.findFirst({
      where: { questionnaireId: questionnaire.id, respondentId: assessmentEntry.evaluateeId },
    });

    if (!entry) {
      entry = await prisma.questionnaireEntry.create({
        data: {
          questionnaireId: questionnaire.id,
          respondentId: assessmentEntry.evaluateeId,
          status: 'SUBMITTED',
          startedAt: assessmentEntry.startedAt,
          submittedAt: assessmentEntry.submittedAt,
        },
      });
      entryCreated++;
    } else {
      entrySkipped++;
    }

    for (const response of assessmentEntry.responses) {
      const questionId = questionByTopicId.get(response.topicId);
      if (!questionId) {
        console.warn(`  [warn] No question mapped for topicId ${response.topicId}, skipping`);
        continue;
      }

      await prisma.questionnaireAnswer.upsert({
        where: { entryId_questionId: { entryId: entry.id, questionId } },
        update: { value: response.score },
        create: { entryId: entry.id, questionId, value: response.score },
      });
      answerCreated++;
    }
  }

  console.log(
    `[migrate] Entries: ${entryCreated} created, ${entrySkipped} already existed. Answers upserted: ${answerCreated}`,
  );

  // ── 7. Cleanup — delete AssessmentEntries (cascades AssessmentResponses) ─────
  const deletedEntries = await prisma.assessmentEntry.deleteMany({
    where: { assessmentId: assessment.id },
  });
  console.log(`[migrate] Deleted ${deletedEntries.count} assessment entries (responses cascade-deleted)`);

  // Delete Assessment (cascades AssessmentSectors, AssessmentSkills, AssessmentTopics)
  await prisma.assessment.delete({ where: { id: assessment.id } });
  console.log(`[migrate] Assessment deleted`);

  // ── 8. Soft-delete COPSOQ Skills and Topics ───────────────────────────────────
  const now = new Date();
  for (const skill of copsoqSkills) {
    await prisma.topic.updateMany({
      where: { skillId: skill.id },
      data: { deletedAt: now, isActive: false },
    });
    await prisma.skill.update({
      where: { id: skill.id },
      data: { deletedAt: now, isActive: false },
    });
    console.log(`[migrate] Soft-deleted skill: ${skill.name}`);
  }

  console.log('\n[migrate] Done. COPSOQ-II data migrated to questionnaire framework.');
}

main()
  .catch(err => {
    console.error('[migrate] FAILED:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
