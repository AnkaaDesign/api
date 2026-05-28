// scripts/seed-questionnaire-demo.ts
//
// Seeds the self-fill Questionnaire domain so the admin + self-fill UIs have
// data: a catalogue (Temas → Perguntas → Opções) plus one OPEN questionnaire
// and two CLOSED ones (with random answers).
//
// Run:  cd api && npx tsx src/scripts/seed-questionnaire-demo.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const rnd = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const maybe = (p: number) => Math.random() < p;
const COMMENTS = [
  "Tenho sugestões de melhoria para este ponto.",
  "Estou satisfeito no geral, mas há espaço para evoluir.",
  "A comunicação entre as áreas poderia ser mais clara.",
  "Ambiente muito bom e colaborativo no dia a dia.",
  "Gostaria de mais feedback sobre o meu trabalho.",
];

// Satisfaction Likert (value 1..5) reused for every demo question.
const LIKERT = [
  { order: 0, value: 1, label: "Muito insatisfeito" },
  { order: 1, value: 2, label: "Insatisfeito" },
  { order: 2, value: 3, label: "Neutro" },
  { order: 3, value: 4, label: "Satisfeito" },
  { order: 4, value: 5, label: "Muito satisfeito" },
];

const DEMO_TEMAS: { name: string; perguntas: string[] }[] = [
  {
    name: "[DEMO] Ambiente de trabalho",
    perguntas: [
      "Como você avalia o ambiente físico de trabalho?",
      "Como você avalia o relacionamento com a equipe?",
      "Como você avalia a segurança no trabalho?",
    ],
  },
  {
    name: "[DEMO] Liderança e comunicação",
    perguntas: [
      "Como você avalia a comunicação da liderança?",
      "Como você avalia o reconhecimento pelo seu trabalho?",
      "Como você avalia o apoio recebido da sua liderança?",
    ],
  },
];

async function ensureCatalogue() {
  // Reuse existing demo temas if already seeded.
  const existing = await prisma.questionnaireQuestion.findMany({
    where: { deletedAt: null, isActive: true, options: { some: {} } },
    include: { options: true },
  });
  if (existing.length >= 4) return existing;

  let order = (await prisma.questionnaireGroup.count()) ;
  const created: any[] = [];
  for (const tema of DEMO_TEMAS) {
    const group = await prisma.questionnaireGroup.upsert({
      where: { name: tema.name },
      update: {},
      create: { name: tema.name, order: order++, isActive: true },
      select: { id: true },
    });
    let qOrder = 0;
    for (const title of tema.perguntas) {
      const q = await prisma.questionnaireQuestion.create({
        data: {
          groupId: group.id,
          order: qOrder++,
          title,
          description: "Avalie de acordo com a sua experiência.",
          isActive: true,
          options: { create: LIKERT.map((o) => ({ order: o.order, value: o.value, label: o.label })) },
        },
        include: { options: true },
      });
      created.push(q);
    }
  }
  return created;
}

async function main() {
  // 1. Clean up previous demo questionnaires (entries cascade answers; campaign cascades links).
  const demos = await prisma.questionnaire.findMany({ where: { name: { startsWith: "[DEMO]" } }, select: { id: true } });
  const demoIds = demos.map((d) => d.id);
  if (demoIds.length) {
    await prisma.questionnaireEntry.deleteMany({ where: { questionnaireId: { in: demoIds } } });
    await prisma.questionnaire.deleteMany({ where: { id: { in: demoIds } } });
    console.log(`Removidos ${demoIds.length} questionário(s) [DEMO].`);
  }

  // 2. Catalogue.
  const questions = await ensureCatalogue();
  const questionIds = questions.map((q) => q.id);
  const optionsByQuestion = new Map<string, number[]>(questions.map((q) => [q.id, (q.options ?? []).map((o: any) => o.value)]));

  // 3. Users + creator.
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true }, take: 30, orderBy: { name: "asc" } });
  if (!users.length) throw new Error("Nenhum colaborador ativo encontrado.");
  const creator = users[0];
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();

  async function createQuestionnaire(opts: {
    name: string;
    status: "OPEN" | "CLOSED";
    createdAt: Date;
    periodStart: Date;
    periodEnd: Date;
    respondents: { id: string }[];
    answerRatio: number; // fraction of respondents that have answered
    submitted: boolean; // entries SUBMITTED vs PENDING/IN_PROGRESS
  }) {
    const q = await prisma.questionnaire.create({
      data: {
        name: opts.name,
        description: "Questionário de demonstração gerado por seed.",
        periodStart: opts.periodStart,
        periodEnd: opts.periodEnd,
        status: opts.status,
        createdById: creator.id,
        targetAllUsers: true,
        createdAt: opts.createdAt,
        questions: { create: questionIds.map((questionId) => ({ questionId })) },
        targetUsers: { create: opts.respondents.map((u) => ({ userId: u.id })) },
      },
      select: { id: true },
    });

    for (const r of opts.respondents) {
      const answers = maybe(opts.answerRatio);
      const entry = await prisma.questionnaireEntry.create({
        data: {
          questionnaireId: q.id,
          respondentId: r.id,
          status: opts.submitted ? "SUBMITTED" : answers ? "IN_PROGRESS" : "PENDING",
          startedAt: answers ? opts.createdAt : null,
          submittedAt: opts.submitted ? new Date(opts.createdAt.getTime() + day) : null,
          createdAt: opts.createdAt,
        },
        select: { id: true },
      });
      if (answers || opts.submitted) {
        await prisma.questionnaireAnswer.createMany({
          data: questionIds.map((questionId) => {
            const vals = optionsByQuestion.get(questionId) ?? [1, 2, 3, 4, 5];
            return {
              entryId: entry.id,
              questionId,
              value: vals[rnd(0, vals.length - 1)],
              comment: maybe(0.4) ? COMMENTS[rnd(0, COMMENTS.length - 1)] : null,
            };
          }),
        });
      }
    }
    return q.id;
  }

  const pool = users.slice(0, 15);
  const openId = await createQuestionnaire({
    name: "[DEMO] Pesquisa de Clima (Aberta)",
    status: "OPEN",
    createdAt: new Date(now - 5 * day),
    periodStart: new Date(now - 5 * day),
    periodEnd: new Date(now + 25 * day),
    respondents: pool,
    answerRatio: 0.5,
    submitted: false,
  });
  const closed1 = await createQuestionnaire({
    name: "[DEMO] Pesquisa de Satisfação 1º Tri (Fechada)",
    status: "CLOSED",
    createdAt: new Date(now - 90 * day),
    periodStart: new Date(now - 90 * day),
    periodEnd: new Date(now - 80 * day),
    respondents: pool,
    answerRatio: 1,
    submitted: true,
  });
  const closed2 = await createQuestionnaire({
    name: "[DEMO] Pesquisa de Satisfação 2º Tri (Fechada)",
    status: "CLOSED",
    createdAt: new Date(now - 45 * day),
    periodStart: new Date(now - 45 * day),
    periodEnd: new Date(now - 35 * day),
    respondents: pool,
    answerRatio: 1,
    submitted: true,
  });

  console.log(`Catálogo: ${questionIds.length} pergunta(s).`);
  console.log("✓ Aberta:", openId);
  console.log("✓ Fechada 1:", closed1);
  console.log("✓ Fechada 2:", closed2);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
