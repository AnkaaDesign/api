/**
 * Seeds a CLOSED Assessment from the COPSOQ-II XLSX results.
 *
 * - Creates one Assessment (CLOSED) for the 2026-05-27 campaign
 * - Creates AssessmentSkill + AssessmentTopic links for all 3 COPSOQ skills
 * - For each CONCLUÍDO employee: creates AssessmentEntry + 41 AssessmentResponses
 * - Score mapping (5-option Likert → 0-5 system):
 *     pos:        [0,1,2,3,5]   (index → score)
 *     neg:        [5,3,2,1,0]   (index → score, inverted)
 *     neg-pinned: always 5      (Nunca = zero risk = best)
 * - COPSOQ is self-reported: evaluatorId = evaluateeId
 *
 * Idempotent: uses upsert on Assessment name.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/seed-copsoq-assessment.ts [path/to/results.xlsx]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Score maps: COPSOQ chosen_index (0-4) → system score (0-5)
const SCORE_MAP: Record<string, number[]> = {
  pos:        [0, 1, 2, 3, 5],
  neg:        [5, 3, 2, 1, 0],
  'neg-pinned': [5, 4, 3, 2, 1], // index 0 (Nunca) → 5; shouldn't go below 5 if data is correct
};

function chosenIndexToScore(polarity: string, index: number): number {
  const map = SCORE_MAP[polarity] ?? SCORE_MAP['pos'];
  return map[Math.min(index, map.length - 1)] ?? 0;
}

async function main() {
  const xlsxArg = process.argv[2];
  const xlsxPath = xlsxArg
    ? path.resolve(xlsxArg)
    : path.resolve(__dirname, '../../test/fabricalaudos_resultado_2026-05-27-16-00.xlsx');

  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`XLSX not found: ${xlsxPath}`);
  }

  const xlsx = require(path.join(__dirname, '../node_modules/xlsx'));
  const wb = xlsx.readFile(xlsxPath);

  // ── 1. Parse XLSX ──────────────────────────────────────────────────────────
  type ResumoRow = { Nome: string; CPF: string; Status: string };
  type RespostaRow = {
    Nome: string; CPF: string; Nº: number;
    Pergunta: string; Polaridade: string; Índice: number; Resposta: string;
  };

  const resumoRows: ResumoRow[]   = xlsx.utils.sheet_to_json(wb.Sheets['Resumo'],   { defval: '' });
  const respostaRows: RespostaRow[] = xlsx.utils.sheet_to_json(wb.Sheets['Respostas'], { defval: '' });

  const concluidos = resumoRows.filter(r => r.Status === 'CONCLUÍDO');
  console.log(`[seed-copsoq-assessment] ${concluidos.length} employees with CONCLUÍDO status`);

  // Group responses by CPF
  const byCpf: Record<string, RespostaRow[]> = {};
  for (const row of respostaRows) {
    const cpf = String(row.CPF).replace(/\D/g, '');
    if (!byCpf[cpf]) byCpf[cpf] = [];
    byCpf[cpf].push(row);
  }

  // ── 2. Find employees in DB ────────────────────────────────────────────────
  const dbUsers = await prisma.user.findMany({
    where: { dismissedAt: null },
    select: { id: true, name: true, cpf: true, sectorId: true },
  });
  const userByCpf = new Map(dbUsers.filter(u => u.cpf).map(u => [u.cpf!, u]));

  // ── 3. Find COPSOQ topics ordered by Q number ──────────────────────────────
  const copsoqSkills = await prisma.skill.findMany({
    where: { name: { startsWith: 'COPSOQ-II' } },
    include: { topics: { orderBy: { order: 'asc' } } },
    orderBy: { order: 'asc' },
  });

  if (!copsoqSkills.length) throw new Error('COPSOQ-II skills not found — run seed-copsoq-ii.ts first');

  // Build Q-number → topicId map (order = Q number from title prefix)
  const topicByQ = new Map<number, string>();
  for (const skill of copsoqSkills) {
    for (const topic of skill.topics) {
      topicByQ.set(topic.order, topic.id);
    }
  }
  console.log(`[seed-copsoq-assessment] ${topicByQ.size} topics loaded`);

  // ── 4. Pick a createdBy user (first admin or first user in DB) ─────────────
  const creator = dbUsers[0];
  if (!creator) throw new Error('No users found in database');

  // ── 5. Upsert Assessment ───────────────────────────────────────────────────
  const ASSESSMENT_NAME = 'COPSOQ-II — Avaliação Psicossocial 2026';
  let assessment = await prisma.assessment.findFirst({ where: { name: ASSESSMENT_NAME } });
  if (!assessment) {
    assessment = await prisma.assessment.create({
      data: {
        name: ASSESSMENT_NAME,
        description:
          'Avaliação psicossocial realizada em maio de 2026 via plataforma Fábrica de Laudos (COPSOQ-II). ' +
          'Respostas importadas automaticamente a partir do questionário digital preenchido pelos colaboradores.',
        periodStart: new Date('2026-05-27T00:00:00-03:00'),
        periodEnd:   new Date('2026-05-27T23:59:59-03:00'),
        status: 'CLOSED',
        createdById: creator.id,
      },
    });
    console.log(`[seed-copsoq-assessment] Assessment created: ${assessment.id}`);
  } else {
    console.log(`[seed-copsoq-assessment] Assessment already exists: ${assessment.id}`);
  }

  // ── 6. Link skills + topics to assessment ──────────────────────────────────
  for (const skill of copsoqSkills) {
    await prisma.assessmentSkill.upsert({
      where: { assessmentId_skillId: { assessmentId: assessment.id, skillId: skill.id } },
      update: {},
      create: { assessmentId: assessment.id, skillId: skill.id },
    });
    for (const topic of skill.topics) {
      await prisma.assessmentTopic.upsert({
        where: { assessmentId_topicId: { assessmentId: assessment.id, topicId: topic.id } },
        update: {},
        create: { assessmentId: assessment.id, topicId: topic.id },
      });
    }
  }
  console.log(`[seed-copsoq-assessment] Skills + topics linked to assessment`);

  // ── 7. Create entries + responses ──────────────────────────────────────────
  let entryCount = 0;
  let responseCount = 0;
  let skipped = 0;

  for (const row of concluidos) {
    const cpf = String(row.CPF).replace(/\D/g, '');
    const dbUser = userByCpf.get(cpf);

    if (!dbUser) {
      console.warn(`  ✗ ${row.Nome} (${row.CPF}) — not found in DB, skipping`);
      skipped++;
      continue;
    }

    const responses = byCpf[cpf] ?? [];
    if (!responses.length) {
      console.warn(`  ✗ ${row.Nome} — no responses in XLSX, skipping`);
      skipped++;
      continue;
    }

    // Upsert entry (self-reported: evaluator = evaluatee)
    const entry = await prisma.assessmentEntry.upsert({
      where: { assessmentId_evaluateeId: { assessmentId: assessment.id, evaluateeId: dbUser.id } },
      update: { status: 'SUBMITTED', submittedAt: new Date('2026-05-27T16:00:00-03:00') },
      create: {
        assessmentId: assessment.id,
        evaluateeId: dbUser.id,
        evaluatorId: dbUser.id,
        status: 'SUBMITTED',
        startedAt:   new Date('2026-05-27T15:00:00-03:00'),
        submittedAt: new Date('2026-05-27T16:00:00-03:00'),
      },
    });
    entryCount++;

    for (const resp of responses) {
      const topicId = topicByQ.get(resp['Nº']);
      if (!topicId) {
        console.warn(`    Q${resp['Nº']} — no topic found, skipping`);
        continue;
      }

      const score = chosenIndexToScore(resp.Polaridade, Number(resp['Índice']));

      await prisma.assessmentResponse.upsert({
        where: { entryId_topicId: { entryId: entry.id, topicId } },
        update: { score },
        create: { entryId: entry.id, topicId, score },
      });
      responseCount++;
    }

    console.log(`  ✓ ${row.Nome} — ${responses.length} respostas`);
  }

  console.log(`\n[seed-copsoq-assessment] Done:`);
  console.log(`  ${entryCount} entries, ${responseCount} responses, ${skipped} skipped`);
}

main()
  .catch(err => { console.error('[seed-copsoq-assessment] FAILED:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
