/**
 * Updates COPSOQ-II QuestionnaireOption labels from management-rubric language
 * ("Crítico", "Referência"…) to the original COPSOQ-II survey Likert labels.
 *
 * Rule: score 0 = worst for company, score 5 = best for company (unchanged).
 *
 * Scales applied by question number:
 *   Q1–Q6   : NEG_FREQ   (Sempre → Nunca/Quase nunca)
 *   Q7–Q26  : POS_FREQ   (Nunca/Quase nunca → Sempre)
 *   Q27     : SATISFACTION (Muito insatisfeito → Extremamente satisfeito)
 *   Q28     : WORRY      (Muito preocupado → Nada preocupado)
 *   Q29     : HEALTH     (Muito deficiente → Excelente)
 *   Q30–Q37 : NEG_FREQ   (Sempre → Nunca/Quase nunca)
 *   Q38–Q41 : NEG_PINNED (Constantemente → Nunca)
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/update-copsoq-option-labels.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Label sets ────────────────────────────────────────────────────────────────

type LabelMap = Record<number, { label: string; description: string }>;

/** Neg-polarity frequency: high frequency of negative event → bad for company */
const NEG_FREQ: LabelMap = {
  0: { label: 'Sempre',             description: 'Isso ocorre sempre ou praticamente sempre.' },
  1: { label: 'Frequentemente',     description: 'Isso ocorre com muita frequência.' },
  2: { label: 'Às vezes',           description: 'Isso ocorre em algumas situações.' },
  3: { label: 'Raramente',          description: 'Isso raramente ocorre.' },
  4: { label: 'Muito raramente',    description: 'Isso ocorre muito raramente.' },
  5: { label: 'Nunca/Quase nunca',  description: 'Isso nunca ou quase nunca ocorre.' },
};

/** Pos-polarity frequency: high frequency of positive aspect → good for company */
const POS_FREQ: LabelMap = {
  0: { label: 'Nunca/Quase nunca',  description: 'Isso nunca ou quase nunca ocorre.' },
  1: { label: 'Raramente',          description: 'Isso raramente ocorre.' },
  2: { label: 'Às vezes',           description: 'Isso ocorre em algumas situações.' },
  3: { label: 'Com frequência',     description: 'Isso ocorre com frequência.' },
  4: { label: 'Quase sempre',       description: 'Isso ocorre na grande maioria das situações.' },
  5: { label: 'Sempre',             description: 'Isso ocorre sempre ou praticamente sempre.' },
};

/** Q38–Q41 — Comportamentos Ofensivos (neg-pinned, reference to last 12 months) */
const NEG_PINNED: LabelMap = {
  0: { label: 'Constantemente',        description: 'Ocorreu de forma constante nos últimos 12 meses.' },
  1: { label: 'Frequentemente',        description: 'Ocorreu com frequência nos últimos 12 meses.' },
  2: { label: 'Às vezes',              description: 'Ocorreu algumas vezes nos últimos 12 meses.' },
  3: { label: 'Raramente',             description: 'Ocorreu raramente nos últimos 12 meses.' },
  4: { label: 'Quase nunca (1–2×)',    description: 'Ocorreu apenas 1 ou 2 vezes nos últimos 12 meses.' },
  5: { label: 'Nunca',                 description: 'Nunca ocorreu nos últimos 12 meses.' },
};

/** Q27 — Satisfação com o Trabalho */
const SATISFACTION: LabelMap = {
  0: { label: 'Muito insatisfeito(a)',       description: 'Totalmente insatisfeito(a) com o trabalho.' },
  1: { label: 'Insatisfeito(a)',             description: 'Predominantemente insatisfeito(a).' },
  2: { label: 'Pouco satisfeito(a)',         description: 'Satisfação abaixo do esperado.' },
  3: { label: 'Satisfeito(a)',               description: 'Satisfação adequada com o trabalho.' },
  4: { label: 'Muito satisfeito(a)',         description: 'Alto nível de satisfação.' },
  5: { label: 'Extremamente satisfeito(a)', description: 'Satisfação plena com todas as dimensões do trabalho.' },
};

/** Q28 — Insegurança no Emprego */
const WORRY: LabelMap = {
  0: { label: 'Muito preocupado(a)',          description: 'Preocupação intensa e constante com a estabilidade do emprego.' },
  1: { label: 'Bastante preocupado(a)',       description: 'Preocupação frequente com a possibilidade de perder o emprego.' },
  2: { label: 'Moderadamente preocupado(a)', description: 'Alguma preocupação em momentos de incerteza.' },
  3: { label: 'Pouco preocupado(a)',          description: 'Pouca preocupação; sente-se razoavelmente seguro(a).' },
  4: { label: 'Muito pouco preocupado(a)',    description: 'Quase nenhuma preocupação com estabilidade.' },
  5: { label: 'Nada preocupado(a)',           description: 'Sente total segurança e estabilidade no emprego.' },
};

/** Q29 — Saúde Geral Autorrelatada */
const HEALTH: LabelMap = {
  0: { label: 'Muito deficiente', description: 'Saúde muito comprometida, com limitações significativas.' },
  1: { label: 'Deficiente',       description: 'Saúde baixa com queixas frequentes.' },
  2: { label: 'Razoável',         description: 'Saúde aceitável, mas com queixas recorrentes.' },
  3: { label: 'Boa',              description: 'Boa saúde com raras queixas.' },
  4: { label: 'Muito boa',        description: 'Muito boa saúde; raramente apresenta limitações.' },
  5: { label: 'Excelente',        description: 'Excelente saúde em todas as dimensões.' },
};

// ── Scale selector ─────────────────────────────────────────────────────────────

function scaleFor(groupOrder: number, qOrder: number): LabelMap {
  if (groupOrder === 1) return NEG_FREQ;           // Q1–Q6: work demands
  if (groupOrder === 2) {
    if (qOrder === 27) return SATISFACTION;         // Q27: satisfaction
    return POS_FREQ;                               // Q7–Q26: organisation & relations
  }
  // groupOrder === 3: wellbeing & psychosocial health
  if (qOrder === 28) return WORRY;
  if (qOrder === 29) return HEALTH;
  if (qOrder >= 38)  return NEG_PINNED;            // Q38–Q41: offensive behaviours
  return NEG_FREQ;                                 // Q30–Q37: sleep, burnout, stress
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const groups = await prisma.questionnaireGroup.findMany({
    where: { name: { startsWith: 'COPSOQ-II' } },
    include: {
      questions: {
        include: { options: true },
        orderBy: { order: 'asc' },
      },
    },
    orderBy: { order: 'asc' },
  });

  if (!groups.length) {
    throw new Error('No COPSOQ-II groups found — was the migration run?');
  }

  let updated = 0;

  for (const group of groups) {
    console.log(`\n[update] Group: ${group.name} (order ${group.order})`);

    for (const question of group.questions) {
      const scale = scaleFor(group.order, question.order);

      for (const option of question.options) {
        const entry = scale[option.value];
        if (!entry) {
          console.warn(`  [warn] Q${question.order} value=${option.value}: no entry in scale, skipping`);
          continue;
        }

        if (option.label === entry.label && option.description === entry.description) {
          continue; // already up to date
        }

        await prisma.questionnaireOption.update({
          where: { id: option.id },
          data: { label: entry.label, description: entry.description },
        });
        updated++;
      }

      console.log(`  Q${String(question.order).padStart(2)} [${group.order === 2 ? 'pos' : group.order === 1 || (group.order === 3 && question.order <= 37) ? 'neg' : 'pinned'}] ${question.title}`);
    }
  }

  console.log(`\n[update] Done — ${updated} option(s) updated.`);
}

main()
  .catch(err => {
    console.error('[update] FAILED:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
