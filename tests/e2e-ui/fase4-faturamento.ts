/**
 * FASE 4/5 — FATURAMENTO, NFS-e E BOLETO.
 *
 * É aqui que a pergunta do dia se responde: com fatura ÚNICA para N veículos,
 * com uma fatura POR veículo e com LOTES, o valor do boleto, o valor da nota e
 * a discriminação saem certos?
 *
 * Nada é emitido de verdade: Elotech e Sicredi estão numa sentinela local que
 * RESPONDE sucesso e GRAVA o corpo. O teste afirma sobre o corpo gravado — é o
 * que teria ido para a prefeitura e para o banco.
 */
import { chromium, Browser, Page } from 'playwright';
import { prisma, sentinelaReset, sentinelaCalls, waitCall, mailPurge } from './helpers/env';
import { check, phase, scenario, report, info, money, near } from './helpers/harness';
import {
  login, createQuote, openQuoteDetail, gotoCustomerStep, goToLastStep, setQuoteStatus,
  openBillingDetail, setPaymentCondition, setLots, saveDetail, BASE, pause,
} from './helpers/ui';

/**
 * A faixa de séries desta corrida. `QA_SERIAL_BASE` a fixa — é o que permite
 * rodar esta fase ao lado das outras sem disputar número de série (ele é ÚNICO
 * no sistema, e repetir um faz o save ser barrado por um toast).
 */
const S = Number(process.env.QA_SERIAL_BASE ?? 95000 + Math.floor((Date.now() / 1000) % 4000));
const PRECO = 1200; // por veículo

interface Cenario {
  tag: string;
  nome: string;
  serials: string;
  nVeic: number;
  billing?: ('JOINT' | 'PER_TASK')[];
  lotes?: number[][]; // índices de veículos por lote, aplicados no detalhe
  condicao: RegExp;
  parcelasPorFatura: number;
  coberturaEsperada: number[];
}

const CENARIOS: Cenario[] = [
  { tag: 'F1', nome: 'FATURA ÚNICA para 2 veículos', serials: `${S} ${S + 1}`, nVeic: 2,
    condicao: /À Vista - Boleto/, parcelasPorFatura: 1, coberturaEsperada: [2] },
  { tag: 'F2', nome: 'UMA FATURA POR VEÍCULO (2), parcelado 2x', serials: `${S + 10} ${S + 11}`, nVeic: 2,
    billing: ['PER_TASK'], condicao: /Parcelado 2x/, parcelasPorFatura: 2, coberturaEsperada: [1, 1] },
  { tag: 'F3', nome: 'LOTES 1+2 num orçamento de 3', serials: `${S + 20} ${S + 22}`, nVeic: 3,
    lotes: [[0], [1, 2]], condicao: /À Vista - Boleto/, parcelasPorFatura: 1, coberturaEsperada: [1, 2] },
];

async function main() {
  const browser: Browser = await chromium.launch({ headless: true });
  const page: Page = await (await browser.newContext({ viewport: { width: 1600, height: 2200 }, locale: 'pt-BR' })).newPage();
  page.on('response', r => {
    if (r.status() >= 500 && r.url().includes(':3031')) console.log(`   [HTTP ${r.status()}] ${r.url().slice(0, 130)}`);
  });

  phase(`FASE 4/5 — faturamento, NFS-e e boleto (séries a partir de ${S})`);
  // ⚠️ SÓ LIMPA A SENTINELA QUANDO RODA SOZINHA — em paralelo, apagar o registro
  // levaria junto as chamadas que os outros workers ainda vão conferir.
  if (!process.env.QA_SHARD) {
    await sentinelaReset();
    await mailPurge();
  }
  await login(page, 'qa.admin@ankaa.test');

  for (const c of CENARIOS) {
    let quoteId = '';
    let marcador = 0;
    let tasks: { id: string; serialNumber: string | null }[] = [];

    await scenario(`${c.tag} · ${c.nome} — criar e aprovar orçamento`, page, async () => {
      const res = await createQuote(page, {
        name: `QA Fat ${c.tag} ${S}`,
        customer: /QA Alfa/, customerSearch: 'QA Alfa', category: /^Truck$/,
        serials: c.serials,
        orderNumber: `PED${c.tag}${S}`,
        services: [{ search: 'Logomarca', option: /./, amount: String(PRECO * 100) }],
        billing: c.billing,
        paymentCondition: c.condicao,
      });
      const taskId = res.url.split('/').pop()!;
      const t = await prisma.task.findUnique({ where: { id: taskId }, select: { quoteId: true } });
      quoteId = t!.quoteId!;
      const q = await prisma.taskQuote.findUnique({
        where: { id: quoteId },
        select: { budgetNumber: true, total: true, tasks: { select: { id: true, serialNumber: true }, orderBy: { serialNumber: 'asc' } } },
      });
      tasks = q!.tasks;
      info(`orçamento nº ${q!.budgetNumber} · ${tasks.length} veículos · contrato ${money(Number(q!.total))}`);
      check(`${c.tag}: nasceram ${c.nVeic} veículos`, tasks.length === c.nVeic, `${tasks.length}`);

      if (c.lotes) {
        await openQuoteDetail(page, tasks[0].id);
        await gotoCustomerStep(page, 1);
        await setLots(page, c.lotes.map(g => g.map(i => tasks[i].serialNumber!)));
        await saveDetail(page);
      }

      await openQuoteDetail(page, tasks[0].id);
      await goToLastStep(page);
      await setQuoteStatus(page, /Or.amento Aprovado/);
      const st = await prisma.taskQuote.findUnique({ where: { id: quoteId }, select: { status: true } });
      check(`${c.tag}: orçamento ficou BUDGET_APPROVED`, st?.status === 'BUDGET_APPROVED', `status=${st?.status}`);
    });

    await scenario(`${c.tag} · aprovar FATURAMENTO pela tela`, page, async () => {
      // Com uma fatura por veículo a aprovação é POR FATIA: cada caminhão é
      // aprovado na tela dele e emite a própria fatura. Aprovar um só e esperar
      // as duas seria testar uma regra que o sistema deliberadamente não tem.
      marcador = (await sentinelaCalls()).length ? Math.max(...(await sentinelaCalls()).map(x => x.seq)) : 0;
      // UM VEÍCULO POR FATURA A APROVAR. Com fatura única é um só; com cobrança
      // por veículo ou em lotes, cada fatura é aprovada na tela de um veículo
      // que ela cobre — é assim que "os sessenta não terminam no mesmo dia"
      // deveria funcionar.
      const cfgs = await prisma.taskQuoteCustomerConfig.findMany({
        where: { quoteId },
        select: { id: true, coveredTasks: { select: { taskId: true } } },
      });
      const alvos = cfgs.length > 1
        ? cfgs.map(cfg => tasks.find(t => cfg.coveredTasks.some(r => r.taskId === t.id))!).filter(Boolean)
        : [tasks[0]];
      for (const alvo of alvos) {
        await openBillingDetail(page, alvo.id);
        // A declaração de cobertura fica no passo do CLIENTE, não no resumo.
        const naTela = await page.evaluate(() => (document.querySelector('main') as HTMLElement)?.innerText ?? '');
        const cobre = naTela.match(/Esta fatura cobra [^\n]+/g) ?? [];
        if (alvo === alvos[0]) info(`a tela declara a cobertura: ${cobre.join(' ; ') || '(não declara neste passo)'}`);
        await goToLastStep(page);
        try {
          await setQuoteStatus(page, /Aprovar Faturamento/);
        } catch (err: any) {
          // Com cobrança fatiada cada veículo é aprovado na tela dele. Se o
          // seletor deixar de oferecer a aprovação depois da primeira fatia, as
          // outras ficam sem fatura, sem nota e sem boleto — e não há outro
          // caminho na interface. É defeito, não erro de teste.
          check(
            `${c.tag}: a fatia do veículo ${alvo.serialNumber} ainda pode ser aprovada na tela`,
            false,
            `${err?.message ?? err}`.slice(0, 220),
          );
        }
      }

      const q = await prisma.taskQuote.findUnique({
        where: { id: quoteId },
        select: {
          status: true,
          customerConfigs: {
            select: {
              id: true, total: true, billingApprovedAt: true,
              coveredTasks: { select: { task: { select: { serialNumber: true } } } },
            },
          },
        },
      });
      // Depois de aprovado o orçamento anda sozinho na esteira (BILLING_APPROVED
      // → UPCOMING quando a tarefa entra na fila), então o que se afirma é o
      // CARIMBO da aprovação, não um estado instantâneo.
      check(`${c.tag}: todas as fatias ficaram com billingApprovedAt`,
        (q?.customerConfigs ?? []).every(x => !!x.billingApprovedAt),
        JSON.stringify((q?.customerConfigs ?? []).map(x => !!x.billingApprovedAt)));
      check(`${c.tag}: o orçamento saiu de BUDGET_APPROVED`,
        ['BILLING_APPROVED', 'UPCOMING', 'DUE', 'PARTIAL', 'SETTLED'].includes(q?.status ?? ''), `status=${q?.status}`);
      const tamanhos = (q?.customerConfigs ?? []).map(x => x.coveredTasks.length).sort();
      check(`${c.tag}: cobertura ${JSON.stringify(c.coberturaEsperada)}`,
        JSON.stringify(tamanhos) === JSON.stringify([...c.coberturaEsperada].sort()), JSON.stringify(tamanhos));

      const invoices = await prisma.invoice.findMany({
        where: { customerConfigId: { in: (q?.customerConfigs ?? []).map(x => x.id) } },
        select: { id: true, totalAmount: true, customerConfigId: true, installments: { select: { amount: true, dueDate: true, number: true } } },
      });
      check(`${c.tag}: nasceram ${c.coberturaEsperada.length} fatura(s)`, invoices.length === c.coberturaEsperada.length, `${invoices.length}`);

      for (const inv of invoices) {
        const cfg = (q?.customerConfigs ?? []).find(x => x.id === inv.customerConfigId)!;
        const n = cfg.coveredTasks.length;
        const esperado = PRECO * n;
        check(`${c.tag}: fatura de ${n} veículo(s) = ${money(esperado)}`, near(Number(inv.totalAmount), esperado), money(Number(inv.totalAmount)));
        check(`${c.tag}: ${c.parcelasPorFatura} parcela(s) na fatura de ${n} veículo(s)`,
          inv.installments.length === c.parcelasPorFatura, `${inv.installments.length}`);
        const soma = inv.installments.reduce((s, i) => s + Number(i.amount), 0);
        check(`${c.tag}: a soma das parcelas fecha com a fatura`, near(soma, Number(inv.totalAmount)),
          `parcelas=${money(soma)} fatura=${money(Number(inv.totalAmount))}`);
      }
    });

    await scenario(`${c.tag} · o que IRIA à prefeitura e ao banco`, page, async () => {
      // A aprovação do faturamento JÁ dispara a emissão e o registro — não há
      // botão a apertar depois. O que o teste faz aqui é ler o que a sentinela
      // gravou e comparar com a fatura que o banco tem.
      // RECORTE POR CONTEÚDO, não por marcador: a sentinela é comum aos workers
      // que rodam ao mesmo tempo, e contar "tudo desde o marcador" contaria as
      // chamadas do vizinho. A série aparece na discriminação da nota; o número
      // do pedido (único por corrida) aparece no informativo do boleto.
      const pedido = `PED${c.tag}${S}`;
      const meu = (x: { body: unknown }) => {
        const texto = JSON.stringify(x.body ?? {});
        return texto.includes(pedido) || tasks.some(t => t.serialNumber && texto.includes(t.serialNumber));
      };
      const chamadas = (await sentinelaCalls()).filter(x => x.seq > marcador && meu(x));
      const notas = chamadas.filter(x => x.integration === 'elotech' && x.path.includes('salvar-nota-fiscal'));
      const boletos = chamadas.filter(x => x.integration === 'sicredi' && x.method === 'POST' && x.path.endsWith('/boletos'));

      const invoices = await prisma.invoice.findMany({
        where: { customerConfig: { quoteId } },
        select: {
          id: true, totalAmount: true,
          installments: { select: { amount: true, dueDate: true, number: true }, orderBy: { number: 'asc' } },
          customerConfig: { select: { coveredTasks: { select: { task: { select: { serialNumber: true } } } } } },
        },
      });
      check(`${c.tag}: saiu UMA NFS-e por fatura`, notas.length === invoices.length,
        `notas=${notas.length} faturas=${invoices.length}`);

      for (const inv of invoices) {
        const cobertos = inv.customerConfig!.coveredTasks.map(r => r.task?.serialNumber).filter(Boolean) as string[];
        const nota = notas.find(n => {
          const d = JSON.stringify(n.body ?? {});
          return cobertos.every(sn => d.includes(sn));
        });
        if (!check(`${c.tag}: existe a nota da fatura que cobre ${cobertos.join('+')}`, !!nota)) continue;
        const itens: any[] = (nota!.body as any)?.formItensNFSe ?? [];
        const liquido = Number(itens.reduce((a, i) => a + Number(i.valorLiquido ?? 0), 0).toFixed(2));
        const disc: string = (nota!.body as any)?.formDadosNFSe?.discriminacaoServico ?? '';
        info(`  nota de ${cobertos.length} veículo(s): líquido ${money(liquido)} · fatura ${money(Number(inv.totalAmount))}`);
        info(`  discriminação: ${disc.replace(/\n/g, ' ⏎ ')}`);

        check(
          `${c.tag}: o VALOR da NFS-e é o da fatura (${money(Number(inv.totalAmount))}) — cobre ${cobertos.length} veículo(s)`,
          near(liquido, Number(inv.totalAmount)),
          `nota=${money(liquido)} · fatura=${money(Number(inv.totalAmount))} · diferença=${money(Number(inv.totalAmount) - liquido)}`,
        );
        for (const sn of cobertos) {
          check(`${c.tag}: a discriminação nomeia o veículo ${sn}`, disc.includes(sn), disc.slice(0, 160));
        }
        const outros = (await prisma.task.findMany({
          where: { quoteId, serialNumber: { notIn: cobertos } }, select: { serialNumber: true },
        })).map(t => t.serialNumber).filter(Boolean) as string[];
        for (const sn of outros) {
          check(`${c.tag}: a discriminação NÃO cita ${sn} (está noutra nota)`, !disc.includes(sn), disc.slice(0, 160));
        }
        check(`${c.tag}: o número do pedido vai na nota`, new RegExp(`Pedido:\\s*PED${c.tag}${S}`, 'i').test(disc), disc.slice(0, 120));

        // ── BOLETO ──────────────────────────────────────────────────────────
        const usados = new Set<number>();
        for (const parcela of inv.installments) {
          // CONSOME o registro casado: duas parcelas de R$ 600 são dois boletos,
          // e um `find` sem consumo casava as duas com o mesmo — inventando um
          // defeito de vencimento que não existia.
          const b = boletos.find(
            x => !usados.has(x.seq) && near(Number((x.body as any)?.valor ?? -1), Number(parcela.amount)),
          );
          if (b) usados.add(b.seq);
          check(
            `${c.tag}: há boleto de ${money(Number(parcela.amount))} (parcela ${parcela.number}/${inv.installments.length})`,
            !!b,
            `valores registrados: ${JSON.stringify(boletos.map(x => (x.body as any)?.valor))}`,
          );
          if (b) {
            const venc = String((b.body as any)?.dataVencimento ?? '');
            const esperado = parcela.dueDate ? new Date(parcela.dueDate).toISOString().slice(0, 10) : '';
            check(`${c.tag}: o vencimento do boleto é o da parcela (${esperado})`, venc === esperado, `boleto=${venc}`);
          }
        }
      }
    });
  }

  await scenario('F9 · nada vazou', page, async () => {
    const calls = await sentinelaCalls();
    const escapes = calls.filter(x => x.integration === 'ESCAPE');
    check('F9: nenhuma chamada a caminho não mapeado', escapes.length === 0, JSON.stringify(escapes.slice(0, 5).map(e => e.path)));
    info(`sentinela gravou ${calls.length} chamadas: ${JSON.stringify(
      Object.entries(calls.reduce<Record<string, number>>((a, x) => ((a[x.integration] = (a[x.integration] ?? 0) + 1), a), {})))}`);
  });

  await browser.close();
  await prisma.$disconnect();
  process.exit(report() > 0 ? 1 : 0);
}

main();
