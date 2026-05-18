import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';

/**
 * Skill-Assessment seed service.
 *
 * Populates the NEW Skill/Topic/TopicLevel models from a JSON file generated
 * from the source spreadsheet ("Matriz de Competência - Produção"):
 *
 *   /tmp/skill_matrix_extracted.json
 *
 * Layout: { [sheetName]: Array<{ title, description, counter_behaviors, levels: Level[] }> }
 * where Level = { score, name, description } (6 entries per topic).
 *
 * The 3 sheet names map to a Skill name (the Skill IS the area):
 *   "Produtividade"          → Produtividade        (Skill order 1)
 *   "Comportamental "        → Comportamental       (Skill order 2)
 *   "Segurança do Trabalho"  → Segurança do Trabalho (Skill order 3)
 *
 * The seed is idempotent: re-runs produce zero diffs.
 *   - Skill is upserted by unique `name`.
 *   - Topic is upserted by (skillId, order) — its title prefix "1. ", "2. ", ...
 *     drives the order; the rest of the title is preserved verbatim.
 *   - TopicLevel is upserted by (topicId, score).
 */

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
    sheetKey: 'Comportamental ', // trailing space preserved from source
  },
  {
    name: 'Segurança do Trabalho',
    description:
      'Avalia o cumprimento de normas, uso de EPIs, percepção de risco e contribuição para a cultura de segurança.',
    order: 3,
    sheetKey: 'Segurança do Trabalho',
  },
];

/**
 * Source titles are like "1. Disciplina e cumprimento de regras". We preserve
 * the title verbatim (per project rule) but use the leading number as `order`.
 */
const ORDER_PREFIX_RE = /^\s*(\d+)\s*\.\s*/;

function parseOrder(title: string, fallback: number): number {
  const match = title.match(ORDER_PREFIX_RE);
  return match ? parseInt(match[1], 10) : fallback;
}

const SEED_JSON_PATH = '/tmp/skill_matrix_extracted.json';

@Injectable()
export class SkillSeedService implements OnModuleInit {
  private readonly logger = new Logger(SkillSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.seed();
    } catch (err) {
      this.logger.error('Skill-assessment seed failed', err as Error);
    }
  }

  /**
   * Public entry point. Safe to re-run.
   */
  async seed(): Promise<{ skills: number; topics: number; levels: number }> {
    const source = this.loadSourceMatrix();
    if (!source) {
      this.logger.warn(
        `Skill-assessment seed skipped: ${SEED_JSON_PATH} not found or unreadable.`,
      );
      return { skills: 0, topics: 0, levels: 0 };
    }

    let skillCount = 0;
    let topicCount = 0;
    let levelCount = 0;

    for (const mapping of SKILL_MAPPINGS) {
      const sourceTopics = source[mapping.sheetKey];
      if (!sourceTopics || !Array.isArray(sourceTopics) || sourceTopics.length === 0) {
        this.logger.warn(
          `Skill "${mapping.name}" skipped: sheet "${mapping.sheetKey}" missing or empty.`,
        );
        continue;
      }

      // 1) Upsert the Skill (unique by name).
      const skill = await this.prisma.skill.upsert({
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

      // 2) For each source topic, upsert Topic by (skillId, order), then upsert
      //    its 6 TopicLevels by (topicId, score).
      for (let i = 0; i < sourceTopics.length; i++) {
        const src = sourceTopics[i];
        const order = parseOrder(src.title, i + 1);

        const topic = await this.prisma.topic.upsert({
          where: {
            skillId_order: {
              skillId: skill.id,
              order,
            },
          },
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
          await this.prisma.topicLevel.upsert({
            where: {
              topicId_score: {
                topicId: topic.id,
                score: lvl.score,
              },
            },
            update: {
              name: lvl.name,
              description: lvl.description,
            },
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

    this.logger.log(
      `Skill-assessment seed OK: ${skillCount} skills, ${topicCount} topics, ${levelCount} levels.`,
    );
    return { skills: skillCount, topics: topicCount, levels: levelCount };
  }

  private loadSourceMatrix(): SourceMatrix | null {
    try {
      if (!fs.existsSync(SEED_JSON_PATH)) return null;
      const raw = fs.readFileSync(SEED_JSON_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed as SourceMatrix;
    } catch (err) {
      this.logger.error(
        `Failed to read seed JSON at ${SEED_JSON_PATH}: ${(err as Error).message}`,
      );
      return null;
    }
  }
}

// Suppress unused-import warning when path is not used elsewhere — we keep the
// import for environments that may want to resolve the JSON path relatively
// later; remove if your lint config flags it.
void path;
