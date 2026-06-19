// seed-dependents-loans.ts
// Seed idempotente de Dependentes (dedução IRRF / salário-família) e de
// descontos de Empréstimo consignado (PayrollDiscount LOAN parcelado).
//
// Execução (NÃO rodar com o banco em restore):
//   cd api && npx tsx scripts/seed-dependents-loans.ts
//
// Determinístico (sem faker): usuários elegíveis ordenados por nome.
//   - Dependentes: ~8 primeiros usuários elegíveis, 1–3 dependentes cada
//     (mix de parentescos; alguns sem dedução IRRF; alguns com salário-família).
//   - Empréstimos: 3 usuários elegíveis COM folha salva (os descontos LOAN
//     são ancorados na folha mais recente e copiados mês a mês pelo
//     PersistentDiscountService, avançando currentInstallment).
//
// Idempotência (check-before-insert):
//   - Dependente: pula se já existir (userId, name).
//   - Empréstimo: pula se o usuário já tiver QUALQUER desconto LOAN ativo.

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

type DependentTemplate = {
  name: (userFirstName: string) => string;
  relationship:
    | 'CHILD'
    | 'STEPCHILD'
    | 'SPOUSE'
    | 'PARTNER'
    | 'PARENT'
    | 'WARD'
    | 'DISABLED_ANY_AGE'
    | 'OTHER';
  birthDate: Date;
  irrfDeduction: boolean;
  salarioFamilia: boolean;
  notes?: string;
};

// Templates determinísticos — o índice do usuário escolhe o "pacote".
const DEPENDENT_PACKS: DependentTemplate[][] = [
  [
    {
      name: f => `${f} Souza Filho`,
      relationship: 'CHILD',
      birthDate: new Date('2016-03-10T12:00:00Z'),
      irrfDeduction: true,
      salarioFamilia: true,
    },
  ],
  [
    {
      name: f => `Maria de ${f}`,
      relationship: 'SPOUSE',
      birthDate: new Date('1991-05-15T12:00:00Z'),
      irrfDeduction: true,
      salarioFamilia: false,
    },
    {
      name: f => `${f} Souza Filha`,
      relationship: 'CHILD',
      birthDate: new Date('2019-07-22T12:00:00Z'),
      irrfDeduction: true,
      salarioFamilia: true,
    },
  ],
  [
    {
      name: f => `${f} Junior`,
      relationship: 'CHILD',
      birthDate: new Date('2021-01-05T12:00:00Z'),
      irrfDeduction: true,
      salarioFamilia: true,
    },
    {
      name: f => `Ana de ${f}`,
      relationship: 'PARTNER',
      birthDate: new Date('1993-11-02T12:00:00Z'),
      irrfDeduction: false,
      salarioFamilia: false,
      notes: 'Companheira — sem dedução de IRRF (declarada pelo outro responsável)',
    },
    {
      name: f => `José pai de ${f}`,
      relationship: 'PARENT',
      birthDate: new Date('1958-09-30T12:00:00Z'),
      irrfDeduction: false,
      salarioFamilia: false,
    },
  ],
  [
    {
      name: f => `${f} Enteado`,
      relationship: 'STEPCHILD',
      birthDate: new Date('2013-08-18T12:00:00Z'),
      irrfDeduction: true,
      salarioFamilia: true,
    },
    {
      name: f => `${f} Caçula`,
      relationship: 'CHILD',
      birthDate: new Date('2023-04-09T12:00:00Z'),
      irrfDeduction: true,
      salarioFamilia: false,
    },
  ],
];

// Empréstimos determinísticos (consignado CLT).
const LOAN_TEMPLATES = [
  { reference: 'Empréstimo consignado', totalAmount: 2500.0, installments: 10 }, // 10× R$ 250,00
  { reference: 'Empréstimo CLT', totalAmount: 1083.0, installments: 6 }, // 6× R$ 180,50
  { reference: 'Crédito Trabalhador', totalAmount: 1198.8, installments: 12 }, // 12× R$ 99,90
];

async function main() {
  console.log('Seed de dependentes + empréstimos (determinístico, idempotente)\n');

  // Usuários elegíveis: não-ADMIN (privilégio do setor) e não desligados.
  const users = await prisma.user.findMany({
    where: {
      currentContractStatus: { not: 'TERMINATED' },
      OR: [{ sector: null }, { sector: { privileges: { not: 'ADMIN' } } }],
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  if (users.length === 0) {
    console.log('Nenhum usuário elegível encontrado — nada a fazer.');
    return;
  }

  // =====================
  // 1. Dependentes (~8 usuários, 1–3 cada)
  // =====================
  const dependentTargets = users.slice(0, 8);
  let dependentsCreated = 0;
  let dependentsSkipped = 0;

  for (let i = 0; i < dependentTargets.length; i++) {
    const user = dependentTargets[i];
    const firstName = user.name.split(' ')[0] || user.name;
    const pack = DEPENDENT_PACKS[i % DEPENDENT_PACKS.length];

    for (const template of pack) {
      const name = template.name(firstName);

      const existing = await prisma.dependent.findFirst({
        where: { userId: user.id, name },
        select: { id: true },
      });
      if (existing) {
        dependentsSkipped++;
        continue;
      }

      await prisma.dependent.create({
        data: {
          userId: user.id,
          name,
          cpf: null, // únicos por (userId, cpf); null permite múltiplos
          birthDate: template.birthDate,
          relationship: template.relationship,
          irrfDeduction: template.irrfDeduction,
          salarioFamilia: template.salarioFamilia,
          notes: template.notes ?? null,
        },
      });
      dependentsCreated++;
      console.log(
        `  + dependente "${name}" (${template.relationship}) → ${user.name}` +
          `${template.irrfDeduction ? ' [IRRF]' : ''}${template.salarioFamilia ? ' [SF]' : ''}`,
      );
    }
  }

  // =====================
  // 2. Empréstimos consignados (3 usuários com folha salva)
  // =====================
  let loansCreated = 0;
  let loansSkipped = 0;
  let loanIndex = 0;

  for (const user of users) {
    if (loanIndex >= LOAN_TEMPLATES.length) break;

    // Folha mais recente do usuário — âncora do desconto persistente.
    const latestPayroll = await prisma.payroll.findFirst({
      where: { userId: user.id },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: { id: true, year: true, month: true },
    });
    if (!latestPayroll) continue; // sem folha salva — tenta o próximo usuário

    // Idempotência: já tem empréstimo ativo? Pula o usuário (e o template).
    const existingLoan = await prisma.payrollDiscount.findFirst({
      where: {
        discountType: 'LOAN',
        isActive: true,
        payroll: { userId: user.id },
      },
      select: { id: true },
    });
    if (existingLoan) {
      loansSkipped++;
      loanIndex++;
      continue;
    }

    const template = LOAN_TEMPLATES[loanIndex];
    const installmentValue =
      Math.round((template.totalAmount / template.installments) * 100) / 100;

    await prisma.payrollDiscount.create({
      data: {
        payrollId: latestPayroll.id,
        discountType: 'LOAN',
        value: new Prisma.Decimal(installmentValue),
        percentage: null,
        reference: `${template.reference} - Total: R$ ${template.totalAmount.toFixed(2)} (${template.installments}x)`,
        isPersistent: true,
        isActive: true,
        totalInstallments: template.installments,
        currentInstallment: 1,
        baseValue: new Prisma.Decimal(template.totalAmount),
      },
    });
    loansCreated++;
    console.log(
      `  + empréstimo "${template.reference}" ${template.installments}× R$ ${installmentValue.toFixed(2)} ` +
        `→ ${user.name} (folha ${latestPayroll.month}/${latestPayroll.year})`,
    );
    loanIndex++;
  }

  console.log(
    `\nDependentes: ${dependentsCreated} criados, ${dependentsSkipped} já existiam.` +
      `\nEmpréstimos: ${loansCreated} criados, ${loansSkipped} já existiam.`,
  );
}

main()
  .catch(error => {
    console.error('Erro no seed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
