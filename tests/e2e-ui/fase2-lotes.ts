/**
 * FASE 2 — LOTES PELA TELA.
 *
 * "Os vinte primeiros no pedido 8842 e os quarenta restantes no 9013" é a
 * operação central da feature, e é a que só existe no DETALHE do orçamento
 * (na criação os veículos ainda não nasceram). O cenário grava, RECARREGA e
 * confere — recarregar é o que pega o defeito de gate de dirty: a tela confirma,
 * redireciona, e o banco continua 4×1.
 */
import { chromium } from 'playwright';
import { prisma, serialBase } from './helpers/env';
import { check, phase, scenario, report, money, near, info } from './helpers/harness';
import { login, createQuote, openQuoteDetail, gotoCustomerStep, setLots, readLots, saveDetail } from './helpers/ui';

// A fase cria o próprio orçamento: depender de um número fixo amarra a bateria
// ao estado deixado por outra corrida.
/**
 * A faixa de séries desta corrida. `QA_SERIAL_BASE` a fixa — é o que permite
 * rodar esta fase ao lado das outras sem disputar número de série (ele é ÚNICO
 * no sistema, e repetir um faz o save ser barrado por um toast).
 */
const S = serialBase(2);

async function coverage(quoteId: string) {
  const q = await prisma.taskQuote.findUnique({
    where: { id: quoteId },
    select: {
      billingSplit: true, total: true, vehicleCount: true,
      customerConfigs: {
        select: { id: true, total: true, billing: { select: { id: true, approvedAt: true, tasks: { select: { task: { select: { serialNumber: true } } } } } } },
      },
    },
  });
  const grupos = (q?.customerConfigs ?? [])
    .map(c => ({
      total: Number(c.total),
      seriais: (c.billing?.tasks ?? []).map(r => r.task?.serialNumber ?? '?').sort(),
    }))
    .sort((a, b) => (a.seriais[0] ?? '').localeCompare(b.seriais[0] ?? ''));
  return { split: q?.billingSplit, total: Number(q?.total ?? 0), grupos };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1600 }, locale: 'pt-BR' })).newPage();
  page.on('response', r => {
    if (r.status() >= 400 && r.url().includes(':3031')) console.log(`   [HTTP ${r.status()}] ${r.url().slice(0, 120)}`);
  });

  phase(`FASE 2 — lotes pela tela (séries ${S}–${S + 3})`);
  await login(page, 'qa.admin@ankaa.test');

  const criado = await createQuote(page, {
    name: `QA Lote ${S}`,
    customer: /QA Alfa/, customerSearch: 'QA Alfa', category: /^Truck$/,
    serials: `${S} ${S + 3}`,
    services: [{ search: 'Logomarca', option: /./, amount: '100000' }],
  });
  const t0 = await prisma.task.findUnique({ where: { id: criado.url.split('/').pop()! }, select: { quoteId: true } });
  const quote = await prisma.taskQuote.findUnique({
    where: { id: t0!.quoteId! },
    select: { id: true, budgetNumber: true, tasks: { select: { id: true, serialNumber: true }, orderBy: { serialNumber: 'asc' } } },
  });
  if (!quote) { check('orçamento de apoio existe', false, 'não criou'); return; }
  info(`orçamento nº ${quote.budgetNumber}`);
  const seriais = quote.tasks.map(t => t.serialNumber!);
  const primeiraTarefa = quote.tasks[0].id;
  info(`veículos: ${seriais.join(', ')}`);

  await scenario('L1 · compor 2+2 e GRAVAR', page, async () => {
    await openQuoteDetail(page, primeiraTarefa);
    await gotoCustomerStep(page, 1);
    await setLots(page, [seriais.slice(0, 2), seriais.slice(2)]);
    const naTela = await readLots(page);
    check(
      'L1: a tela mostra 2+2 ANTES de gravar',
      JSON.stringify(naTela.map(r => r.lot)) === JSON.stringify(['Lote 1', 'Lote 1', 'Lote 2', 'Lote 2']),
      JSON.stringify(naTela),
    );
    const label = await saveDetail(page);
    info(`gravou com o botão "${label}"`);

    const cov = await coverage(quote.id);
    check('L1: o banco tem DUAS faturas', cov.grupos.length === 2, JSON.stringify(cov.grupos));
    check(
      'L1: os lotes são 2+2, nos veículos certos',
      JSON.stringify(cov.grupos.map(g => g.seriais)) ===
        JSON.stringify([seriais.slice(0, 2), seriais.slice(2)]),
      JSON.stringify(cov.grupos.map(g => g.seriais)),
    );
    check('L1: cada lote cobra o dobro do veículo', cov.grupos.every(g => near(g.total, 2000)),
      cov.grupos.map(g => money(g.total)).join(' + '));
    check('L1: a soma dos lotes reconstrói o contrato',
      near(cov.grupos.reduce((s, g) => s + g.total, 0), 4000),
      money(cov.grupos.reduce((s, g) => s + g.total, 0)));
  });

  await scenario('L2 · RECARREGAR e conferir que o lote sobreviveu', page, async () => {
    await openQuoteDetail(page, primeiraTarefa);
    await gotoCustomerStep(page, 1);
    const naTela = await readLots(page);
    const grupos = new Map<string, string[]>();
    for (const { serial, lot } of naTela) grupos.set(lot, [...(grupos.get(lot) ?? []), serial]);
    check('L2: a tela relê DOIS lotes do banco', grupos.size === 2, JSON.stringify(naTela));
    check(
      'L2: Lote 1 é o do PRIMEIRO caminhão (não renumera debaixo da mão)',
      (grupos.get('Lote 1') ?? []).includes(seriais[0]),
      JSON.stringify(naTela),
    );
  });

  await scenario('L3 · recompor DESIGUAL (1+3) pela tela', page, async () => {
    await openQuoteDetail(page, primeiraTarefa);
    await gotoCustomerStep(page, 1);
    await setLots(page, [seriais.slice(0, 1), seriais.slice(1)]);
    await saveDetail(page);
    const cov = await coverage(quote.id);
    check('L3: duas faturas, agora 1 e 3', JSON.stringify(cov.grupos.map(g => g.seriais.length)) === '[1,3]',
      JSON.stringify(cov.grupos.map(g => g.seriais)));
    check('L3: o lote de 1 cobra R$ 1.000,00', near(cov.grupos[0]?.total ?? 0, 1000), money(cov.grupos[0]?.total ?? 0));
    check('L3: o lote de 3 cobra R$ 3.000,00', near(cov.grupos[1]?.total ?? 0, 3000), money(cov.grupos[1]?.total ?? 0));
    check('L3: a soma continua sendo o contrato',
      near(cov.grupos.reduce((s, g) => s + g.total, 0), 4000),
      money(cov.grupos.reduce((s, g) => s + g.total, 0)));
  });

  await scenario('L4 · voltar para FATURA ÚNICA', page, async () => {
    await openQuoteDetail(page, primeiraTarefa);
    await gotoCustomerStep(page, 1);
    const { pickCombo } = await import('./helpers/ui');
    await pickCombo(page, /Lotes —|Fatura .nica|Uma fatura por/, null, /Fatura .nica/);
    await page.waitForTimeout(1200);
    await saveDetail(page);
    const cov = await coverage(quote.id);
    check('L4: uma fatura só, cobrindo os 4', cov.grupos.length === 1 && cov.grupos[0].seriais.length === 4,
      JSON.stringify(cov.grupos.map(g => g.seriais)));
    check('L4: ela cobra o contrato inteiro', near(cov.grupos[0]?.total ?? 0, 4000), money(cov.grupos[0]?.total ?? 0));
  });

  await browser.close();
  await prisma.$disconnect();
  process.exit(report() > 0 ? 1 : 0);
}

main();
