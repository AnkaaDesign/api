// scripts/seed-assessment-demo.ts
//
// Seeds two CLOSED skill-assessment campaigns with random scores so the
// admin "assessment user detail" page can be reviewed both WITH a previous-
// campaign comparison and WITHOUT it:
//   - Campaign A (older): 20 evaluatees  → their entries have NO previous (oldest)
//   - Campaign B (newer): 10 of those 20 → their entries compare against A
//
// Run:  cd api && npx tsx src/scripts/seed-assessment-demo.ts
//
// Idempotent-ish: it always creates two NEW campaigns prefixed "[DEMO]".

import { PrismaClient } from "@prisma/client";
import { EMPLOYED_USER_WHERE } from "../utils/contract";

const prisma = new PrismaClient();

const rnd = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const maybe = (p: number) => Math.random() < p;
const JUSTIFS = [
  "Mantém bom desempenho.",
  "Precisa de acompanhamento.",
  "Evoluiu em relação ao período anterior.",
  "Sempre organizado e proativo.",
  "Apresenta falhas pontuais.",
  "Referência para a equipe.",
];

async function main() {
  // 1. Catalogue: active topics (+ their skills).
  const topics = await prisma.topic.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, skillId: true },
  });
  if (topics.length === 0) {
    throw new Error("Nenhum tópico ativo encontrado — cadastre o catálogo de competências/tópicos primeiro.");
  }
  const topicIds = topics.map((t) => t.id);
  const skillIds = Array.from(new Set(topics.map((t) => t.skillId)));

  // 2. Active users — 1 evaluator + up to 20 evaluatees.
  const users = await prisma.user.findMany({
    where: { ...EMPLOYED_USER_WHERE },
    select: { id: true, name: true, sectorId: true },
    take: 40,
    orderBy: { name: "asc" },
  });
  if (users.length < 3) throw new Error("Usuários ativos insuficientes para o seed (mínimo 3).");

  const evaluator = users[0];
  const pool = users.slice(1);
  // Older campaign = 10 evaluatees; newer = 20 (superset). So in the newer
  // campaign, the first 10 have a previous (comparison) and the other ~10 do NOT.
  const evaluateesA = pool.slice(0, Math.min(10, pool.length));
  const evaluateesB = pool.slice(0, Math.min(20, pool.length));
  const sectorIds = Array.from(new Set(evaluateesB.map((u) => u.sectorId).filter((s): s is string => !!s)));

  // Clean up any previous [DEMO] campaigns so re-running doesn't pile them up.
  const demos = await prisma.assessment.findMany({ where: { name: { startsWith: "[DEMO]" } }, select: { id: true } });
  const demoIds = demos.map((d) => d.id);
  if (demoIds.length) {
    await prisma.assessmentEntry.deleteMany({ where: { assessmentId: { in: demoIds } } }); // cascades responses
    await prisma.assessment.deleteMany({ where: { id: { in: demoIds } } }); // cascades topic/skill/sector joins
    console.log(`Removidas ${demoIds.length} campanha(s) [DEMO] anteriores.`);
  }

  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();

  async function createCampaign(opts: {
    name: string;
    createdAt: Date;
    periodStart: Date;
    periodEnd: Date;
    evaluatees: { id: string }[];
  }) {
    const assessment = await prisma.assessment.create({
      data: {
        name: opts.name,
        description: "Campanha de demonstração gerada por seed.",
        periodStart: opts.periodStart,
        periodEnd: opts.periodEnd,
        status: "CLOSED",
        createdById: evaluator.id,
        createdAt: opts.createdAt,
        topics: { create: topicIds.map((topicId) => ({ topicId })) },
        skills: { create: skillIds.map((skillId) => ({ skillId })) },
        ...(sectorIds.length && {
          sectors: { create: sectorIds.map((sectorId) => ({ sectorId, appraiserId: evaluator.id })) },
        }),
      },
      select: { id: true },
    });

    for (const evaluatee of opts.evaluatees) {
      const entry = await prisma.assessmentEntry.create({
        data: {
          assessmentId: assessment.id,
          evaluateeId: evaluatee.id,
          evaluatorId: evaluator.id,
          status: "SUBMITTED",
          startedAt: opts.createdAt,
          submittedAt: new Date(opts.createdAt.getTime() + day),
          createdAt: opts.createdAt,
        },
        select: { id: true },
      });
      await prisma.assessmentResponse.createMany({
        data: topicIds.map((topicId) => ({
          entryId: entry.id,
          topicId,
          score: rnd(0, 5),
          justification: maybe(0.85) ? JUSTIFS[rnd(0, JUSTIFS.length - 1)] : null,
        })),
      });
    }
    return assessment.id;
  }

  console.log(`Seeding with ${evaluateesA.length} evaluatees (A) / ${evaluateesB.length} (B), evaluator: ${evaluator.name}`);

  const aId = await createCampaign({
    name: "[DEMO] Avaliação Anterior",
    createdAt: new Date(now - 60 * day),
    periodStart: new Date(now - 60 * day),
    periodEnd: new Date(now - 50 * day),
    evaluatees: evaluateesA,
  });
  const bId = await createCampaign({
    name: "[DEMO] Avaliação Atual",
    createdAt: new Date(now - 30 * day),
    periodStart: new Date(now - 30 * day),
    periodEnd: new Date(now - 20 * day),
    evaluatees: evaluateesB,
  });

  console.log("✓ Campanha A (anterior, 20):", aId);
  console.log("✓ Campanha B (atual, 10, com comparação):", bId);
  console.log("Abra uma ficha da campanha B para ver a comparação; uma da A para ver sem comparação.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
