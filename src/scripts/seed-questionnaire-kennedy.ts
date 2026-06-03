// scripts/seed-questionnaire-kennedy.ts
//
// Focused seed for manual testing of the self-fill Questionnaire flow on mobile:
// creates a catalogue of 2 temas × 3 perguntas (with a 1..5 Likert scale) and a
// single OPEN questionnaire that targets ONLY the user "Kennedy Campos", leaving
// him a PENDING (open) entry so the "Questionários" menu/card appears for him.
//
// Re-runnable: it cleans up its own [TESTE KENNEDY] artifacts first.
//
// Run:  cd api && npx tsx src/scripts/seed-questionnaire-kennedy.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TAG = "[TESTE KENNEDY]";

// Satisfaction Likert (value 1..5) reused for every question.
const LIKERT = [
  { order: 0, value: 1, label: "Muito insatisfeito" },
  { order: 1, value: 2, label: "Insatisfeito" },
  { order: 2, value: 3, label: "Neutro" },
  { order: 3, value: 4, label: "Satisfeito" },
  { order: 4, value: 5, label: "Muito satisfeito" },
];

const TEMAS: { name: string; perguntas: string[] }[] = [
  {
    name: `${TAG} Ambiente de trabalho`,
    perguntas: [
      "Como você avalia o ambiente físico de trabalho?",
      "Como você avalia o relacionamento com a equipe?",
      "Como você avalia a segurança no trabalho?",
    ],
  },
  {
    name: `${TAG} Liderança e comunicação`,
    perguntas: [
      "Como você avalia a comunicação da liderança?",
      "Como você avalia o reconhecimento pelo seu trabalho?",
      "Como você avalia o apoio recebido da sua liderança?",
    ],
  },
];

async function main() {
  // 1. Find Kennedy Campos.
  const user = await prisma.user.findFirst({
    where: { name: { contains: "Kennedy", mode: "insensitive" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (!user) throw new Error('Usuário "Kennedy Campos" não encontrado.');
  console.log(`Alvo: ${user.name} (${user.id})`);

  // 2. Clean up previous test artifacts so the script is re-runnable.
  const oldQuestionnaires = await prisma.questionnaire.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  if (oldQuestionnaires.length) {
    const ids = oldQuestionnaires.map((q) => q.id);
    await prisma.questionnaireEntry.deleteMany({ where: { questionnaireId: { in: ids } } });
    await prisma.questionnaire.deleteMany({ where: { id: { in: ids } } });
  }
  // Groups (themes) cascade their questions+options on delete.
  await prisma.questionnaireGroup.deleteMany({ where: { name: { startsWith: TAG } } });

  // 3. Catalogue: 2 temas × 3 perguntas, each with the Likert options.
  let groupOrder = await prisma.questionnaireGroup.count();
  const questionIds: string[] = [];
  for (const tema of TEMAS) {
    const group = await prisma.questionnaireGroup.create({
      data: { name: tema.name, order: groupOrder++, isActive: true },
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
        select: { id: true },
      });
      questionIds.push(q.id);
    }
  }

  // 4. OPEN questionnaire targeting only Kennedy, with a PENDING entry.
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const questionnaire = await prisma.questionnaire.create({
    data: {
      name: `${TAG} Pesquisa de Clima`,
      description: "Questionário de teste gerado por seed para o Kennedy.",
      periodStart: new Date(now - day),
      periodEnd: new Date(now + 30 * day),
      status: "OPEN",
      createdById: user.id,
      targetAllUsers: false,
      questions: { create: questionIds.map((questionId) => ({ questionId })) },
      targetUsers: { create: [{ userId: user.id }] },
      entries: { create: [{ respondentId: user.id, status: "PENDING" }] },
    },
    select: { id: true },
  });

  console.log(`✓ Catálogo: ${TEMAS.length} tema(s), ${questionIds.length} pergunta(s).`);
  console.log(`✓ Questionário ABERTO: ${questionnaire.id}`);
  console.log(`✓ Entry PENDENTE criada para ${user.name}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
