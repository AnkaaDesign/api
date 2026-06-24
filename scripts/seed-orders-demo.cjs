// Demo seed for ORDERS (pedidos) — creates a varied set to exercise the order UI:
// different payment methods (Pix / Boleto / Cartão / nenhum), single + multi-installment
// boletos, several lifecycle + payment statuses, and some with attached documents
// (orçamentos / notas / recibos) so the detail page's Documentos card shows up.
//
// Idempotent: every row is tagged "[DEMO]" in its description and demo files live under
// path "seed/demo-orders/…"; both are wiped and recreated on each run.
//
//   node scripts/seed-orders-demo.cjs
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEMO_TAG = '[DEMO]';
const DEMO_FILE_PREFIX = 'seed/demo-orders/';

const addDays = (base, n) => new Date(base.getTime() + n * 24 * 60 * 60 * 1000);
const round2 = (n) => Math.round(n * 100) / 100;

// A throwaway File payload for a given kind (orçamento / nota / recibo).
let fileSeq = 0;
const demoFile = (kind, label) => {
  fileSeq += 1;
  const filename = `${DEMO_FILE_PREFIX}${kind}-${fileSeq}.pdf`;
  return {
    filename,
    originalName: `${label}.pdf`,
    mimetype: 'application/pdf',
    path: filename,
    size: 12000 + fileSeq * 137,
  };
};

const itemsTotal = (lines) =>
  lines.reduce((sum, l) => {
    const subtotal = l.orderedQuantity * l.price;
    return sum + subtotal + subtotal * ((l.icms || 0) + (l.ipi || 0)) / 100;
  }, 0);

async function main() {
  const now = new Date();

  // --- references from the existing DB -------------------------------------
  const suppliers = await prisma.supplier.findMany({
    orderBy: { fantasyName: 'asc' },
    select: { id: true, fantasyName: true, cnpj: true },
    take: 8,
  });
  const items = await prisma.item.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
    take: 30,
  });
  const user = await prisma.user.findFirst({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!suppliers.length || items.length < 4) {
    console.error('[SEED-ORDERS] Need at least 1 supplier and 4 active items — aborting.');
    return;
  }
  const supplier = (i) => suppliers[i % suppliers.length];
  let itemCursor = 0;
  const nextItems = (n, shape = []) =>
    Array.from({ length: n }, (_, k) => {
      const it = items[itemCursor++ % items.length];
      const s = shape[k] || {};
      return {
        itemId: it.id,
        orderedQuantity: s.qty ?? (k + 1) * 2,
        price: s.price ?? [49.9, 120, 18.5, 240, 7.25, 380][(itemCursor + k) % 6],
        icms: s.icms ?? 0,
        ipi: s.ipi ?? 0,
        receivedQuantity: s.receivedQuantity ?? 0,
        fulfilledAt: s.fulfilledAt ?? null,
        receivedAt: s.receivedAt ?? null,
      };
    });

  // --- idempotent cleanup ---------------------------------------------------
  const wiped = await prisma.order.deleteMany({ where: { description: { startsWith: DEMO_TAG } } });
  const wipedFiles = await prisma.file.deleteMany({ where: { path: { startsWith: DEMO_FILE_PREFIX } } });
  console.log(`[SEED-ORDERS] cleared ${wiped.count} demo orders + ${wipedFiles.count} demo files`);

  // --- the demo matrix ------------------------------------------------------
  // Each entry returns a Prisma order create payload.
  const specs = [];

  // 1) Pix · Aguardando · Criado · sem documentos
  {
    const lines = nextItems(2);
    specs.push({
      description: `${DEMO_TAG} Pix — Aguardando (sem documentos)`,
      supplierId: supplier(0).id,
      status: 'CREATED',
      statusOrder: 1,
      forecast: addDays(now, 7),
      paymentMethod: 'PIX',
      paymentPix: supplier(0).cnpj || '12.345.678/0001-90',
      paymentStatus: 'AWAITING_PAYMENT',
      paymentStatusOrder: 1,
      installmentCount: 1,
      items: { create: lines },
    });
  }

  // 2) Pix · Pago · Recebido · com orçamento + nota + recibo
  {
    const lines = nextItems(3, [
      { qty: 4, price: 89.9, receivedQuantity: 4, fulfilledAt: addDays(now, -5), receivedAt: addDays(now, -2) },
      { qty: 2, price: 320, icms: 12, receivedQuantity: 2, fulfilledAt: addDays(now, -5), receivedAt: addDays(now, -2) },
      { qty: 6, price: 15.5, receivedQuantity: 6, fulfilledAt: addDays(now, -5), receivedAt: addDays(now, -2) },
    ]);
    specs.push({
      description: `${DEMO_TAG} Pix — Pago e Recebido (com documentos)`,
      supplierId: supplier(1).id,
      status: 'RECEIVED',
      statusOrder: 6,
      forecast: addDays(now, -3),
      freight: 45,
      discount: 5,
      paymentMethod: 'PIX',
      paymentPix: supplier(1).cnpj || '98.765.432/0001-10',
      paymentStatus: 'PAID',
      paymentStatusOrder: 3,
      paidAt: addDays(now, -1),
      paidById: user?.id || null,
      paymentResponsibleId: user?.id || null,
      installmentCount: 1,
      items: { create: lines },
      // Order no longer has budgets/invoices relations — all demo documents now
      // attach to the surviving receipts (File[]) relation, which is what the
      // detail page's Documentos card reads.
      receipts: { create: [
        demoFile('orcamento', 'Orçamento Fornecedor'),
        demoFile('nota', 'NF-e 001234'),
        demoFile('recibo', 'Comprovante Pix'),
      ] },
    });
  }

  // 3) Boleto 3x · Aguardando · Feito · com orçamento + nota + parcelas
  {
    const lines = nextItems(2, [
      { qty: 10, price: 240, fulfilledAt: addDays(now, -1) },
      { qty: 5, price: 76.4, ipi: 5, fulfilledAt: addDays(now, -1) },
    ]);
    const total = round2(itemsTotal(lines) + 60);
    const per = round2(total / 3);
    const firstDue = addDays(now, 30);
    specs.push({
      description: `${DEMO_TAG} Boleto 3x — Aguardando (Feito, com parcelas)`,
      supplierId: supplier(2).id,
      status: 'FULFILLED',
      statusOrder: 3,
      forecast: addDays(now, 10),
      freight: 60,
      paymentMethod: 'BANK_SLIP',
      paymentDueDays: 30,
      paymentFirstDueDate: firstDue,
      paymentStatus: 'AWAITING_PAYMENT',
      paymentStatusOrder: 1,
      installmentCount: 3,
      paymentResponsibleId: user?.id || null,
      items: { create: lines },
      receipts: { create: [
        demoFile('orcamento', 'Orçamento Boleto'),
        demoFile('nota', 'NF-e 004567'),
      ] },
      installments: {
        create: [1, 2, 3].map((n) => ({
          number: n,
          dueDate: addDays(firstDue, (n - 1) * 30),
          amount: n === 3 ? round2(total - per * 2) : per,
          status: 'PENDING',
        })),
      },
    });
  }

  // 4) Boleto 2x · Parcialmente Pago · Parcialmente Recebido (1ª parcela paga)
  {
    const lines = nextItems(2, [
      { qty: 8, price: 130, receivedQuantity: 8, fulfilledAt: addDays(now, -8), receivedAt: addDays(now, -4) },
      { qty: 3, price: 410, receivedQuantity: 0, fulfilledAt: addDays(now, -8) },
    ]);
    const total = round2(itemsTotal(lines));
    const per = round2(total / 2);
    const firstDue = addDays(now, -10);
    specs.push({
      description: `${DEMO_TAG} Boleto 2x — Parcialmente Pago e Recebido`,
      supplierId: supplier(3).id,
      status: 'PARTIALLY_RECEIVED',
      statusOrder: 5,
      forecast: addDays(now, -2),
      paymentMethod: 'BANK_SLIP',
      paymentDueDays: 30,
      paymentFirstDueDate: firstDue,
      paymentStatus: 'PARTIALLY_PAID',
      paymentStatusOrder: 2,
      installmentCount: 2,
      paymentResponsibleId: user?.id || null,
      items: { create: lines },
      receipts: { create: [demoFile('nota', 'NF-e 007788')] },
      installments: {
        create: [
          { number: 1, dueDate: firstDue, amount: per, paidAmount: per, status: 'PAID', paidAt: addDays(now, -9), paidById: user?.id || null },
          { number: 2, dueDate: addDays(firstDue, 30), amount: round2(total - per), status: 'PENDING' },
        ],
      },
    });
  }

  // 5) Cartão de Crédito · Pago · Recebido · com nota
  {
    const lines = nextItems(2, [
      { qty: 1, price: 1290, receivedQuantity: 1, fulfilledAt: addDays(now, -6), receivedAt: addDays(now, -3) },
      { qty: 4, price: 58, icms: 18, receivedQuantity: 4, fulfilledAt: addDays(now, -6), receivedAt: addDays(now, -3) },
    ]);
    specs.push({
      description: `${DEMO_TAG} Cartão de Crédito — Pago e Recebido`,
      supplierId: supplier(4).id,
      status: 'RECEIVED',
      statusOrder: 6,
      forecast: addDays(now, -4),
      paymentMethod: 'CREDIT_CARD',
      paymentStatus: 'PAID',
      paymentStatusOrder: 3,
      paidAt: addDays(now, -2),
      paidById: user?.id || null,
      paymentResponsibleId: user?.id || null,
      installmentCount: 1,
      items: { create: lines },
      receipts: { create: [demoFile('nota', 'NF-e 009900')] },
    });
  }

  // 6) Sem método de pagamento · Aguardando · Criado · com orçamento
  {
    const lines = nextItems(2);
    specs.push({
      description: `${DEMO_TAG} Sem método — Aguardando (com orçamento)`,
      supplierId: supplier(5).id,
      status: 'CREATED',
      statusOrder: 1,
      forecast: addDays(now, 14),
      paymentStatus: 'AWAITING_PAYMENT',
      paymentStatusOrder: 1,
      installmentCount: 1,
      items: { create: lines },
      receipts: { create: [demoFile('orcamento', 'Orçamento Inicial'), demoFile('orcamento', 'Orçamento Concorrente')] },
    });
  }

  // 7) Boleto 1x · Atrasado (OVERDUE) · vencimento no passado · com nota
  {
    const lines = nextItems(2, [
      { qty: 6, price: 95, fulfilledAt: addDays(now, -20) },
      { qty: 2, price: 260, fulfilledAt: addDays(now, -20) },
    ]);
    const total = round2(itemsTotal(lines));
    const firstDue = addDays(now, -5);
    specs.push({
      description: `${DEMO_TAG} Boleto 1x — Atrasado (vencido)`,
      supplierId: supplier(6).id,
      status: 'OVERDUE',
      statusOrder: 4,
      forecast: addDays(now, -7),
      paymentMethod: 'BANK_SLIP',
      paymentFirstDueDate: firstDue,
      paymentStatus: 'AWAITING_PAYMENT',
      paymentStatusOrder: 1,
      installmentCount: 1,
      paymentResponsibleId: user?.id || null,
      items: { create: lines },
      receipts: { create: [demoFile('nota', 'NF-e 003322')] },
      installments: { create: [{ number: 1, dueDate: firstDue, amount: total, status: 'PENDING' }] },
    });
  }

  // --- create -----------------------------------------------------------------
  let created = 0;
  for (const spec of specs) {
    const order = await prisma.order.create({ data: spec, select: { id: true, orderNumber: true, description: true } });
    created += 1;
    console.log(`  ✓ #${order.orderNumber ?? '—'}  ${order.description}`);
  }

  console.log(`[SEED-ORDERS] created ${created} demo orders (supplier pool: ${suppliers.length}, item pool: ${items.length}).`);
}

main()
  .catch((e) => {
    console.error('[SEED-ORDERS] failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
