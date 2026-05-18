/**
 * Seeds Skill / Topic / TopicLevel from scripts/data/skill-matrix.json.
 *
 * Source: "Matriz de Competência (Skill Matrix).xlsx", sheets:
 *   - Produtividade
 *   - Comportamental
 *   - Segurança do Trabalho
 *
 * Idempotent: re-runs upsert by unique fields (Skill.name, Topic[skillId,order],
 * TopicLevel[topicId,score]) and produce zero diffs on a synced database.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/seed-skill-matrix.ts
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
  description: string;
  counter_behaviors: string;
  levels: SourceLevel[];
}

type SourceMatrix = Record<string, SourceTopic[]>;

interface SkillMapping {
  name: string;
  description: string;
  order: number;
  sheetKey: string;
}

const SKILL_MAPPINGS: SkillMapping[] = [
  {
    name: 'Produtividade',
    description:
      'Avalia organização, eficiência, gestão do tempo, qualidade da execução e uso responsável de recursos.',
    order: 1,
    sheetKey: 'Produtividade',
  },
  {
    name: 'Comportamental',
    description:
      'Avalia disciplina, postura, engajamento e relacionamento do colaborador no ambiente de trabalho.',
    order: 2,
    sheetKey: 'Comportamental ',
  },
  {
    name: 'Segurança do Trabalho',
    description:
      'Avalia o cumprimento de normas, uso de EPIs, percepção de risco e contribuição para a cultura de segurança.',
    order: 3,
    sheetKey: 'Segurança do Trabalho',
  },
];

const ORDER_PREFIX_RE = /^\s*(\d+)\s*\.\s*/;

function parseOrder(title: string, fallback: number): number {
  const match = title.match(ORDER_PREFIX_RE);
  return match ? parseInt(match[1], 10) : fallback;
}

const DATA_PATH = path.resolve(__dirname, 'data', 'skill-matrix.json');

async function main() {
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`Skill matrix data not found at ${DATA_PATH}`);
  }
  const source = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) as SourceMatrix;

  let skillCount = 0;
  let topicCount = 0;
  let levelCount = 0;

  for (const mapping of SKILL_MAPPINGS) {
    const sourceTopics = source[mapping.sheetKey];
    if (!sourceTopics?.length) {
      console.warn(
        `[seed-skill-matrix] Skipping "${mapping.name}": sheet "${mapping.sheetKey}" missing or empty.`,
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
    }
  }

  console.log(
    `[seed-skill-matrix] Done: ${skillCount} skills, ${topicCount} topics, ${levelCount} levels.`,
  );
}

main()
  .catch((err) => {
    console.error('[seed-skill-matrix] FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
