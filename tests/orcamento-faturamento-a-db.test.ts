/**
 * O PAGADOR JÁ FATURADO NÃO É RECALCULADO — contra o banco.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────
 * `recalcQuoteTotals` reescrevia `subtotal`/`total` de TODA fatia, incluindo as
 * que sustentam `Invoice.totalAmount`, parcelas geradas, boleto registrado no
 * Sicredi e NFS-e autorizada na prefeitura. E ela roda em caminhos que não
 * passam por guarda nenhuma — apagar um dos sessenta caminhões, ou mover uma
 * tarefa de orçamento, chamam-na direto do repositório de tarefas.
 *
 * Isso não dá para verificar sem banco: a função só existe dentro de uma
 * transação Prisma, e o que se quer provar é que ela LÊ o estado da cobrança
 * antes de escrever.
 *
 * Roda contra o banco de QA (`ankaa_qa_e2e`), cria o próprio material e o apaga
 * no `finally` — inclusive quando falha. Mesmo padrão de `billing-entity.test.ts`.
 *
 * Rodar: pnpm tsx tests/orcamento-faturamento-a-db.test.ts
 */
import { PrismaClient } from '@prisma/client';
import { recalcQuoteTotals } from '../src/utils/budget-totals';
import { reconcileQuoteCustomerConfigs } from '../src/utils/budget-customer-config-sync';

const QA_DB = (process.env.DATABASE_URL ?? '').replace(/\/[^/?]+(\?|$)/, '/ankaa_qa_e2e$1');
const prisma = new PrismaClient({ datasources: { db: { url: QA_DB } } });

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const marca = `QA-RECALC-${Date.now()}`;
  let quoteId = '';
  const taskIds: string[] = [];

  try {
    const cli = await prisma.customer.findFirst({
      where: { fantasyName: { contains: 'QA Alfa' } },
      select: { id: true },
    });
    if (!cli) {
      check('cliente de apoio existe (QA Alfa)', false);
      return;
    }

    const maxNum = await prisma.budget.aggregate({ _max: { budgetNumber: true } });
    const quote = await prisma.budget.create({
      data: {
        subtotal: 0,
        total: 0,
        expiresAt: new Date(Date.now() + 30 * 86400000),
        budgetNumber: (maxNum._max.budgetNumber ?? 0) + 1,
        vehicleCount: 2,
        billingSplit: 'PER_TASK',
      },
      select: { id: true },
    });
    quoteId = quote.id;

    for (let i = 0; i < 2; i++) {
      const t = await prisma.task.create({
        data: { name: `${marca}-${i}`, quoteId, customerId: cli.id },
        select: { id: true },
      });
      taskIds.push(t.id);
    }

    // Um serviço de R$ 1.000,00 por veículo. Em `PER_TASK` cada fatia cobre um
    // caminhão, então cada uma vale R$ 1.000,00 e o contrato vale R$ 2.000,00.
    await prisma.budgetItem.create({
      data: { quoteId, description: `${marca} serviço`, amount: 1000, position: 0 },
    });

    await prisma.$transaction(async tx => {
      await reconcileQuoteCustomerConfigs(tx as any, quoteId, [{ customerId: cli.id } as any], {
        billingSplit: 'PER_TASK',
        taskIds,
      } as any);
      await recalcQuoteTotals(tx as any, quoteId);
    });

    console.log('\nPonto de partida: duas fatias de R$ 1.000,00');
    let configs = await prisma.budgetPayer.findMany({
      where: { quoteId },
      select: { id: true, total: true, billingId: true },
      orderBy: { createdAt: 'asc' },
    });
    let q = await prisma.budget.findUnique({
      where: { id: quoteId },
      select: { total: true },
    });
    check('duas fatias', configs.length === 2, String(configs.length));
    check(
      'cada uma vale R$ 1.000,00',
      configs.every(c => Number(c.total) === 1000),
      configs.map(c => String(c.total)).join(', '),
    );
    check('o contrato vale R$ 2.000,00', Number(q?.total) === 2000, String(q?.total));

    // ── A FATIA 1 É FATURADA, e o valor dela é CONGELADO num número diferente ──
    //
    // R$ 1.234,56 não sai de conta nenhuma: é o que a fatura, as parcelas e o
    // boleto diriam se tivessem sido emitidos sobre um preço que depois mudou.
    // É exatamente o caso que a guarda existe para preservar.
    console.log('\nA fatia 1 é aprovada e o valor dela congela em R$ 1.234,56');
    await prisma.budgetPayer.update({
      where: { id: configs[0].id },
      data: { subtotal: 1234.56, total: 1234.56 },
    });
    await prisma.billing.update({
      where: { id: configs[0].billingId },
      data: { approvedAt: new Date(), status: 'APPROVED', statusOrder: 4 },
    });

    await prisma.$transaction(async tx => {
      await recalcQuoteTotals(tx as any, quoteId);
    });

    configs = await prisma.budgetPayer.findMany({
      where: { quoteId },
      select: { id: true, total: true },
      orderBy: { createdAt: 'asc' },
    });
    q = await prisma.budget.findUnique({ where: { id: quoteId }, select: { total: true } });

    check(
      'o recálculo NÃO reescreveu a fatia faturada',
      Number(configs[0].total) === 1234.56,
      String(configs[0].total),
    );
    check(
      'e reescreveu a que ainda está livre',
      Number(configs[1].total) === 1000,
      String(configs[1].total),
    );
    check(
      'o contrato passou a somar as duas COMO ESTÃO (1.234,56 + 1.000,00)',
      Number(q?.total) === 2234.56,
      String(q?.total),
    );

    // ── E SEGUE VALENDO QUANDO O PREÇO DO SERVIÇO MUDA ────────────────────────
    console.log('\nO preço do serviço sobe para R$ 1.500,00');
    await prisma.budgetItem.updateMany({
      where: { quoteId },
      data: { amount: 1500 },
    });
    await prisma.$transaction(async tx => {
      await recalcQuoteTotals(tx as any, quoteId);
    });
    configs = await prisma.budgetPayer.findMany({
      where: { quoteId },
      select: { id: true, total: true },
      orderBy: { createdAt: 'asc' },
    });
    q = await prisma.budget.findUnique({ where: { id: quoteId }, select: { total: true } });
    check(
      'a fatia faturada continua em R$ 1.234,56 — é o que saiu na fatura',
      Number(configs[0].total) === 1234.56,
      String(configs[0].total),
    );
    check(
      'a livre acompanha o preço novo',
      Number(configs[1].total) === 1500,
      String(configs[1].total),
    );
    check('e o contrato é a soma honesta das duas', Number(q?.total) === 2734.56, String(q?.total));

    // ── A COBRANÇA SEM CARIMBO MAS LIQUIDADA TAMBÉM CONGELA ───────────────────
    //
    // É o caso do acervo: liquidação por conciliação bancária, sem fatura de onde
    // derivar `approvedAt`. Para as definições antigas de "congelado" ela era
    // editável.
    console.log('\nCobrança LIQUIDADA sem carimbo (liquidação por conciliação)');
    const livre = await prisma.budgetPayer.findUnique({
      where: { id: configs[1].id },
      select: { billingId: true },
    });
    await prisma.billing.update({
      where: { id: livre!.billingId },
      data: { approvedAt: null, status: 'SETTLED', statusOrder: 5 },
    });
    await prisma.budgetPayer.update({
      where: { id: configs[1].id },
      data: { subtotal: 777.77, total: 777.77 },
    });
    await prisma.$transaction(async tx => {
      await recalcQuoteTotals(tx as any, quoteId);
    });
    const depois = await prisma.budgetPayer.findUnique({
      where: { id: configs[1].id },
      select: { total: true },
    });
    check(
      'o estado SETTLED sozinho já protege o valor',
      Number(depois?.total) === 777.77,
      String(depois?.total),
    );
  } finally {
    if (quoteId) {
      await prisma.billingTask.deleteMany({ where: { taskId: { in: taskIds } } });
      await prisma.task.updateMany({ where: { id: { in: taskIds } }, data: { quoteId: null } });
      await prisma.budgetItem.deleteMany({ where: { quoteId } });
      await prisma.budgetPayer.deleteMany({ where: { quoteId } });
      await prisma.billing.deleteMany({ where: { quoteId } });
      await prisma.budget.deleteMany({ where: { id: quoteId } });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    }
    await prisma.$disconnect();
  }

  console.log(
    failures === 0
      ? '\n✅ Recálculo de totais: todas as verificações passaram.\n'
      : `\n❌ ${failures} verificação(ões) falharam.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
