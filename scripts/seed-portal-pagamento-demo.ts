/**
 * UM ORÇAMENTO DE DEMONSTRAÇÃO COM O PLANO DE PAGAMENTO CHEIO.
 *
 * POR QUE ELE EXISTE
 *   O card "Pagamento" do portal passou a mostrar a configuração — forma,
 *   condição, parcelas, desconto, se sai nota e se sai boleto —, mas os
 *   orçamentos do dono no banco restaurado não têm nada disso gravado: o
 *   nº 216, que é o que ele abre para conferir, tem `paymentConfig` = JSON
 *   `null`, `paymentCondition` vazio, total R$ 0,00 e ZERO parcelas. A tela
 *   estava certa e o registro é que é vazio — e não há como ver o desenho
 *   completo sem um registro que o exercite.
 *
 *   Este script cria esse registro NO CADASTRO DO PRÓPRIO DONO, para que ele
 *   abra o portal com a sessão dele e veja a tela cheia: 4 parcelas (uma paga,
 *   uma com boleto ativo, duas em aberto), desconto, entrada e a cláusula por
 *   extenso que o PDF imprime.
 *
 * ⛔ NÃO EMITE NADA. Ele escreve linhas no banco — `Budget`, `Billing`,
 * `BudgetPayer`, `Installment`, `BankSlip` — e não chama Elotech nem Sicredi. O
 * que emite de verdade é a APROVAÇÃO do faturamento, e por isso a cobrança
 * deste orçamento já nasce aprovada (`approvedAt`): assim não há botão de
 * aprovar para alguém apertar sem querer numa máquina que está com as
 * credenciais de produção.
 *
 * ⚠️ IDEMPOTENTE. Reconhece o que já criou pelo `serialNumber` do veículo
 * (`DEMO-PORTAL-1`) e refaz o conjunto inteiro em vez de duplicar.
 *
 *   npx tsx scripts/seed-portal-pagamento-demo.ts               # o MEI do dono
 *   npx tsx scripts/seed-portal-pagamento-demo.ts <contato>     # outro contato
 *   npx tsx scripts/seed-portal-pagamento-demo.ts --limpar      # desfaz
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/** O contato cuja EMPRESA recebe a demonstração. */
const CONTATO_PADRAO = 'kennedy.ankaa@gmail.com';
/** A marca do que este script criou — é por ela que ele se reconhece. */
const SERIE = 'DEMO-PORTAL-1';

const dias = (n: number): Date => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
const reais = (v: number) => new Prisma.Decimal(v.toFixed(2));

async function alvo(contato: string) {
  const responsavel = await prisma.responsible.findFirst({
    where: { OR: [{ email: contato }, { phone: contato.replace(/\D/g, '') }] },
    select: { id: true, name: true, companyId: true },
  });
  if (!responsavel) throw new Error(`Nenhum responsável com o contato ${contato}.`);

  const cliente = await prisma.customer.findUnique({
    where: { id: responsavel.companyId ?? '' },
    select: { id: true, fantasyName: true, corporateName: true },
  });
  if (!cliente) throw new Error('O responsável aponta para um cliente que não existe.');

  return { responsavel, cliente };
}

/**
 * Apaga o conjunto anterior, NA ORDEM DAS CHAVES.
 *
 * ⛔ `budget.delete()` sozinho NÃO basta, e o erro é explícito:
 * `Installment_customerConfigId_fkey`. A cascata do orçamento derruba
 * `Billing` e `BudgetPayer`, mas a parcela aponta para o pagador com
 * `Restrict` — dinheiro não some por tabela em cascata, que é a regra certa
 * para produção e a que obriga este script a limpar de dentro para fora:
 * boleto → parcela → fatura → o resto.
 */
async function limpar(): Promise<string | null> {
  // DD1: a série é única no IMPLEMENTO.
  const tarefa =
    (
      await prisma.implement.findUnique({
        where: { serialNumber: SERIE },
        select: { task: { select: { id: true, quoteId: true } } },
      })
    )?.task ?? null;
  if (!tarefa) return null;

  const pagadores = tarefa.quoteId
    ? await prisma.budgetPayer.findMany({
        where: { quoteId: tarefa.quoteId },
        select: { id: true },
      })
    : [];
  const ids = pagadores.map(p => p.id);

  if (ids.length) {
    const parcelas = await prisma.installment.findMany({
      where: { customerConfigId: { in: ids } },
      select: { id: true },
    });
    await prisma.bankSlip.deleteMany({
      where: { installmentId: { in: parcelas.map(p => p.id) } },
    });
    await prisma.installment.deleteMany({ where: { customerConfigId: { in: ids } } });
    await prisma.invoice.deleteMany({ where: { customerConfigId: { in: ids } } });
  }
  await prisma.invoice.deleteMany({ where: { taskId: tarefa.id } });

  // ⚠️ E A TAREFA SAI EXPLICITAMENTE. `Task.quoteId` é opcional, então apagar o
  // orçamento apenas a DESLIGA dele (`SetNull`) — o veículo sobrevive, e a
  // segunda rodada do script bate no `serialNumber` único.
  if (tarefa.quoteId) {
    await prisma.budget.delete({ where: { id: tarefa.quoteId } });
  }
  await prisma.task.delete({ where: { id: tarefa.id } });
  return tarefa.quoteId ?? tarefa.id;
}

async function semear(contato: string): Promise<void> {
  const { responsavel, cliente } = await alvo(contato);

  // ⚠️ `ServiceOrder.createdById` é OBRIGATÓRIO — toda O.S. tem um autor. Numa
  // demonstração não há autor de verdade, então empresta-se o primeiro usuário
  // do cadastro: é dado de exibição interna e não aparece no portal.
  const autor = await prisma.user.findFirst({ select: { id: true } });
  if (!autor) throw new Error('Nenhum usuário no banco para assinar as O.S. de demonstração.');
  const apagado = await limpar();
  if (apagado) console.log(`  (o conjunto anterior foi removido)`);

  const ultimo = await prisma.budget.findFirst({
    orderBy: { budgetNumber: 'desc' },
    select: { budgetNumber: true },
  });
  const numero = (ultimo?.budgetNumber ?? 0) + 1;

  // ── OS SERVIÇOS, e o valor que sai deles ────────────────────────────────
  const servicos = [
    { description: 'PINTURA GERAL DO BAÚ', amount: 12500, position: 0 },
    { description: 'FAIXA REFLETIVA NAS DUAS LATERAIS', amount: 3800, position: 1 },
    { description: 'LOGOMARCA NAS PORTAS TRASEIRAS', amount: 2450, position: 2 },
  ];
  const subtotal = servicos.reduce((s, x) => s + x.amount, 0);
  /** 5% de desconto — é o que faz o total DIFERIR do subtotal na tela. */
  const descontoPct = 5;
  const total = Number((subtotal * (1 - descontoPct / 100)).toFixed(2));

  const orcamento = await prisma.budget.create({
    data: {
      budgetNumber: numero,
      subtotal: reais(subtotal),
      total: reais(total),
      expiresAt: dias(30),
      status: 'APPROVED',
      statusOrder: 7,
      vehicleCount: 1,
      billingSplit: 'JOINT',
      services: { create: servicos.map(s => ({ ...s, amount: reais(s.amount) })) },
      tasks: {
        create: {
          name: 'Baú refrigerado — demonstração do portal',
          // DD1: a série nasce no implemento (o da tarefa é espelho).
          implement: { create: { serialNumber: SERIE, spot: null } },
          customer: { connect: { id: cliente.id } },
          status: 'COMPLETED',
          statusOrder: 6,
          entryDate: dias(-20),
          term: dias(-5),
          startedAt: dias(-18),
          finishedAt: dias(-6),
          // As O.S. da produção — é o que a linha do tempo pendura em
          // "Em produção", e todas fechadas é o que faz o controle de
          // qualidade aparecer.
          serviceOrders: {
            create: [
              {
                description: 'PREPARAÇÃO E LIXAMENTO',
                status: 'COMPLETED',
                statusOrder: 3,
                createdById: autor.id,
                startedAt: dias(-18),
                finishedAt: dias(-14),
              },
              {
                description: 'PINTURA GERAL DO BAÚ',
                status: 'COMPLETED',
                statusOrder: 3,
                createdById: autor.id,
                startedAt: dias(-14),
                finishedAt: dias(-9),
              },
              {
                description: 'APLICAÇÃO DE FAIXAS E LOGOMARCA',
                status: 'COMPLETED',
                statusOrder: 3,
                createdById: autor.id,
                startedAt: dias(-9),
                finishedAt: dias(-6),
              },
            ],
          },
        },
      },
    },
    select: { id: true, budgetNumber: true },
  });

  // ── A APROVAÇÃO DO ORÇAMENTO, NO CHANGELOG ──────────────────────────────
  //
  // ⚠️ É DE LÁ que o marco "Orçamento aprovado" tira a data — não há coluna de
  // `approvedAt` no orçamento (`Budget.billingApprovedAt` é a aprovação do
  // FATURAMENTO, outro ato). Um orçamento semeado direto em `APPROVED`, sem
  // esta linha, aparece no portal com "data não registrada", que é exatamente
  // o que o dono viu no primeiro cenário.
  await prisma.changeLog.create({
    data: {
      entityType: 'TASK_QUOTE',
      entityId: orcamento.id,
      action: 'UPDATE',
      field: 'status',
      oldValue: 'PENDING',
      newValue: 'APPROVED',
      reason: 'Aprovação do orçamento (demonstração do portal)',
      createdAt: dias(-22),
    },
  });

  // ── A COBRANÇA, JÁ APROVADA ─────────────────────────────────────────────
  // Ver o cabeçalho: nasce aprovada para que não exista botão de aprovar nesta
  // máquina, que está com as credenciais fiscais de produção.
  const cobranca = await prisma.billing.create({
    data: { quoteId: orcamento.id, status: 'APPROVED', statusOrder: 4, approvedAt: dias(-6) },
    select: { id: true },
  });

  const pagador = await prisma.budgetPayer.create({
    data: {
      quoteId: orcamento.id,
      billingId: cobranca.id,
      customerId: cliente.id,
      subtotal: reais(subtotal),
      total: reais(total),
      discountType: 'PERCENTAGE',
      discountValue: reais(descontoPct),
      discountReference: 'Negociado com o comercial',
      generateInvoice: true,
      generateBankSlip: true,
      // A MESMA forma que a tela do comercial grava. `entryDays` conta da
      // finalização do serviço; `installmentStep` é o intervalo entre as demais.
      paymentConfig: {
        type: 'INSTALLMENTS',
        method: 'BANK_SLIP',
        installmentCount: 4,
        installmentStep: 30,
        entryDays: 10,
      },
    },
    select: { id: true },
  });

  // ── A FATURA ────────────────────────────────────────────────────────────
  //
  // ⚠️ SEM ELA A TELA DE COBRANÇAS FICA VAZIA, e o orçamento mostra o plano —
  // foi exatamente o que aconteceu na primeira versão deste script. As duas
  // telas leem coisas DIFERENTES, de propósito:
  //
  //   · o card "Pagamento" do orçamento lê o PLANO (`BudgetPayer.installments`):
  //     o que foi acertado, e ele existe desde a negociação;
  //   · a lista "Cobranças" lê a FATURA (`Invoice`, escopada por
  //     `Invoice.customerId`): o que já virou documento a pagar, e ela só nasce
  //     na aprovação do faturamento.
  //
  // Em produção quem cria a fatura é `generateInvoicesForTaskDetailed`, na
  // aprovação. Aqui a cobrança já nasce aprovada (ver acima), então a fatura
  // tem de vir junto — senão o registro fica num estado que a produção nunca
  // produz: faturamento aprovado sem fatura nenhuma.
  const valorParcela = Number((total / 4).toFixed(2));
  const tarefa =
    (
      await prisma.implement.findUnique({
        where: { serialNumber: SERIE },
        select: { task: { select: { id: true } } },
      })
    )?.task ?? null;
  const fatura = await prisma.invoice.create({
    data: {
      customerId: cliente.id,
      customerConfigId: pagador.id,
      taskId: tarefa?.id ?? null,
      totalAmount: reais(total),
      paidAmount: reais(Number((total / 4).toFixed(2))),
      status: 'PARTIALLY_PAID',
    },
    select: { id: true },
  });

  // ── AS PARCELAS: uma paga, uma com boleto vivo, duas em aberto ──────────
  const parcelas = [
    { number: 1, dueDate: dias(-4), status: 'PAID' as const, pago: valorParcela, boleto: false },
    { number: 2, dueDate: dias(26), status: 'PENDING' as const, pago: 0, boleto: true },
    { number: 3, dueDate: dias(56), status: 'PENDING' as const, pago: 0, boleto: false },
    { number: 4, dueDate: dias(86), status: 'PENDING' as const, pago: 0, boleto: false },
  ];

  for (const p of parcelas) {
    const parcela = await prisma.installment.create({
      data: {
        customerConfigId: pagador.id,
        // É este vínculo que faz a parcela aparecer DENTRO da fatura na tela
        // de Cobranças, e não só na lista do orçamento.
        invoiceId: fatura.id,
        number: p.number,
        dueDate: p.dueDate,
        amount: reais(valorParcela),
        paidAmount: reais(p.pago),
        paidAt: p.status === 'PAID' ? dias(-4) : null,
        status: p.status,
      },
      select: { id: true },
    });

    if (p.boleto) {
      await prisma.bankSlip.create({
        data: {
          installmentId: parcela.id,
          // Número fictício, com a marca do teste no prefixo para que ninguém
          // o confunda com um título de verdade registrado no Sicredi.
          nossoNumero: `DEMO${Date.now().toString().slice(-8)}`,
          amount: reais(valorParcela),
          dueDate: p.dueDate,
          status: 'ACTIVE',
          digitableLine: '74891.11223 34455.667788 99001.122334 5 99990000012345',
        },
      });
    }
  }

  console.log('');
  console.log(`  Orçamento nº ${orcamento.budgetNumber} criado para ${cliente.fantasyName}`);
  console.log(`  Contato que enxerga: ${responsavel.name} (${contato})`);
  console.log(`  Subtotal R$ ${subtotal.toFixed(2)} · desconto ${descontoPct}% · total R$ ${total.toFixed(2)}`);
  console.log(`  4 parcelas de R$ ${valorParcela.toFixed(2)} — a 1ª paga, a 2ª com boleto ativo`);
  console.log(`  Abra: /cliente/painel/orcamentos/${orcamento.id}`);
  console.log(`  E a mesma cobrança em: /cliente/painel/cobrancas`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--limpar')) {
    const apagado = await limpar();
    console.log(apagado ? '  Demonstração removida.' : '  Não havia nada para remover.');
    return;
  }
  const contato = args.find(a => !a.startsWith('--')) ?? CONTATO_PADRAO;
  await semear(contato);
}

main()
  .catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // Ver `reference_prod_server_access`: script de AppModule fica pendurado.
    // Este não sobe o Nest, mas o `exit` explícito mantém o hábito.
    process.exit(process.exitCode ?? 0);
  });
