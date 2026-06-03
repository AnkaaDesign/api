/**
 * Seeds COPSOQ-II psychosocial questionnaire as Skills / Topics / TopicLevels.
 *
 * 3 Skills (main groups):
 *   1. Exigências do Trabalho          (Q1–Q6)
 *   2. Organização e Relações no Trabalho (Q7–Q27)
 *   3. Bem-estar e Saúde Psicossocial  (Q28–Q41)
 *
 * In this system score 5=best / 0=worst always.
 * Neg-polarity questions are rephrased so high score = good outcome.
 * Neg-pinned questions (Q38–41) should always receive score 5 in assessments.
 *
 * Idempotent: upserts by Skill.name, Topic[skillId,order], TopicLevel[topicId,score].
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/seed-copsoq-ii.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SourceLevel {
  score: number;
  name: string;
  description: string;
}

interface SourceTopic {
  title: string;
  copsoq_q: number;
  polarity: string;
  description: string;
  counter_behaviors: string;
  levels: SourceLevel[];
}

type SourceData = Record<string, SourceTopic[]>;

interface SkillMapping {
  name: string;
  description: string;
  order: number;
  sheetKey: string;
}

const SKILL_MAPPINGS: SkillMapping[] = [
  {
    name: 'COPSOQ-II — Exigências do Trabalho',
    description:
      'Avalia as demandas quantitativas, cognitivas e emocionais impostas ao colaborador no exercício de suas funções. Score 5 = exigências sempre bem dimensionadas; Score 0 = sobrecarga crônica.',
    order: 4,
    sheetKey: 'Exigências do Trabalho',
  },
  {
    name: 'COPSOQ-II — Organização e Relações no Trabalho',
    description:
      'Avalia autonomia, comunicação, liderança, reconhecimento, clima de equipe, significado e satisfação com o trabalho. Score 5 = condições excelentes; Score 0 = condições críticas.',
    order: 5,
    sheetKey: 'Organização e Relações no Trabalho',
  },
  {
    name: 'COPSOQ-II — Bem-estar e Saúde Psicossocial',
    description:
      'Avalia bem-estar, saúde autorrelatada, equilíbrio trabalho-vida, exaustão, estados emocionais e ausência de comportamentos ofensivos. Score 5 = bem-estar pleno; Score 0 = adoecimento crítico.',
    order: 6,
    sheetKey: 'Bem-estar e Saúde Psicossocial',
  },
];

const ORDER_PREFIX_RE = /^\s*(\d+)\s*\.\s*/;

function parseOrder(title: string, fallback: number): number {
  const match = title.match(ORDER_PREFIX_RE);
  return match ? parseInt(match[1], 10) : fallback;
}

const DATA_PATH = path.resolve(__dirname, 'data', 'copsoq-ii.json');

async function main() {
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`COPSOQ-II data not found at ${DATA_PATH}`);
  }

  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  const source = JSON.parse(raw) as SourceData;

  let skillCount = 0;
  let topicCount = 0;
  let levelCount = 0;

  for (const mapping of SKILL_MAPPINGS) {
    const sourceTopics = source[mapping.sheetKey];
    if (!sourceTopics?.length) {
      console.warn(
        `[seed-copsoq-ii] Skipping "${mapping.name}": key "${mapping.sheetKey}" missing or empty.`,
      );
      continue;
    }

    const skill = await prisma.skill.upsert({
      where: { name: mapping.name },
      update: {
        description: mapping.description,
        order: mapping.order,
        isActive: true,
        deletedAt: null,
      },
      create: {
        name: mapping.name,
        description: mapping.description,
        order: mapping.order,
        isActive: true,
      },
    });
    skillCount += 1;
    console.log(`[seed-copsoq-ii] Skill: ${skill.name}`);

    for (let i = 0; i < sourceTopics.length; i++) {
      const src = sourceTopics[i];
      const order = parseOrder(src.title, i + 1);

      const topic = await prisma.topic.upsert({
        where: { skillId_order: { skillId: skill.id, order } },
        update: {
          title: src.title,
          description: src.description,
          counterBehaviors: src.counter_behaviors,
          isActive: true,
          deletedAt: null,
        },
        create: {
          skillId: skill.id,
          order,
          title: src.title,
          description: src.description,
          counterBehaviors: src.counter_behaviors,
          isActive: true,
        },
      });
      topicCount += 1;

      for (const lvl of src.levels) {
        await prisma.topicLevel.upsert({
          where: { topicId_score: { topicId: topic.id, score: lvl.score } },
          update: { name: lvl.name, description: lvl.description },
          create: {
            topicId: topic.id,
            score: lvl.score,
            name: lvl.name,
            description: lvl.description,
          },
        });
        levelCount += 1;
      }

      console.log(`  Q${src.copsoq_q.toString().padStart(2)} [${src.polarity.padEnd(10)}] ${src.title}`);
    }
  }

  console.log(
    `\n[seed-copsoq-ii] Done: ${skillCount} skills, ${topicCount} topics, ${levelCount} levels.`,
  );
}

main()
  .catch((err) => {
    console.error('[seed-copsoq-ii] FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
