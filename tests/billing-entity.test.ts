/**
 * O FATURAMENTO É UMA ENTIDADE — e trocar de modo cria e destrói entidades.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────
 * O pedido do dono, em suas palavras: "pode se ter multiplos ou apenas 1
 * faturamento em um orcamento, nao um orcamento com uma configuracao de
 * multiplos faturamentos, mas realmente multiplos faturamentos, cada um com seu
 * uuid, cada um sendo um".
 *
 * A diferença entre as duas coisas só aparece num teste que olha para os IDS.
 * Um orçamento que troca de "uma fatura para os quatro" para "uma por veículo" e
 * continua com UM registro que mudou de forma passaria em qualquer asserção sobre
 * contagem de cobranças. O que prova que a entidade existe é:
 *
 *   o `Billing` que cobria os quatro NÃO está mais lá, e os quatro que
 *   existem agora têm ids que nunca existiram antes.
 *
 * Roda contra o banco de QA (`ankaa_qa_e2e`), cria o próprio material e o apaga
 * no `finally` — inclusive quando falha.
 */
import { PrismaClient } from '@prisma/client';
import {
  reconcileQuoteCustomerConfigs,
  reconcileBillingsForQuote,
} from '../src/utils/budget-customer-config-sync';

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

/** O retrato do orçamento pelo lado das ENTIDADES. */
async function faturamentos(quoteId: string) {
  const bs = await prisma.billing.findMany({
    where: { quoteId },
    select: {
      id: true,
      tasks: { select: { taskId: true } },
      customerConfigs: { select: { id: true, customerId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return bs.map(b => ({
    id: b.id,
    veiculos: b.tasks.length,
    pagadores: b.customerConfigs.length,
  }));
}

async function main() {
  const marca = `QA-BILLING-${Date.now()}`;
  let quoteId = '';
  const taskIds: string[] = [];
  let customerA = '';
  let customerB = '';

  try {
    const cliA = await prisma.customer.findFirst({ where: { fantasyName: { contains: 'QA Alfa' } }, select: { id: true } });
    const cliB = await prisma.customer.findFirst({ where: { fantasyName: { contains: 'QA Beta' } }, select: { id: true } });
    if (!cliA || !cliB) { check('clientes de apoio existem (QA Alfa / QA Beta)', false); return; }
    customerA = cliA.id; customerB = cliB.id;

    const maxNum = await prisma.budget.aggregate({ _max: { budgetNumber: true } });
    const quote = await prisma.budget.create({
      data: {
        subtotal: 4000, total: 4000,
        expiresAt: new Date(Date.now() + 30 * 86400000),
        budgetNumber: (maxNum._max.budgetNumber ?? 0) + 1,
        vehicleCount: 4,
      },
      select: { id: true },
    });
    quoteId = quote.id;

    for (let i = 0; i < 4; i++) {
      const t = await prisma.task.create({
        data: { name: `${marca}-${i}`, quoteId, customerId: customerA },
        select: { id: true },
      });
      taskIds.push(t.id);
    }

    // ── ponto de partida: UMA cobrança para os quatro ────────────────────────
    console.log('\nUm faturamento para os quatro veículos');
    await prisma.$transaction(async tx => {
      await reconcileQuoteCustomerConfigs(tx as any, quoteId, [{ customerId: customerA } as any], {
        billingSplit: 'JOINT', taskIds,
      } as any);
    });
    const junto = await faturamentos(quoteId);
    check('existe UM faturamento', junto.length === 1, JSON.stringify(junto));
    check('ele cobre os 4 veículos', junto[0]?.veiculos === 4, `${junto[0]?.veiculos}`);
    check('com UM pagador', junto[0]?.pagadores === 1, `${junto[0]?.pagadores}`);
    const idJunto = junto[0]?.id;

    // ── a troca: um por veículo ──────────────────────────────────────────────
    console.log('\nTrocando para um faturamento por veículo');
    await prisma.$transaction(async tx => {
      await reconcileQuoteCustomerConfigs(tx as any, quoteId, [{ customerId: customerA } as any], {
        billingSplit: 'PER_TASK', taskIds,
      } as any);
    });
    const separado = await faturamentos(quoteId);
    check('agora existem QUATRO faturamentos', separado.length === 4, JSON.stringify(separado.map(b => b.veiculos)));
    check('cada um cobre UM veículo', separado.every(b => b.veiculos === 1), JSON.stringify(separado.map(b => b.veiculos)));
    check('cada um com UM pagador', separado.every(b => b.pagadores === 1));

    // A PROVA de que são entidades, e não um registro que mudou de forma:
    const idsSeparado = new Set(separado.map(b => b.id));
    check('são QUATRO ids distintos', idsSeparado.size === 4, `${idsSeparado.size}`);
    check('o faturamento que cobria os quatro DEIXOU DE EXISTIR',
      !!idJunto && !idsSeparado.has(idJunto), `${idJunto}`);
    const aindaLa = await prisma.billing.findUnique({ where: { id: idJunto! }, select: { id: true } });
    check('e não está mais no banco', aindaLa === null);

    // ── e de volta ───────────────────────────────────────────────────────────
    console.log('\nE de volta para um só');
    await prisma.$transaction(async tx => {
      await reconcileQuoteCustomerConfigs(tx as any, quoteId, [{ customerId: customerA } as any], {
        billingSplit: 'JOINT', taskIds,
      } as any);
    });
    const devolta = await faturamentos(quoteId);
    check('voltou a UM faturamento', devolta.length === 1, JSON.stringify(devolta));
    check('cobrindo os 4 de novo', devolta[0]?.veiculos === 4, `${devolta[0]?.veiculos}`);
    check('e é uma entidade NOVA — nenhum dos quatro sobreviveu',
      !!devolta[0] && !idsSeparado.has(devolta[0].id), devolta[0]?.id);
    const sobrouAlgum = await prisma.billing.count({ where: { id: { in: [...idsSeparado] } } });
    check('os quatro sumiram do banco', sobrouAlgum === 0, `${sobrouAlgum} sobraram`);

    // ── dois pagadores NÃO são dois faturamentos ─────────────────────────────
    console.log('\nDois pagadores no mesmo recorte = UM faturamento com dois pagadores');
    await prisma.$transaction(async tx => {
      await reconcileQuoteCustomerConfigs(
        tx as any, quoteId,
        [{ customerId: customerA } as any, { customerId: customerB } as any],
        { billingSplit: 'JOINT', taskIds } as any,
      );
    });
    const dois = await faturamentos(quoteId);
    check('continua sendo UM faturamento', dois.length === 1, JSON.stringify(dois));
    check('com DOIS pagadores dentro', dois[0]?.pagadores === 2, `${dois[0]?.pagadores}`);
    check('cobrindo os mesmos 4 veículos', dois[0]?.veiculos === 4, `${dois[0]?.veiculos}`);

    // ── idempotência: reconciliar de novo não troca nada de lugar ────────────
    console.log('\nIdempotência');
    const antes = (await faturamentos(quoteId)).map(b => b.id).sort().join(',');
    await prisma.$transaction(async tx => { await reconcileBillingsForQuote(tx as any, quoteId); });
    const depois = (await faturamentos(quoteId)).map(b => b.id).sort().join(',');
    check('rodar de novo preserva os mesmos ids', antes === depois, `${antes} → ${depois}`);

    // ── o invariante do banco ────────────────────────────────────────────────
    console.log('\nO invariante: um veículo, um faturamento');
    const cobertura = await prisma.billingTask.findMany({
      where: { taskId: { in: taskIds } }, select: { taskId: true },
    });
    check('cada veículo aparece exatamente uma vez',
      cobertura.length === 4 && new Set(cobertura.map(c => c.taskId)).size === 4,
      `${cobertura.length} linhas`);

    // ═══════════════════════════════════════════════════════════════════════
    // O ESTADO É DO FATURAMENTO — e é ele que congela a própria cobertura.
    //
    // `Billing.approvedAt` substituiu `BudgetPayer.billingApprovedAt`,
    // uma data por PAGADOR: com dois pagadores do mesmo recorte havia duas datas
    // para um evento só, sempre escritas juntas. O que este bloco prova é que a
    // coluna nova é de fato a que MANDA — aprovar um faturamento tem de impedir
    // que a recomposição mexa nos veículos DELE, e só nos dele.
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\nAprovar um faturamento congela a cobertura DELE, e só a dele');

    // Volta para um por veículo e aprova o do primeiro caminhão.
    await prisma.$transaction(async tx => {
      await reconcileQuoteCustomerConfigs(tx as any, quoteId, [{ customerId: customerA } as any],
        { billingSplit: 'PER_TASK', taskIds });
    });
    const porVeiculo = await prisma.billing.findMany({
      where: { quoteId },
      select: { id: true, tasks: { select: { taskId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const alvo = porVeiculo.find(b => b.tasks.some(t => t.taskId === taskIds[0]));
    check('há um faturamento por veículo antes de aprovar', porVeiculo.length === 4,
      `${porVeiculo.length}`);
    if (alvo) {
      await prisma.billing.update({ where: { id: alvo.id }, data: { approvedAt: new Date() } });

      // A troca de modo pedida agora é ilegítima: ela moveria o veículo do
      // faturamento aprovado para um recorte conjunto.
      let recusou = false;
      try {
        await prisma.$transaction(async tx => {
          await reconcileQuoteCustomerConfigs(tx as any, quoteId, [{ customerId: customerA } as any],
            { billingSplit: 'JOINT', taskIds });
        });
      } catch {
        recusou = true;
      }

      const depois = await prisma.billing.findMany({
        where: { quoteId },
        select: { id: true, approvedAt: true, tasks: { select: { taskId: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const aprovadoAindaLa = depois.find(b => b.id === alvo.id);

      check('o faturamento APROVADO sobreviveu à recomposição',
        !!aprovadoAindaLa, `${depois.map(b => b.id).join(',')}`);
      check('e continua cobrindo exatamente o veículo dele',
        (aprovadoAindaLa?.tasks ?? []).length === 1 &&
        aprovadoAindaLa?.tasks[0]?.taskId === taskIds[0]);
      check('e continua marcado como aprovado', !!aprovadoAindaLa?.approvedAt);
      check('os outros três NÃO ficaram aprovados por tabela',
        depois.filter(b => b.approvedAt).length === 1,
        `${depois.filter(b => b.approvedAt).length} aprovados`);
      // A recusa é o comportamento certo, mas não é o que este bloco prova: se a
      // reconciliação optar por PRESERVAR a fatia congelada em vez de recusar, as
      // asserções acima continuam sendo a garantia que importa.
      console.log(`  · recomposição ${recusou ? 'RECUSADA' : 'aceita preservando a fatia'}`);

      await prisma.billing.update({ where: { id: alvo.id }, data: { approvedAt: null } });
    }
  } finally {
    if (quoteId) {
      await prisma.billingTask.deleteMany({ where: { taskId: { in: taskIds } } }).catch(() => {});
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } }).catch(() => {});
      await prisma.budgetPayer.deleteMany({ where: { quoteId } }).catch(() => {});
      await prisma.billing.deleteMany({ where: { quoteId } }).catch(() => {});
      await prisma.budget.delete({ where: { id: quoteId } }).catch(() => {});
    }
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.log(`\n❌ ${failures} verificação(ões) falharam.`);
    process.exit(1);
  }
  console.log('\n✅ O faturamento é uma entidade: todas as verificações passaram.');
}

void main();
