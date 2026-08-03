/**
 * Integração da conciliação por tarefa (ReceivableTaskMatchService).
 *
 * Exercita o serviço REAL contra um Postgres REAL: cunha orçamento, fatura e
 * parcela para tarefas que perderam o orçamento na migração, aloca o dinheiro e
 * confere o estado que ficou gravado. É o único teste que cobre a construção da
 * espinha de recebíveis — a lógica pura está em tests/task-match-allocation.test.ts.
 *
 * PRECISA DE UM BANCO DESCARTÁVEL. Ele APAGA tarefas, orçamentos, faturas,
 * parcelas, clientes e transações, então recusa-se a rodar sem uma URL explícita
 * e recusa-se a tocar em qualquer banco com "production" no nome.
 *
 * Preparar (uma vez):
 *
 *   createdb ankaa_taskmatch_test
 *   psql ankaa_taskmatch_test -c "CREATE SEQUENCE order_number_seq; \
 *     CREATE SEQUENCE supplier_number_seq; CREATE EXTENSION unaccent; \
 *     CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text \
 *     LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS \
 *     \$\$ SELECT public.unaccent('public.unaccent'::regdictionary, \$1) \$\$"
 *   TASK_MATCH_TEST_DATABASE_URL=postgresql://user:pw@127.0.0.1:5432/ankaa_taskmatch_test \
 *     DATABASE_URL=$TASK_MATCH_TEST_DATABASE_URL pnpm prisma db push --skip-generate
 *
 * Observação: `prisma migrate deploy` NÃO funciona num banco vazio — a migração
 * 20260406000000_consolidated_schema_update quebra no replay com
 * "relation Item_isManualMaxQuantity_idx already exists". Por isso `db push`,
 * mais as três pré-condições acima que o schema.prisma sozinho não cria.
 *
 * Rodar: pnpm test:task-match:integration
 */
import { PrismaClient } from '@prisma/client';
import { ReceivableTaskMatchService } from '../src/modules/financial/reconciliation/receivable-task-match.service';
import { TaskQuoteStatusCascadeService } from '../src/modules/production/task-quote/task-quote-status-cascade.service';

const url = process.env.TASK_MATCH_TEST_DATABASE_URL;
if (!url) {
  console.error(
    '\nTASK_MATCH_TEST_DATABASE_URL não definida.\n' +
      'Este teste APAGA dados. Aponte-o para um banco descartável — veja o cabeçalho.\n',
  );
  process.exit(1);
}
// Cinto e suspensório: nunca, em hipótese alguma, contra produção.
// Só o NOME DO BANCO é inspecionado — o usuário costuma se chamar `ankaa_prod`
// mesmo em bancos descartáveis, e olhar a URL inteira bloquearia tudo.
const dbName = (() => {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return url;
  }
})();
if (/production|^prod|_prod$/i.test(dbName)) {
  console.error(`\nRecusando rodar: o banco "${dbName}" parece de produção.\n`);
  process.exit(1);
}
if (!/test/i.test(dbName)) {
  console.error(
    `\nRecusando rodar: o banco "${dbName}" não tem "test" no nome.\n` +
      'Este teste APAGA dados — use um banco descartável.\n',
  );
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

// The cascade dispatches notifications; stub the dispatcher, keep the real cascade.
const dispatchStub: any = { dispatchByConfiguration: async () => undefined };
const cascade = new TaskQuoteStatusCascadeService(prisma as any, dispatchStub);
const svc = new ReceivableTaskMatchService(prisma as any, cascade);

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const D = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const money = (v: any) => Number(v);

let USER_ID = '';
let SECTOR_ID = '';

async function reset() {
  // Order matters only where FKs are RESTRICT.
  await prisma.reconciliationMatch.deleteMany({});
  await prisma.bankTransactionCategory.deleteMany({});
  await prisma.bankSlip.deleteMany({});
  await prisma.installment.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.task.updateMany({ data: { quoteId: null } });
  await prisma.taskQuoteService.deleteMany({});
  await prisma.taskQuoteCustomerConfig.deleteMany({});
  await prisma.taskQuote.deleteMany({});
  await prisma.truck.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.bankTransaction.deleteMany({});
  await prisma.customer.deleteMany({});
}

async function bootstrap() {
  // Idempotent: reset() clears business rows but keeps the operator/sector.
  const sector =
    (await prisma.sector.findFirst({ where: { name: 'Financeiro Teste' } })) ??
    (await prisma.sector.create({ data: { name: 'Financeiro Teste', privileges: 'FINANCIAL' as any } }));
  SECTOR_ID = sector.id;
  const user =
    (await prisma.user.findFirst({ where: { email: 'op.teste@ankaa.local' } })) ??
    (await prisma.user.create({
      data: { name: 'Operador Teste', email: 'op.teste@ankaa.local', sectorId: sector.id },
    }));
  USER_ID = user.id;
}

async function mkCustomer(fantasyName: string, cnpj: string) {
  return prisma.customer.create({
    data: {
      fantasyName,
      corporateName: `${fantasyName} LTDA`,
      cnpj,
      fantasyNameNormalized: norm(fantasyName),
      corporateNameNormalized: norm(`${fantasyName} LTDA`),
      cnpjNormalized: cnpj,
    },
  });
}

async function mkTask(name: string, serial: string, customerId: string | null, plate?: string) {
  const task = await prisma.task.create({
    data: {
      name,
      serialNumber: serial,
      status: 'COMPLETED' as any,
      statusOrder: 4,
      finishedAt: D('2026-07-10'),
      customerId,
      nameNormalized: norm(name),
      serialNumberNormalized: norm(serial),
    },
  });
  if (plate) {
    await prisma.truck.create({
      data: { taskId: task.id, plate, plateNormalized: norm(plate) },
    });
  }
  return task;
}

async function mkCredit(amount: number, cnpj: string | null, name: string | null, fitId: string, postedAt = D('2026-07-15')) {
  return prisma.bankTransaction.create({
    data: {
      bankCode: '748', bankName: 'Sicredi', agency: '0710', accountNumber: '12345678',
      fitId, postedAt, amount, type: 'CREDIT' as any, subtype: 'PIX' as any,
      memo: `PAGAMENTO PIX-PIX_CRED ${cnpj ?? ''} ${name ?? ''}`.trim(),
      counterpartyCnpjCpf: cnpj, counterpartyName: name,
      reconciliationStatus: 'PENDING' as any,
    },
  });
}

/** Full billed quote: quote → config → invoice → installments. */
async function mkBilledQuote(taskId: string, customerId: string, total: number, parts: number[]) {
  const max = await prisma.taskQuote.aggregate({ _max: { budgetNumber: true } });
  const quote = await prisma.taskQuote.create({
    data: {
      budgetNumber: (max._max.budgetNumber ?? 0) + 1,
      subtotal: total, total, expiresAt: D('2026-12-31'),
      status: 'BILLING_APPROVED' as any, statusOrder: 4, billingApprovedAt: new Date(),
      services: { create: [{ description: 'Serviço comercial', amount: total, position: 0 }] },
      customerConfigs: { create: [{ customerId, subtotal: total, total }] },
    },
    include: { customerConfigs: true },
  });
  await prisma.task.update({ where: { id: taskId }, data: { quoteId: quote.id } });
  const configId = quote.customerConfigs[0].id;
  const invoice = await prisma.invoice.create({
    data: { customerConfigId: configId, taskId, customerId, totalAmount: total, status: 'ACTIVE' as any },
  });
  let n = 1;
  for (const amt of parts) {
    await prisma.installment.create({
      data: { customerConfigId: configId, invoiceId: invoice.id, number: n++, dueDate: D('2026-07-20'), amount: amt, status: 'PENDING' as any },
    });
  }
  return quote;
}

/** Approved-but-unbilled quote: configs with totals, no invoice, no parcelas. */
async function mkUnbilledQuote(taskId: string, customerId: string, total: number) {
  const max = await prisma.taskQuote.aggregate({ _max: { budgetNumber: true } });
  const quote = await prisma.taskQuote.create({
    data: {
      budgetNumber: (max._max.budgetNumber ?? 0) + 1,
      subtotal: total, total, expiresAt: D('2026-12-31'),
      status: 'BUDGET_APPROVED' as any, statusOrder: 3,
      services: { create: [{ description: 'Serviço orçado', amount: total, position: 0 }] },
      customerConfigs: { create: [{ customerId, subtotal: total, total }] },
    },
  });
  await prisma.task.update({ where: { id: taskId }, data: { quoteId: quote.id } });
  return quote;
}

async function quoteOf(taskId: string) {
  const t = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { quoteId: true, quote: { select: { id: true, status: true, total: true, subtotal: true, budgetNumber: true, services: true, customerConfigs: { select: { id: true, total: true, subtotal: true, installments: true, invoice: true } } } } },
  });
  return t.quote;
}

async function main() {
  await reset();
  await bootstrap();

  // =========================================================================
  console.log('\n1. Tarefa SEM orçamento — o caso da migração');
  {
    const cust = await mkCustomer('Transportes Alfa', '07895343000170');
    const task = await mkTask('Baú Carga Seca', 'OS-1001', cust.id, 'ABC1D23');
    const tx = await mkCredit(5000, '07895343000170', 'TRANSPORTES ALFA', 'FIT-1');

    const cands = await svc.getTaskCandidates(tx.id);
    check('a tarefa aparece por identidade (CNPJ do crédito)', cands.some(c => c.taskId === task.id));
    const c = cands.find(x => x.taskId === task.id)!;
    check('estado é NO_QUOTE', c.billingState === 'NO_QUOTE', c?.billingState);
    check('capacidade em aberto é zero', c.openCapacity === 0);
    check('sugere o crédito inteiro', c.suggestedAmount === 5000, String(c.suggestedAmount));
    check('confiança alta com CNPJ exato', c.confidence >= 60, String(c.confidence));

    const res = await svc.matchTasks(tx.id, [{ taskId: task.id, amount: 5000 }], USER_ID);
    check('orçamento foi criado', res.data.outcomes[0].quoteCreated === true);

    const q = await quoteOf(task.id);
    check('tarefa agora tem orçamento', !!q);
    check('preço do orçamento = valor do crédito', money(q!.total) === 5000, String(q?.total));
    check('tem 1 serviço', q!.services.length === 1);
    check('valor do serviço confere', money(q!.services[0].amount) === 5000);
    check('config de faturamento criada', q!.customerConfigs.length === 1);
    check('fatura criada', !!q!.customerConfigs[0].invoice);
    check('1 parcela criada', q!.customerConfigs[0].installments.length === 1);
    check('parcela quitada', q!.customerConfigs[0].installments[0].status === 'PAID');

    // O ponto que o usuário levantou: a conciliação liquida o orçamento sozinha.
    check('orçamento LIQUIDADO pelo cascade', q!.status === 'SETTLED', q?.status);

    const txAfter = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    check('crédito RECONCILED', txAfter.reconciliationStatus === 'RECONCILED');
    check('fonte MANUAL', txAfter.reconciliationSource === 'MANUAL');

    const matches = await prisma.reconciliationMatch.findMany({ where: { transactionId: tx.id } });
    check('1 match ancorado em parcela', matches.length === 1 && !!matches[0].installmentId);
    check('match é MANUAL 100%', matches[0].matchType === 'MANUAL' && matches[0].confidenceScore === 100);
    check('operador registrado', matches[0].matchedByUserId === USER_ID);

    const inv = await prisma.invoice.findFirstOrThrow({ where: { taskId: task.id } });
    check('fatura PAGA', inv.status === 'PAID', inv.status);
    check('fatura ligada à tarefa (Invoice.taskId)', inv.taskId === task.id);
  }

  // =========================================================================
  console.log('\n2. UM crédito → VÁRIAS tarefas (PIX de lote)');
  {
    await reset(); await bootstrap();
    const cust = await mkCustomer('Transportes Beta', '11222333000181');
    const t1 = await mkTask('Job A', 'OS-2001', cust.id);
    const t2 = await mkTask('Job B', 'OS-2002', cust.id);
    const t3 = await mkTask('Job C', 'OS-2003', cust.id);
    const tx = await mkCredit(9000, '11222333000181', 'TRANSPORTES BETA', 'FIT-2');

    const res = await svc.matchTasks(tx.id, [
      { taskId: t1.id, amount: 4000 },
      { taskId: t2.id, amount: 3000 },
      { taskId: t3.id, amount: 2000 },
    ], USER_ID);

    check('3 resultados', res.data.outcomes.length === 3);
    check('3 orçamentos criados', res.data.outcomes.every(o => o.quoteCreated));
    check('total alocado = crédito', res.data.totalAllocated === 9000);

    const q1 = await quoteOf(t1.id), q2 = await quoteOf(t2.id), q3 = await quoteOf(t3.id);
    check('preços independentes e corretos',
      money(q1!.total) === 4000 && money(q2!.total) === 3000 && money(q3!.total) === 2000,
      `${q1?.total}/${q2?.total}/${q3?.total}`);
    check('os três liquidados',
      [q1, q2, q3].every(q => q!.status === 'SETTLED'));
    check('budgetNumbers distintos',
      new Set([q1!.budgetNumber, q2!.budgetNumber, q3!.budgetNumber]).size === 3);

    const matches = await prisma.reconciliationMatch.findMany({ where: { transactionId: tx.id } });
    check('3 matches no mesmo crédito', matches.length === 3);
    check('soma das alocações = crédito',
      matches.reduce((s, m) => s + money(m.allocatedAmount), 0) === 9000);
    const txAfter = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    check('crédito RECONCILED', txAfter.reconciliationStatus === 'RECONCILED');
  }

  // =========================================================================
  console.log('\n3. VÁRIOS créditos → UMA tarefa (pagamento em partes)');
  {
    await reset(); await bootstrap();
    const cust = await mkCustomer('Transportes Gama', '44555666000199');
    const task = await mkTask('Job Parcelado', 'OS-3001', cust.id);
    const tx1 = await mkCredit(3000, '44555666000199', 'TRANSPORTES GAMA', 'FIT-3A', D('2026-07-15'));
    const tx2 = await mkCredit(2000, '44555666000199', 'TRANSPORTES GAMA', 'FIT-3B', D('2026-07-25'));

    // 1º crédito cria o orçamento de 3000 e o liquida.
    await svc.matchTasks(tx1.id, [{ taskId: task.id, amount: 3000 }], USER_ID);
    let q = await quoteOf(task.id);
    check('após 1º crédito: total 3000', money(q!.total) === 3000);
    check('após 1º crédito: SETTLED', q!.status === 'SETTLED');

    // Orçamento quitado (sem parcela em aberto) CONTINUA na lista por identidade:
    // é exatamente o caso em que só este fluxo pode absorver mais dinheiro.
    check('quitada ainda aparece por identidade',
      (await svc.getTaskCandidates(tx2.id)).some(x => x.taskId === task.id));

    const q1id = q!.id;

    // 2º crédito, valor DIFERENTE, na MESMA tarefa: entra direto, sem confirmação.
    const res = await svc.matchTasks(tx2.id, [{ taskId: task.id, amount: 2000 }], USER_ID);
    check('2º crédito aceito sem confirmação nenhuma', res.success === true);
    check('marcado como ampliado', res.data.outcomes[0].quoteExtended === true);
    check('NÃO criou orçamento novo', res.data.outcomes[0].quoteCreated === false);

    q = await quoteOf(task.id);
    check('mesmo orçamento (1:1 preservado)', q!.id === q1id);
    check('total cresceu para 5000', money(q!.total) === 5000, String(q?.total));
    check('subtotal cresceu junto', money(q!.subtotal) === 5000, String(q?.subtotal));
    check('agora 2 serviços', q!.services.length === 2);
    check('config total = 5000', money(q!.customerConfigs[0].total) === 5000);
    check('2 parcelas', q!.customerConfigs[0].installments.length === 2);
    check('numeração das parcelas 1 e 2',
      q!.customerConfigs[0].installments.map(i => i.number).sort().join(',') === '1,2');
    // O requisito literal: cada crédito vira UMA parcela do SEU valor.
    const valores = q!.customerConfigs[0].installments.map(i => money(i.amount)).sort((a, b) => a - b);
    check('parcelas separadas por valor de cada crédito (2000 e 3000)',
      valores.join(',') === '2000,3000', valores.join(','));
    const matchByInst = await prisma.reconciliationMatch.findMany({
      where: { installmentId: { in: q!.customerConfigs[0].installments.map(i => i.id) } },
      select: { transactionId: true, installmentId: true, allocatedAmount: true },
    });
    check('cada parcela tem exatamente 1 match', matchByInst.length === 2);
    check('cada match veio de uma transação diferente',
      new Set(matchByInst.map(m => m.transactionId)).size === 2);
    check('cada match alocou o valor da sua parcela',
      matchByInst.every(m => {
        const inst = q!.customerConfigs[0].installments.find(i => i.id === m.installmentId)!;
        return money(m.allocatedAmount) === money(inst.amount);
      }));
    check('ambas quitadas', q!.customerConfigs[0].installments.every(i => i.status === 'PAID'));
    check('continua SETTLED', q!.status === 'SETTLED');

    const inv = await prisma.invoice.findFirstOrThrow({ where: { taskId: task.id } });
    check('UMA única fatura (índice parcial respeitado)',
      (await prisma.invoice.count({ where: { taskId: task.id } })) === 1);
    check('total da fatura = 5000', money(inv.totalAmount) === 5000, String(inv.totalAmount));
    check('fatura PAGA', inv.status === 'PAID');
  }

  // =========================================================================
  console.log('\n4. Orçamento existente EM ABERTO — aloca sem criar nada');
  {
    await reset(); await bootstrap();
    const cust = await mkCustomer('Transportes Delta', '77888999000155');
    const task = await mkTask('Job Faturado', 'OS-4001', cust.id);
    await mkBilledQuote(task.id, cust.id, 10000, [4000, 6000]);
    const tx = await mkCredit(4000, '77888999000155', 'TRANSPORTES DELTA', 'FIT-4');

    // Uma tarefa com parcela em aberto NÃO aparece na lista por identidade: ela
    // pertence à lista normal de parcelas. Só a busca explícita a traz de volta.
    check('excluída da lista por identidade (é caso da lista de parcelas)',
      !(await svc.getTaskCandidates(tx.id)).some(x => x.taskId === task.id));
    const cands = await svc.getTaskCandidates(tx.id, 'OS-4001');
    const c = cands.find(x => x.taskId === task.id)!;
    check('busca explícita traz a tarefa', !!c);
    check('estado QUOTE_OPEN', c.billingState === 'QUOTE_OPEN', c?.billingState);
    check('capacidade = 10000', c.openCapacity === 10000, String(c.openCapacity));
    check('sugere só o que cabe no crédito', c.suggestedAmount === 4000, String(c.suggestedAmount));
    check('2 parcelas em aberto listadas', c.openInstallments.length === 2);

    const res = await svc.matchTasks(tx.id, [{ taskId: task.id, amount: 4000 }], USER_ID);
    check('nada foi criado', !res.data.outcomes[0].quoteCreated && !res.data.outcomes[0].quoteExtended);

    const q = await quoteOf(task.id);
    check('total do orçamento INTOCADO', money(q!.total) === 10000, String(q?.total));
    const insts = q!.customerConfigs[0].installments.sort((a, b) => a.number - b.number);
    check('FIFO: parcela 1 (mais antiga/menor nº) quitada', insts[0].status === 'PAID');
    check('parcela 2 NÃO foi quitada', insts[1].status !== 'PAID', insts[1].status);
    // Precedência real do cascade: SETTLED > DUE > PARTIAL > UPCOMING. Como a
    // parcela restante está vencida (venc. 20/07, hoje 02/08), DUE ganha de
    // PARTIAL — e é a informação mais útil: o cliente ainda deve, e está atrasado.
    check('vencida em aberto ⇒ orçamento em DUE', q!.status === 'DUE', q?.status);

    const inv = await prisma.invoice.findFirstOrThrow({ where: { taskId: task.id } });
    check('fatura PARCIALMENTE PAGA', inv.status === 'PARTIALLY_PAID', inv.status);
    check('paidAmount da fatura = 4000', money(inv.paidAmount) === 4000);

    // A mesma situação com a parcela restante A VENCER cai em PARTIAL.
    const task2 = await mkTask('Job Futuro', 'OS-4002', cust.id);
    await mkBilledQuote(task2.id, cust.id, 10000, [4000, 6000]);
    await prisma.installment.updateMany({
      where: { customerConfig: { quote: { task: { id: task2.id } } } },
      data: { dueDate: D('2026-12-20') },
    });
    const tx2 = await mkCredit(4000, '77888999000155', 'TRANSPORTES DELTA', 'FIT-4B');
    await svc.matchTasks(tx2.id, [{ taskId: task2.id, amount: 4000 }], USER_ID);
    const q2 = await quoteOf(task2.id);
    check('a vencer + parcial ⇒ orçamento em PARTIAL', q2!.status === 'PARTIAL', q2?.status);
  }

  // =========================================================================
  console.log('\n5. Orçamento aprovado NÃO faturado — materializa pelo total do orçamento');
  {
    await reset(); await bootstrap();
    const cust = await mkCustomer('Transportes Epsilon', '12121212000112');
    const task = await mkTask('Job Orçado', 'OS-5001', cust.id);
    await mkUnbilledQuote(task.id, cust.id, 8000);
    const tx = await mkCredit(3000, '12121212000112', 'TRANSPORTES EPSILON', 'FIT-5');

    const cands = await svc.getTaskCandidates(tx.id);
    const c = cands.find(x => x.taskId === task.id)!;
    check('estado QUOTE_UNBILLED', c.billingState === 'QUOTE_UNBILLED', c?.billingState);

    const res = await svc.matchTasks(tx.id, [{ taskId: task.id, amount: 3000 }], USER_ID);
    check('fatura materializada', res.data.outcomes[0].invoiceCreated === true);
    check('orçamento NÃO ampliado', res.data.outcomes[0].quoteExtended === false);

    const q = await quoteOf(task.id);
    check('preço veio do ORÇAMENTO (8000), não do crédito (3000)',
      money(q!.total) === 8000, String(q?.total));
    check('parcela criada com o total do orçamento',
      money(q!.customerConfigs[0].installments[0].amount) === 8000);
    check('parcela NÃO quitada (crédito cobriu só parte)',
      q!.customerConfigs[0].installments[0].status !== 'PAID');
    // Vencimento herdado do finishedAt (10/07) já passou, então OVERDUE — mesma
    // regra que unmatchInflow aplica ao reabrir uma parcela.
    check('parcela vencida e em aberto ⇒ OVERDUE',
      q!.customerConfigs[0].installments[0].status === 'OVERDUE',
      q?.customerConfigs[0].installments[0].status);
    check('paidAmount da parcela = 3000',
      money(q!.customerConfigs[0].installments[0].paidAmount) === 3000);
    check('quote elevado do BUDGET_APPROVED para o ciclo de recebíveis',
      ['UPCOMING', 'PARTIAL', 'DUE'].includes(q!.status), q?.status);

    const txAfter = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    check('crédito totalmente alocado ⇒ RECONCILED', txAfter.reconciliationStatus === 'RECONCILED');
  }

  // =========================================================================
  console.log('\n6. Crédito parcialmente alocado + segunda conciliação');
  {
    await reset(); await bootstrap();
    const cust = await mkCustomer('Transportes Zeta', '13131313000113');
    const t1 = await mkTask('Job Z1', 'OS-6001', cust.id);
    const t2 = await mkTask('Job Z2', 'OS-6002', cust.id);
    const tx = await mkCredit(10000, '13131313000113', 'TRANSPORTES ZETA', 'FIT-6');

    await svc.matchTasks(tx.id, [{ taskId: t1.id, amount: 6000 }], USER_ID);
    let txAfter = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    check('parcialmente alocado ⇒ PARTIAL', txAfter.reconciliationStatus === 'PARTIAL', txAfter.reconciliationStatus);

    const cands = await svc.getTaskCandidates(tx.id);
    const c2 = cands.find(x => x.taskId === t2.id)!;
    check('sugestão da 2ª tarefa desconta o já alocado', c2.suggestedAmount === 4000, String(c2.suggestedAmount));

    let over = false;
    try { await svc.matchTasks(tx.id, [{ taskId: t2.id, amount: 5000 }], USER_ID); }
    catch (e: any) { over = /excede o saldo disponível/i.test(e.message); }
    check('recusa alocar acima do saldo restante', over);

    await svc.matchTasks(tx.id, [{ taskId: t2.id, amount: 4000 }], USER_ID);
    txAfter = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    check('completado ⇒ RECONCILED', txAfter.reconciliationStatus === 'RECONCILED');
    check('primeira alocação preservada',
      (await prisma.reconciliationMatch.count({ where: { transactionId: tx.id } })) === 2);
  }

  // =========================================================================
  console.log('\n7. Desvincular reverte tudo menos o orçamento (correto)');
  {
    await reset(); await bootstrap();
    const cust = await mkCustomer('Transportes Eta', '14141414000114');
    const task = await mkTask('Job Reversao', 'OS-7001', cust.id);
    const tx = await mkCredit(2500, '14141414000114', 'TRANSPORTES ETA', 'FIT-7');
    await svc.matchTasks(tx.id, [{ taskId: task.id, amount: 2500 }], USER_ID);

    const { ReceivableMatchService } = await import('../src/modules/financial/reconciliation/receivable-match.service');
    const cfgStub: any = { get: () => undefined };
    const rms = new ReceivableMatchService(prisma as any, cascade, cfgStub);
    await rms.unmatchInflow(tx.id);

    const txAfter = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    check('crédito volta a PENDING', txAfter.reconciliationStatus === 'PENDING');
    check('matches removidos', (await prisma.reconciliationMatch.count({ where: { transactionId: tx.id } })) === 0);

    const q = await quoteOf(task.id);
    check('orçamento SOBREVIVE (o trabalho foi faturado)', !!q);
    check('parcela reaberta', q!.customerConfigs[0].installments[0].status !== 'PAID',
      q?.customerConfigs[0].installments[0].status);
    check('paidAmount zerado', money(q!.customerConfigs[0].installments[0].paidAmount) === 0);
    check('orçamento sai de SETTLED', q!.status !== 'SETTLED', q?.status);
  }

  // =========================================================================
  console.log('\n8. Busca e guardas');
  {
    await reset(); await bootstrap();
    const cust = await mkCustomer('Transportes Teta', '15151515000115');
    const task = await mkTask('Caçamba Basculante', 'OS-8001', cust.id, 'XYZ9K88');
    const other = await mkCustomer('Outra Empresa', '16161616000116');
    const orphan = await mkTask('Job Sem Cliente', 'OS-8002', null);
    const tx = await mkCredit(1000, null, null, 'FIT-8');

    check('sem identidade ⇒ lista vazia', (await svc.getTaskCandidates(tx.id)).length === 0);
    check('busca por placa acha', (await svc.getTaskCandidates(tx.id, 'XYZ9K88')).some(c => c.taskId === task.id));
    check('busca por série acha', (await svc.getTaskCandidates(tx.id, 'OS-8001')).some(c => c.taskId === task.id));
    check('busca acento-insensível acha', (await svc.getTaskCandidates(tx.id, 'cacamba')).some(c => c.taskId === task.id));
    check('busca por cliente acha', (await svc.getTaskCandidates(tx.id, 'Teta')).some(c => c.taskId === task.id));

    let noCustomer = false;
    try { await svc.matchTasks(tx.id, [{ taskId: orphan.id, amount: 500 }], USER_ID); }
    catch (e: any) { noCustomer = /não tem cliente/i.test(e.message); }
    check('recusa tarefa sem cliente', noCustomer);

    let dup = false;
    try { await svc.matchTasks(tx.id, [{ taskId: task.id, amount: 100 }, { taskId: task.id, amount: 100 }], USER_ID); }
    catch (e: any) { dup = /mais de uma vez/i.test(e.message); }
    check('recusa a mesma tarefa duas vezes', dup);

    const debit = await prisma.bankTransaction.create({
      data: { bankCode: '748', bankName: 'Sicredi', agency: '0710', accountNumber: '12345678',
        fitId: 'FIT-DEB', postedAt: D('2026-07-15'), amount: -500, type: 'DEBIT' as any,
        subtype: 'PIX' as any, reconciliationStatus: 'PENDING' as any },
    });
    let notCredit = false;
    try { await svc.getTaskCandidates(debit.id); } catch (e: any) { notCredit = /crédito/i.test(e.message); }
    check('recusa débito', notCredit);

    check('cliente sem tarefas não gera candidato',
      (await svc.getTaskCandidates(tx.id, 'Outra Empresa')).length === 0);
    void other;
  }

  // =========================================================================
  console.log('\n9. O dinheiro aparece em Contas a Receber e na Faturamento');
  {
    await reset(); await bootstrap();
    const cust = await mkCustomer('Transportes Iota', '17171717000117');
    const task = await mkTask('Job Visivel', 'OS-9001', cust.id);
    const tx = await mkCredit(7500, '17171717000117', 'TRANSPORTES IOTA', 'FIT-9');
    await svc.matchTasks(tx.id, [{ taskId: task.id, amount: 7500 }], USER_ID);

    const { ReceivablesService } = await import('../src/modules/financial/reconciliation/receivables.service');
    const rs = new ReceivablesService(prisma as any);
    const list = await rs.getReceivables();
    const row = list.data.rows.find(r => r.taskId === task.id);
    check('linha existe em Contas a Receber', !!row);
    check('classificada como TASK_QUOTE', row?.source === 'TASK_QUOTE', row?.source);
    check('valor correto', row?.amount === 7500, String(row?.amount));
    check('estado RECEBIDO', row?.state === 'RECEIVED', row?.state);
    check('marcada como conciliada', row?.reconciled === true);
    check('clearance CLEARED', row?.clearanceState === 'CLEARED', row?.clearanceState);
    check('aponta para a transação', row?.transactionId === tx.id);

    // O filtro da tela de Faturamento é `quote: { isNot: null }` — a tarefa
    // agora passa nele, o que antes era impossível.
    const visible = await prisma.task.count({
      where: { id: task.id, quote: { isNot: null }, AND: [{ quote: { status: { notIn: ['PENDING'] } } }] },
    });
    check('tarefa agora visível na tela de Faturamento', visible === 1);

    // Categoria contábil de receita aplicada ao crédito.
    const tags = await prisma.bankTransactionCategory.findMany({
      where: { transactionId: tx.id }, include: { category: true },
    });
    check('crédito recebeu categoria de receita',
      tags.some(t => t.category.slug === 'receita-servicos') || tags.length === 0,
      tags.length === 0 ? 'categoria não semeada neste banco de teste' : tags.map(t => t.category.slug).join(','));
  }


  // =========================================================================
  console.log('\nA. Categoria de receita realmente aplicada (categoria semeada)');
  // Idempotente: o banco de teste é reutilizado entre execuções.
  const existingCat = await prisma.transactionCategory.findFirst({ where: { slug: 'receita-servicos' } });
  if (!existingCat) {
    await prisma.transactionCategory.create({
      data: { name: 'Receita de Serviços', slug: 'receita-servicos', kind: 'SERVICE' as any, isResolving: false },
    });
  }
  const c1 = await prisma.customer.create({ data: { fantasyName: 'Cli A', cnpj: '21212121000121', fantasyNameNormalized: 'cli a' } });
  const t1 = await prisma.task.create({ data: { name: 'T A', serialNumber: 'E-1', status: 'COMPLETED' as any, statusOrder: 4, finishedAt: D('2026-07-10'), customerId: c1.id } });
  const tx1 = await prisma.bankTransaction.create({ data: { bankCode:'748',bankName:'Sicredi',agency:'0710',accountNumber:'1',fitId:'E1',postedAt:D('2026-07-15'),amount:1000,type:'CREDIT' as any,subtype:'PIX' as any,counterpartyCnpjCpf:'21212121000121',counterpartyName:'CLI A',reconciliationStatus:'PENDING' as any } });
  await svc.matchTasks(tx1.id, [{ taskId: t1.id, amount: 1000 }], USER_ID);
  const tags = await prisma.bankTransactionCategory.findMany({ where: { transactionId: tx1.id }, include: { category: true } });
  check('tag de receita gravada', tags.length === 1 && tags[0].category.slug === 'receita-servicos', `${tags.length} tags`);
  check('tag é AUTO (some no desvincular)', tags[0]?.source === 'AUTO', tags[0]?.source);
  check('valor alocado na tag', Number(tags[0]?.allocatedAmount) === 1000, String(tags[0]?.allocatedAmount));

  console.log('\nB. Concorrência: 5 conciliações simultâneas, cada uma cunhando orçamento');
  const tasks = [], txs = [];
  for (let i = 0; i < 5; i++) {
    const c = await prisma.customer.create({ data: { fantasyName: `Cli C${i}`, cnpj: `3131313100012${i}`, fantasyNameNormalized: norm(`Cli C${i}`) } });
    tasks.push(await prisma.task.create({ data: { name: `T C${i}`, serialNumber: `E-C${i}`, status: 'COMPLETED' as any, statusOrder: 4, finishedAt: D('2026-07-10'), customerId: c.id } }));
    txs.push(await prisma.bankTransaction.create({ data: { bankCode:'748',bankName:'Sicredi',agency:'0710',accountNumber:'1',fitId:`EC${i}`,postedAt:D('2026-07-15'),amount:1000+i,type:'CREDIT' as any,subtype:'PIX' as any,counterpartyCnpjCpf:`3131313100012${i}`,reconciliationStatus:'PENDING' as any } }));
  }
  const results = await Promise.allSettled(
    tasks.map((t, i) => svc.matchTasks(txs[i].id, [{ taskId: t.id, amount: 1000 + i }], USER_ID)),
  );
  const ok = results.filter(r => r.status === 'fulfilled').length;
  check('todas as 5 concluíram sem P2002', ok === 5,
    results.filter(r => r.status === 'rejected').map((r: any) => r.reason?.message).join(' | '));
  const nums = (await prisma.taskQuote.findMany({ where: { task: { id: { in: tasks.map(t => t.id) } } }, select: { budgetNumber: true } })).map(q => q.budgetNumber);
  check('5 budgetNumbers, todos distintos', new Set(nums).size === 5, JSON.stringify(nums));

  console.log('\nC. Idempotência: reconciliar de novo um crédito já conciliado');
  let blocked = false;
  try { await svc.matchTasks(tx1.id, [{ taskId: t1.id, amount: 1000 }], USER_ID); }
  catch (e: any) { blocked = /excede o saldo disponível/i.test(e.message); }
  check('recusa realocar um crédito já esgotado', blocked);
  check('continua com 1 match só', (await prisma.reconciliationMatch.count({ where: { transactionId: tx1.id } })) === 1);
  check('orçamento não duplicou', (await prisma.taskQuote.count({ where: { task: { id: t1.id } } })) === 1);

  console.log('\nD. Crédito IGNORADO é recusado');
  const c2 = await prisma.customer.create({ data: { fantasyName: 'Cli D', cnpj: '41414141000141', fantasyNameNormalized: 'cli d' } });
  const t2 = await prisma.task.create({ data: { name: 'T D', serialNumber: 'E-D', status: 'COMPLETED' as any, statusOrder: 4, customerId: c2.id } });
  const tx2 = await prisma.bankTransaction.create({ data: { bankCode:'748',bankName:'Sicredi',agency:'0710',accountNumber:'1',fitId:'ED',postedAt:D('2026-07-15'),amount:500,type:'CREDIT' as any,subtype:'PIX' as any,reconciliationStatus:'IGNORED' as any, ignoredReason:'teste ignorado' } });
  let ign = false;
  try { await svc.matchTasks(tx2.id, [{ taskId: t2.id, amount: 500 }], USER_ID); }
  catch (e: any) { ign = /ignorada/i.test(e.message); }
  check('recusa conciliar transação ignorada', ign);
  check('nenhum orçamento criado na recusa', (await prisma.taskQuote.count({ where: { task: { id: t2.id } } })) === 0);

  console.log('\nE. Rollback: falha em UMA alocação desfaz o lote inteiro');
  const c3 = await prisma.customer.create({ data: { fantasyName: 'Cli E', cnpj: '51515151000151', fantasyNameNormalized: 'cli e' } });
  const tGood = await prisma.task.create({ data: { name: 'T E1', serialNumber: 'E-E1', status: 'COMPLETED' as any, statusOrder: 4, customerId: c3.id } });
  const tBad  = await prisma.task.create({ data: { name: 'T E2', serialNumber: 'E-E2', status: 'COMPLETED' as any, statusOrder: 4, customerId: null } }); // sem cliente
  const tx3 = await prisma.bankTransaction.create({ data: { bankCode:'748',bankName:'Sicredi',agency:'0710',accountNumber:'1',fitId:'EE',postedAt:D('2026-07-15'),amount:900,type:'CREDIT' as any,subtype:'PIX' as any,reconciliationStatus:'PENDING' as any } });
  let rolled = false;
  try { await svc.matchTasks(tx3.id, [{ taskId: tGood.id, amount: 400 }, { taskId: tBad.id, amount: 500 }], USER_ID); }
  catch { rolled = true; }
  check('lote falhou', rolled);
  check('orçamento da tarefa BOA foi desfeito', (await prisma.taskQuote.count({ where: { task: { id: tGood.id } } })) === 0);
  check('nenhum match gravado', (await prisma.reconciliationMatch.count({ where: { transactionId: tx3.id } })) === 0);
  check('crédito continua PENDING', (await prisma.bankTransaction.findUniqueOrThrow({ where: { id: tx3.id } })).reconciliationStatus === 'PENDING');


  console.log(failures === 0 ? '\n✅ Integração: tudo passou\n' : `\n❌ Integração: ${failures} falha(s)\n`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async e => { console.error('\nFATAL:', e); await prisma.$disconnect(); process.exit(1); });
