/**
 * Finance/HR demo data for the "Área Andressa" review. Complements
 * seed-andressa-workflow-demo.ts (run that first — it creates the demo
 * terminations this script enriches).
 *
 *  - Master loans/advances (PayrollDiscount, isPersistent=true, payrollId=null)
 *    so the colaborador "Empréstimos / Adiantamentos" card + the Empréstimos
 *    page populate.
 *  - Termination payment deadline (paymentDueDate) + rescisórias line items
 *    (TerminationItem) so the Rescisões list shows PRAZO DE PAGAMENTO + LÍQUIDO.
 *  - Bonus adjustments (BonusDiscount) on the most recent bonuses.
 *  - A 5% salary raise (MonetaryValue) on a handful of positions.
 *
 * Idempotent: tagged rows ([SEED-DEMO]) are wiped + recreated; position raises
 * are skipped if already applied today. Safe to re-run.
 *
 * Run: npx tsx scripts/seed-andressa-finance-demo.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TAG = "[SEED-DEMO]";
const today = new Date();
const addDays = (base: Date, d: number) => new Date(base.getTime() + d * 86400000);
const competence = (offsetMonths: number) => {
  const d = new Date(today.getFullYear(), today.getMonth() + offsetMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

async function seedLoans() {
  await prisma.payrollDiscount.deleteMany({
    where: { reference: { contains: TAG }, isPersistent: true, discountType: { in: ["LOAN", "ADVANCE"] } },
  });
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true },
    take: 10,
    orderBy: { name: "asc" },
  });
  const plans = [
    { type: "LOAN", value: 450, total: 12, current: 3, kind: "PAYROLL_CONSIGNED", lender: "Banco Consignado S.A.", ref: "Empréstimo consignado" },
    { type: "LOAN", value: 300, total: 6, current: 1, kind: "COMPANY", lender: null, ref: "Empréstimo da empresa" },
    { type: "ADVANCE", value: 800, total: 1, current: 1, kind: "COMPANY", lender: null, ref: "Adiantamento salarial" },
    { type: "LOAN", value: 250, total: 24, current: 10, kind: "PAYROLL_CONSIGNED", lender: "Crédito Fácil", ref: "Empréstimo consignado" },
    { type: "ADVANCE", value: 500, total: 1, current: 1, kind: "COMPANY", lender: null, ref: "Adiantamento" },
    { type: "LOAN", value: 600, total: 18, current: 5, kind: "PAYROLL_CONSIGNED", lender: "Banco Consignado S.A.", ref: "Empréstimo consignado" },
  ] as const;
  let n = 0;
  for (let i = 0; i < plans.length && i < users.length; i++) {
    const p = plans[i];
    await prisma.payrollDiscount.create({
      data: {
        userId: users[i].id,
        payrollId: null,
        isPersistent: true,
        isActive: true,
        discountType: p.type as any,
        value: p.value,
        totalInstallments: p.total,
        currentInstallment: p.current,
        startCompetence: competence(-(p.current - 1)),
        loanKind: p.kind as any,
        lenderName: p.lender,
        reference: `${TAG} ${p.ref}`,
      },
    });
    n++;
  }
  console.log(`  loans: ${n} master records created`);
}

async function seedTerminationFinance() {
  const terms = await prisma.termination.findMany({
    where: { reason: { contains: TAG } },
    select: { id: true, status: true, type: true, terminationDate: true },
  });
  let items = 0;
  for (const t of terms) {
    // CLT art. 477 §6: payment due within 10 days of the termination date.
    const due = addDays(t.terminationDate ? new Date(t.terminationDate) : today, 10);
    const isPaid = t.status === "COMPLETED";

    await prisma.terminationItem.deleteMany({ where: { terminationId: t.id } });
    const lineItems: { type: string; description: string; amount: number }[] = [
      { type: "SALARY_BALANCE", description: "Saldo de salário", amount: 1400 },
      { type: "THIRTEENTH_PROPORTIONAL", description: "13º proporcional", amount: 1166.67 },
      { type: "PROPORTIONAL_VACATION", description: "Férias proporcionais + 1/3", amount: 1555.55 },
      { type: "INSS_DISCOUNT", description: "INSS", amount: -308 },
      { type: "IRRF_DISCOUNT", description: "IRRF", amount: -120 },
    ];
    if (t.type === "WITHOUT_CAUSE") {
      lineItems.push({ type: "FGTS_FINE", description: "Multa FGTS 40%", amount: 1120 });
    }
    const net = Math.round(lineItems.reduce((s, li) => s + li.amount, 0) * 100) / 100;

    await prisma.terminationItem.createMany({
      data: lineItems.map((li) => ({ terminationId: t.id, type: li.type as any, description: li.description, amount: li.amount })),
    });
    items += lineItems.length;

    await prisma.termination.update({
      where: { id: t.id },
      data: {
        paymentDueDate: due,
        baseRemuneration: 2800,
        paymentDate: isPaid ? due : null,
        paidAmount: isPaid ? net : null,
      },
    });
  }
  console.log(`  terminations: enriched ${terms.length} (prazo de pagamento + ${items} verbas rescisórias)`);
}

async function seedBonusAdjustments() {
  await prisma.bonusDiscount.deleteMany({ where: { reference: { contains: TAG } } });
  const bonuses = await prisma.bonus.findMany({
    select: { id: true },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take: 6,
  });
  const values = [50, 75, 100, 120, 60, 90];
  let n = 0;
  for (let i = 0; i < bonuses.length; i++) {
    await prisma.bonusDiscount.create({
      data: {
        bonusId: bonuses[i].id,
        reference: `${TAG} Ajuste de bonificação`,
        value: values[i % values.length],
        calculationOrder: 1,
      },
    });
    n++;
  }
  console.log(`  bonus adjustments: ${n} created`);
}

async function seedPositionRaises() {
  const todayStr = today.toISOString().slice(0, 10);
  const positions = await prisma.position.findMany({
    select: {
      id: true,
      remunerations: { where: { current: true }, orderBy: { createdAt: "desc" }, take: 1, select: { value: true, effectiveDate: true } },
    },
    orderBy: { name: "asc" },
    take: 6,
  });
  let n = 0;
  for (const pos of positions) {
    const cur = pos.remunerations[0];
    if (!cur) continue;
    // Idempotency: skip if a raise was already applied today.
    if (cur.effectiveDate && new Date(cur.effectiveDate).toISOString().slice(0, 10) === todayStr) continue;
    const newValue = Math.round(cur.value * 1.05 * 100) / 100; // +5%
    await prisma.monetaryValue.updateMany({ where: { positionId: pos.id, current: true }, data: { current: false } });
    await prisma.monetaryValue.create({ data: { positionId: pos.id, value: newValue, current: true, effectiveDate: today } });
    n++;
  }
  console.log(`  position raises: ${n} applied (+5%)`);
}

async function main() {
  console.log("\n=== Seed Andressa finance demo ===\n");
  await seedLoans();
  await seedTerminationFinance();
  await seedBonusAdjustments();
  await seedPositionRaises();
  console.log("\nDone.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
