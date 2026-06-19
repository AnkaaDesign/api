/**
 * Demo data for the newest features that had NO seed yet:
 *
 *   1. Férias (Vacation redesign 2026-06-17) — vacations spread across active CLT
 *      employees in the three statuses AGENDADA/PAGA/VENCIDA (SCHEDULED/PAID/EXPIRED),
 *      with acquisitive/concessive periods, 1/3 constitucional and payment dates.
 *   2. Contas Recorrentes (Recurrent payables 2026-06-18) — recurring monthly bills
 *      (Aluguel, Energia, Água, Internet, Contabilidade, Monitoramento) each with
 *      ~6 months of occurrences: past months PAID, current month PENDING, one OVERDUE.
 *   3. Contas a Receber / Entrada conciliation (2026-06-18) — customer Invoices with
 *      Installments, some settled by a matched CREDIT bank inflow (ReconciliationMatch
 *      installment bridge), others still open/overdue.
 *
 * Idempotent: every row this script creates is tagged with [SEED-DEMO] (in notes /
 * description / memo) and is wiped + recreated on each run. Safe to re-run.
 *
 * Run:  cd api && npx tsx scripts/seed-latest-features-demo.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const TAG = '[SEED-DEMO]';
const FIT_PREFIX = 'SEEDDEMO';

const today = new Date();
const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
const addMonths = (base: Date, n: number) => {
  const d = new Date(base.getTime());
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
};
const addDays = (base: Date, n: number) => new Date(base.getTime() + n * 86400000);
const competenceOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const money = (n: number) => new Prisma.Decimal(n.toFixed(2));

// ---------------------------------------------------------------------------
// 1. FÉRIAS
// ---------------------------------------------------------------------------
async function seedVacations(): Promise<void> {
  console.log('\n=== 1. Férias ===');
  await prisma.vacation.deleteMany({ where: { notes: { contains: TAG } } });

  const users = await prisma.user.findMany({
    where: {
      currentContractStatus: 'ACTIVE',
      currentEmployeeType: 'CLT',
      currentContractId: { not: null },
    },
    select: {
      id: true,
      name: true,
      currentContractId: true,
      currentContract: { select: { admissionDate: true } },
    },
    orderBy: { name: 'asc' },
  });

  if (users.length === 0) {
    console.log('  Nenhum colaborador CLT ativo — nada a fazer.');
    return;
  }

  // Latest base remuneration per user (fallback to a default).
  const payrolls = await prisma.payroll.findMany({
    where: { userId: { in: users.map(u => u.id) } },
    select: { userId: true, baseRemuneration: true, year: true, month: true },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });
  const baseByUser = new Map<string, number>();
  for (const p of payrolls) if (!baseByUser.has(p.userId)) baseByUser.set(p.userId, Number(p.baseRemuneration));

  type VacData = Prisma.VacationCreateManyInput;
  const rows: VacData[] = [];
  let scheduled = 0;
  let paid = 0;
  let expired = 0;

  users.forEach((u, i) => {
    const base = baseByUser.get(u.id) ?? 2000;
    const oneThird = base / 3;
    const bucket = i % 3; // 0 PAID, 1 SCHEDULED, 2 EXPIRED

    if (bucket === 0) {
      // PAGA — gozo recente já encerrado.
      const acqStart = at(today.getUTCFullYear() - 2, 1, 1);
      const start = addMonths(today, -3);
      rows.push({
        userId: u.id,
        contractId: u.currentContractId,
        acquisitiveStart: acqStart,
        acquisitiveEnd: addMonths(acqStart, 12),
        concessiveEnd: addMonths(acqStart, 24),
        startDate: start,
        days: 30,
        entitledDays: 30,
        status: 'PAID',
        baseRemuneration: money(base),
        oneThird: money(oneThird),
        paymentDueDate: addDays(start, -2),
        paymentDate: addDays(start, -2),
        notes: `Férias 30 dias gozadas ${TAG}`,
      });
      paid++;
    } else if (bucket === 1) {
      // AGENDADA — gozo futuro planejado.
      const acqStart = at(today.getUTCFullYear() - 1, 1, 1);
      const start = addMonths(today, 1);
      rows.push({
        userId: u.id,
        contractId: u.currentContractId,
        acquisitiveStart: acqStart,
        acquisitiveEnd: addMonths(acqStart, 12),
        concessiveEnd: addMonths(acqStart, 24),
        startDate: start,
        days: 30,
        entitledDays: 30,
        status: 'SCHEDULED',
        baseRemuneration: money(base),
        oneThird: money(oneThird),
        paymentDueDate: addDays(start, -2),
        notes: `Férias agendadas ${TAG}`,
      });
      scheduled++;
    } else {
      // VENCIDA — período concessivo expirou sem gozo (art. 137 — dobro).
      const acqStart = at(today.getUTCFullYear() - 3, 1, 1);
      rows.push({
        userId: u.id,
        contractId: u.currentContractId,
        acquisitiveStart: acqStart,
        acquisitiveEnd: addMonths(acqStart, 12),
        concessiveEnd: addMonths(acqStart, 24), // já no passado
        startDate: null,
        days: 0,
        entitledDays: 30,
        status: 'EXPIRED',
        isDouble: true,
        baseRemuneration: money(base),
        oneThird: money(oneThird),
        notes: `Férias vencidas (dobro art. 137) ${TAG}`,
      });
      expired++;
    }
  });

  await prisma.vacation.createMany({ data: rows });
  console.log(`  ${rows.length} férias criadas — PAGA: ${paid}, AGENDADA: ${scheduled}, VENCIDA: ${expired}`);
}

// ---------------------------------------------------------------------------
// 2. CONTAS RECORRENTES
// ---------------------------------------------------------------------------
const PAYABLE_TEMPLATES = [
  { categorySlug: 'aluguel', name: 'Aluguel do galpão', amountKind: 'FIXED', amount: 4500, dueDay: 5, method: 'BANK_SLIP', payee: 'Imobiliária Central', expectsNf: false },
  { categorySlug: 'energia-eletrica', name: 'Energia Elétrica (CPFL)', amountKind: 'VARIABLE', amount: 1250, dueDay: 10, method: 'BANK_SLIP', payee: 'CPFL Energia', expectsNf: true },
  { categorySlug: 'agua', name: 'Água e Esgoto (SAAE)', amountKind: 'VARIABLE', amount: 380, dueDay: 15, method: 'BANK_SLIP', payee: 'SAAE', expectsNf: true },
  { categorySlug: 'internet-telefone', name: 'Internet / Telefone', amountKind: 'FIXED', amount: 620, dueDay: 20, method: 'PIX', payee: 'Vivo Empresas', expectsNf: true },
  { categorySlug: 'contabilidade', name: 'Honorários Contábeis', amountKind: 'FIXED', amount: 1800, dueDay: 5, method: 'PIX', payee: 'Escritório Contábil', expectsNf: true },
  { categorySlug: 'monitoramento', name: 'Monitoramento / Alarme', amountKind: 'FIXED', amount: 280, dueDay: 8, method: 'BANK_SLIP', payee: 'Verisure', expectsNf: false },
] as const;

async function seedRecurrentPayables(): Promise<void> {
  console.log('\n=== 2. Contas Recorrentes ===');
  // Cascade deletes occurrences.
  await prisma.recurrentPayable.deleteMany({ where: { description: { contains: TAG } } });

  const cats = await prisma.transactionCategory.findMany({
    where: { slug: { in: PAYABLE_TEMPLATES.map(t => t.categorySlug) } },
    select: { id: true, slug: true },
  });
  const catBySlug = new Map(cats.map(c => [c.slug, c.id]));

  let payablesCreated = 0;
  let occCreated = 0;

  for (const t of PAYABLE_TEMPLATES) {
    const categoryId = catBySlug.get(t.categorySlug);
    if (!categoryId) {
      console.log(`  ! categoria '${t.categorySlug}' inexistente — pulando ${t.name}`);
      continue;
    }
    const isFixed = t.amountKind === 'FIXED';
    const payable = await prisma.recurrentPayable.create({
      data: {
        name: t.name,
        description: `Conta recorrente mensal ${TAG}`,
        payeeName: t.payee,
        categoryId,
        amountKind: t.amountKind,
        fixedAmount: isFixed ? money(t.amount) : null,
        estimatedAmount: money(t.amount),
        frequency: 'MONTHLY',
        frequencyCount: 1,
        dueDayOfMonth: t.dueDay,
        paymentMethod: t.method,
        expectsNf: t.expectsNf,
        isActive: true,
        nextRun: at(today.getUTCFullYear(), today.getUTCMonth() + 1, t.dueDay),
      },
    });
    payablesCreated++;

    // Occurrences: 5 meses passados (PAGA) + mês atual (PENDENTE) + 1 vencida.
    const occ: Prisma.RecurrentPayableOccurrenceCreateManyInput[] = [];
    for (let back = 5; back >= 0; back--) {
      const ref = addMonths(today, -back);
      const competence = competenceOf(ref);
      const dueDate = at(ref.getUTCFullYear(), ref.getUTCMonth() + 1, t.dueDay);
      // VARIABLE bills vary ±12% around the estimate; FIXED stay flat.
      const variance = isFixed ? 1 : 1 + (((back * 37) % 25) - 12) / 100;
      const real = Math.round(t.amount * variance * 100) / 100;
      if (back === 0) {
        // Mês atual: ainda em aberto.
        occ.push({ recurrentPayableId: payable.id, competence, dueDate, estimatedAmount: money(t.amount), status: 'PENDING', expectsNf: t.expectsNf });
      } else if (back === 1) {
        // Mês anterior: vencida não paga (exibe estado OVERDUE).
        occ.push({ recurrentPayableId: payable.id, competence, dueDate, estimatedAmount: money(t.amount), status: 'OVERDUE', expectsNf: t.expectsNf });
      } else {
        occ.push({
          recurrentPayableId: payable.id,
          competence,
          dueDate,
          estimatedAmount: money(t.amount),
          paidAmount: money(real),
          status: 'PAID',
          paidAt: addDays(dueDate, -1),
          paymentMethod: t.method,
          expectsNf: t.expectsNf,
        });
      }
    }
    await prisma.recurrentPayableOccurrence.createMany({ data: occ });
    occCreated += occ.length;
  }

  console.log(`  ${payablesCreated} contas recorrentes + ${occCreated} ocorrências (mensais) criadas`);
}

// ---------------------------------------------------------------------------
// 3. CONTAS A RECEBER / ENTRADA CONCILIATION
// ---------------------------------------------------------------------------
async function seedReceivables(): Promise<void> {
  console.log('\n=== 3. Contas a Receber / Entrada ===');

  // Cleanup (matches → installments → invoices → bank transactions). Matches FK
  // installments with onDelete Restrict, so they must go first.
  const demoTxns = await prisma.bankTransaction.findMany({
    where: { fitId: { startsWith: FIT_PREFIX } },
    select: { id: true },
  });
  if (demoTxns.length) {
    await prisma.reconciliationMatch.deleteMany({ where: { transactionId: { in: demoTxns.map(t => t.id) } } });
  }
  const demoInvoices = await prisma.invoice.findMany({ where: { notes: { contains: TAG } }, select: { id: true } });
  if (demoInvoices.length) {
    await prisma.installment.deleteMany({ where: { invoiceId: { in: demoInvoices.map(i => i.id) } } });
    await prisma.invoice.deleteMany({ where: { id: { in: demoInvoices.map(i => i.id) } } });
  }
  if (demoTxns.length) {
    await prisma.bankTransaction.deleteMany({ where: { id: { in: demoTxns.map(t => t.id) } } });
  }

  const admin = await prisma.user.findFirst({
    where: { sector: { privileges: 'ADMIN' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  const customers = await prisma.customer.findMany({
    where: { fantasyName: { not: '' } },
    select: { id: true, fantasyName: true, cnpj: true },
    orderBy: { fantasyName: 'asc' },
    take: 9,
  });
  if (customers.length === 0) {
    console.log('  Nenhum cliente cadastrado — nada a fazer.');
    return;
  }

  let invoices = 0;
  let installments = 0;
  let matches = 0;
  let fitSeq = 0;

  for (let i = 0; i < customers.length; i++) {
    const cust = customers[i];
    const bucket = i % 3; // 0 PAID, 1 PARTIALLY_PAID, 2 ACTIVE (open/overdue)
    const nInstallments = 2 + (i % 2); // 2 or 3
    const perInstallment = 1500 + (i % 4) * 350;
    const total = perInstallment * nInstallments;

    const invoiceStatus = bucket === 0 ? 'PAID' : bucket === 1 ? 'PARTIALLY_PAID' : 'ACTIVE';
    let invoicePaid = 0;

    const invoice = await prisma.invoice.create({
      data: {
        customerId: cust.id,
        totalAmount: money(total),
        status: invoiceStatus,
        createdById: admin?.id ?? null,
        notes: `Fatura demo ${cust.fantasyName} ${TAG}`,
      },
    });
    invoices++;

    for (let n = 1; n <= nInstallments; n++) {
      // First installment due 2 months ago, then monthly.
      const dueDate = addMonths(at(today.getUTCFullYear(), today.getUTCMonth() + 1, 10), n - 3);
      let status: string;
      let settle = false;
      if (bucket === 0) {
        status = 'PAID';
        settle = true;
      } else if (bucket === 1) {
        // First paid, the rest open.
        if (n === 1) {
          status = 'PAID';
          settle = true;
        } else {
          status = 'PENDING';
        }
      } else {
        // Open invoice: anything already past due is OVERDUE, else PENDING.
        status = dueDate < today ? 'OVERDUE' : 'PENDING';
      }

      const installment = await prisma.installment.create({
        data: {
          invoiceId: invoice.id,
          number: n,
          dueDate,
          amount: money(perInstallment),
          paidAmount: settle ? money(perInstallment) : money(0),
          paidAt: settle ? addDays(dueDate, -1) : null,
          status: status as any,
          paymentMethod: settle ? 'PIX' : null,
          observations: `Parcela ${n}/${nInstallments} ${TAG}`,
        },
      });
      installments++;

      if (settle) {
        invoicePaid += perInstallment;
        // Matched CREDIT inflow (entrada) → ReconciliationMatch installment bridge.
        const postedAt = addDays(dueDate, -1);
        const txn = await prisma.bankTransaction.create({
          data: {
            bankCode: '748',
            bankName: 'Sicredi',
            agency: '0710',
            accountNumber: '12345-6',
            fitId: `${FIT_PREFIX}${String(++fitSeq).padStart(5, '0')}`,
            postedAt,
            amount: money(perInstallment),
            type: 'CREDIT',
            subtype: i % 2 === 0 ? 'PIX' : 'TED',
            memo: `Recebimento ${cust.fantasyName} parc ${n} ${TAG}`,
            counterpartyName: cust.fantasyName,
            counterpartyCnpjCpf: cust.cnpj ?? null,
            reconciliationStatus: 'RECONCILED',
            reconciliationSource: 'MANUAL',
            classifiedAt: postedAt,
          },
        });
        await prisma.reconciliationMatch.create({
          data: {
            transactionId: txn.id,
            installmentId: installment.id,
            allocatedAmount: money(perInstallment),
            matchType: i % 2 === 0 ? 'EXACT' : 'MANUAL',
            confidenceScore: 100,
            matchedByUserId: admin?.id ?? null,
            notes: `Entrada conciliada ${TAG}`,
          },
        });
        matches++;
      }
    }

    if (invoicePaid > 0) {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { paidAmount: money(invoicePaid) } });
    }
  }

  console.log(`  ${invoices} faturas + ${installments} parcelas + ${matches} entradas conciliadas (CREDIT↔parcela) criadas`);
}

async function main(): Promise<void> {
  console.log('Seed das últimas funcionalidades (Férias, Contas Recorrentes, Contas a Receber)');
  await seedVacations();
  await seedRecurrentPayables();
  await seedReceivables();
  console.log('\nConcluído.');
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
