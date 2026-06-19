// seed-benefits.ts
// Seed idempotente do catálogo de Benefícios (CLT) + Adesões (UserBenefit).
//
// Execução (NÃO rodar com o banco em restore):
//   cd api && npx tsx scripts/seed-benefits.ts
//
// Idempotência:
//   - Benefícios: upsert por Benefit.name (@unique).
//   - Adesões: pula qualquer par (userId, benefitId) já existente (qualquer status).
//
// Regra de coparticipação (espelho de src/utils/benefit-discount.ts):
//   - Os campos de REGRA são armazenados (employeeDiscountPercent OU
//     employeeDiscountValue); as partes empresa/colaborador são SEMPRE
//     computadas — nada derivado é persistido.
//   - VT: percentual incide sobre o SALÁRIO-BASE (máx. 6% — Lei 7.418/85).
//   - VR/VA: percentual incide sobre o CUSTO (máx. 20% — PAT).
//
// Atribuição determinística (sem aleatoriedade), usuários ativos ordenados por nome:
//   - todos:      Vale Transporte (6%, 2 passagens/dia) + Vale Alimentação (20%)
//   - i % 2 == 0: Vale Refeição (20%)
//   - i % 3 == 0: Plano de Saúde (desconto fixo R$ 120)
//   - i % 5 == 0: Plano Odontológico (sem desconto)
//   - i % 7 == 0: Seguro de Vida (sem desconto)

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ACTIVE = 'ACTIVE' as const;
const ACTIVE_STATUS_ORDER = 1; // BENEFIT_ENROLLMENT_STATUS_ORDER[ACTIVE]

interface BenefitSeed {
  name: string;
  kind:
    | 'TRANSPORT_VOUCHER'
    | 'MEAL_VOUCHER'
    | 'FOOD_VOUCHER'
    | 'HEALTH_PLAN'
    | 'DENTAL_PLAN'
    | 'PHARMACY_AGREEMENT'
    | 'PARTNERSHIP'
    | 'LIFE_INSURANCE'
    | 'OTHER';
  provider: string;
  defaultValue: number;
  defaultEmployeeDiscountPercent: number | null;
  notes: string | null;
}

// Catálogo CLT-padrão com valores realistas.
const BENEFIT_CATALOG: BenefitSeed[] = [
  {
    name: 'Vale Transporte',
    kind: 'TRANSPORT_VOUCHER',
    provider: 'Urbano Transporte Coletivo',
    // 2 passagens/dia × ~R$ 5,00 × 22 dias úteis ≈ R$ 220/mês
    defaultValue: 220,
    defaultEmployeeDiscountPercent: 6, // CLT/Lei 7.418/85: máx. 6% do salário-base
    notes: 'Desconto de 6% do salário-base (Lei 7.418/85), limitado ao custo do VT. 2 passagens/dia × 22 dias úteis.',
  },
  {
    name: 'Vale Refeição',
    kind: 'MEAL_VOUCHER',
    provider: 'Alelo Refeição',
    // R$ 25/dia × 22 dias úteis ≈ R$ 550/mês
    defaultValue: 550,
    defaultEmployeeDiscountPercent: 20, // PAT: máx. 20% do custo
    notes: 'R$ 25,00/dia útil. Desconto máximo de 20% do custo (PAT).',
  },
  {
    name: 'Vale Alimentação',
    kind: 'FOOD_VOUCHER',
    provider: 'Alelo Alimentação',
    defaultValue: 450,
    defaultEmployeeDiscountPercent: 20, // PAT: máx. 20% do custo
    notes: 'Desconto máximo de 20% do custo (PAT).',
  },
  {
    name: 'Plano de Saúde',
    kind: 'HEALTH_PLAN',
    provider: 'Unimed',
    defaultValue: 380,
    defaultEmployeeDiscountPercent: null, // coparticipação via desconto fixo na adesão
    notes: 'Plano coletivo empresarial. Coparticipação do colaborador definida na adesão (valor fixo).',
  },
  {
    name: 'Plano Odontológico',
    kind: 'DENTAL_PLAN',
    provider: 'Uniodonto',
    defaultValue: 45,
    defaultEmployeeDiscountPercent: null,
    notes: 'Custeado integralmente pela empresa.',
  },
  {
    name: 'Seguro de Vida',
    kind: 'LIFE_INSURANCE',
    provider: 'Porto Seguro',
    defaultValue: 18,
    defaultEmployeeDiscountPercent: null,
    notes: 'Seguro de vida em grupo, custeado integralmente pela empresa.',
  },
  {
    name: 'Convênio Farmácia',
    kind: 'PHARMACY_AGREEMENT',
    provider: 'Farmácia São João',
    defaultValue: 0, // sem custo base; desconto em folha conforme uso (CLT 462: exige autorização)
    defaultEmployeeDiscountPercent: null,
    notes: 'Convênio de desconto em folha conforme consumo. Exige autorização assinada do colaborador (CLT art. 462).',
  },
];

interface EnrollmentPlan {
  benefitName: string;
  monthlyValue: number;
  employeeDiscountPercent: number | null;
  employeeDiscountValue: number | null;
  dailyTickets: number | null;
  notes: string | null;
}

/** Plano determinístico de adesões para o usuário de índice `i` (ordenado por nome). */
function buildEnrollmentPlan(i: number): EnrollmentPlan[] {
  const plans: EnrollmentPlan[] = [
    // Todos: VT pela regra percentual (6% do salário, computado na folha) + VA
    {
      benefitName: 'Vale Transporte',
      monthlyValue: 220,
      employeeDiscountPercent: 6,
      employeeDiscountValue: null,
      dailyTickets: 2,
      notes: null,
    },
    {
      benefitName: 'Vale Alimentação',
      monthlyValue: 450,
      employeeDiscountPercent: 20,
      employeeDiscountValue: null,
      dailyTickets: null,
      notes: null,
    },
  ];

  if (i % 2 === 0) {
    plans.push({
      benefitName: 'Vale Refeição',
      monthlyValue: 550,
      employeeDiscountPercent: 20,
      employeeDiscountValue: null,
      dailyTickets: null,
      notes: null,
    });
  }

  if (i % 3 === 0) {
    plans.push({
      benefitName: 'Plano de Saúde',
      monthlyValue: 380,
      employeeDiscountPercent: null,
      employeeDiscountValue: 120, // coparticipação fixa
      dailyTickets: null,
      notes: 'Coparticipação fixa de R$ 120,00/mês.',
    });
  }

  if (i % 5 === 0) {
    plans.push({
      benefitName: 'Plano Odontológico',
      monthlyValue: 45,
      employeeDiscountPercent: null,
      employeeDiscountValue: null, // 100% empresa
      dailyTickets: null,
      notes: null,
    });
  }

  if (i % 7 === 0) {
    plans.push({
      benefitName: 'Seguro de Vida',
      monthlyValue: 18,
      employeeDiscountPercent: null,
      employeeDiscountValue: null, // 100% empresa
      dailyTickets: null,
      notes: null,
    });
  }

  return plans;
}

async function main() {
  console.log('== Seed de Benefícios e Adesões ==');

  // 1) Catálogo — upsert por nome (idempotente)
  const benefitIdByName = new Map<string, string>();
  for (const seed of BENEFIT_CATALOG) {
    const benefit = await prisma.benefit.upsert({
      where: { name: seed.name },
      create: {
        name: seed.name,
        kind: seed.kind as any,
        provider: seed.provider,
        defaultValue: seed.defaultValue,
        defaultEmployeeDiscountPercent: seed.defaultEmployeeDiscountPercent,
        isActive: true,
        notes: seed.notes,
      },
      // Mantém valores editados manualmente; atualiza apenas metadados estáveis
      update: {
        kind: seed.kind as any,
        isActive: true,
      },
    });
    benefitIdByName.set(seed.name, benefit.id);
    console.log(`  [benefit] ${seed.name} -> ${benefit.id}`);
  }

  // 2) Usuários ativos (não demitidos), ordem determinística por nome
  const users = await prisma.user.findMany({
    where: { currentContractStatus: { not: 'TERMINATED' as any } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  console.log(`  ${users.length} colaboradores ativos (currentContractStatus != TERMINATED)`);

  // Início de vigência determinístico: primeiro dia do mês corrente
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);

  // 3) Adesões — pula pares (userId, benefitId) já existentes
  let created = 0;
  let skipped = 0;
  for (const [index, user] of users.entries()) {
    for (const plan of buildEnrollmentPlan(index)) {
      const benefitId = benefitIdByName.get(plan.benefitName);
      if (!benefitId) continue;

      const existing = await prisma.userBenefit.findFirst({
        where: { userId: user.id, benefitId },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }

      await prisma.userBenefit.create({
        data: {
          userId: user.id,
          benefitId,
          status: ACTIVE as any,
          statusOrder: ACTIVE_STATUS_ORDER,
          startDate,
          monthlyValue: plan.monthlyValue,
          employeeDiscountPercent: plan.employeeDiscountPercent,
          employeeDiscountValue: plan.employeeDiscountValue,
          dailyTickets: plan.dailyTickets,
          notes: plan.notes,
        },
      });
      created++;
    }
  }

  console.log(`  [user-benefit] ${created} adesões criadas, ${skipped} já existentes (puladas)`);
  console.log('== Concluído ==');
}

main()
  .catch((error) => {
    console.error('Seed de benefícios falhou:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
