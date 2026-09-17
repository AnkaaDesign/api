/**
 * FASE 6 — A TROCA DE MODO DE FATURAMENTO, NOS DOIS SENTIDOS E DEPOIS DE FATURAR.
 *
 * A fase 2 prova a recomposição enquanto NADA foi faturado: lotes 2+2, 1+3, e de
 * volta para fatura única. O que faltava é o caso duro, que é o que acontece na
 * vida: metade do orçamento já virou nota e boleto, e alguém quer refatiar.
 *
 * Até aqui isso era pior do que recusado — era ACEITO EM SILÊNCIO. A guarda da
 * troca de modo contava só `billingApprovedAt`, e havia quatro caminhos que a
 * contornavam; a reconciliação então PULAVA a fatia congelada e devolvia 200. O
 * orçamento passava a afirmar um modo que a cobertura contradizia, e num dos
 * caminhos a fatia aprovada era simplesmente APAGADA, com a fatura cancelada.
 *
 * O que esta fase fixa:
 *
 *   M1  a troca funciona nos dois sentidos enquanto nada foi faturado
 *       (único → por veículo → único), e o dinheiro fecha nos dois.
 *   M2  com UMA fatia já faturada, a troca é RECUSADA — com uma frase que diz o
 *       que fazer — e o banco não se mexe.
 *   M3  revertida aquela fatia, a MESMA troca passa. A recusa era temporária e o
 *       caminho de saída existe pela tela.
 */
import { chromium } from 'playwright';
import { prisma, serialBase } from './helpers/env';
import { check, phase, scenario, report, money, near, info } from './helpers/harness';
import {
  API,
  login, createQuote, openQuoteDetail, gotoCustomerStep, saveDetail, pickCombo,
  goToLastStep, setQuoteStatus, openBillingDetail, approveBillingForOpenVehicle,
  revertBilling, screenText, pause,
} from './helpers/ui';

const S = serialBase(6);
const PRECO = 1000;

/** O retrato do faturamento: quantas fatias, o que cada uma cobre, e quanto cobra. */
async function retrato(quoteId: string) {
  const q = await prisma.budget.findUnique({
    where: { id: quoteId },
    select: {
      billingSplit: true, total: true, vehicleCount: true,
      customerConfigs: {
        select: {
          id: true, total: true,
          billing: { select: { id: true, approvedAt: true, tasks: { select: { task: { select: { serialNumber: true } } } } } },
          invoices: { select: { id: true, status: true } },
        },
      },
    },
  });
  const grupos = (q?.customerConfigs ?? [])
    .map(c => ({
      id: c.id,
      total: Number(c.total),
      aprovada: !!c.billing?.approvedAt,
      faturasVivas: c.invoices.filter(i => i.status !== 'CANCELLED').length,
      seriais: (c.billing?.tasks ?? []).map(r => r.task?.serialNumber ?? '?').sort(),
    }))
    .sort((a, b) => (a.seriais[0] ?? '').localeCompare(b.seriais[0] ?? ''));
  return { split: q?.billingSplit, total: Number(q?.total ?? 0), grupos };
}

const forma = (r: Awaited<ReturnType<typeof retrato>>) =>
  r.grupos.map(g => g.seriais.join('+')).join(' | ');

/** Troca o modo no passo "Cliente 1" do DETALHE do orçamento e grava. */
async function trocarModo(page: any, taskId: string, alvo: RegExp): Promise<string> {
  await openQuoteDetail(page, taskId);
  await gotoCustomerStep(page, 1);
  await pickCombo(page, /Fatura .nica para os|Uma fatura por ve.culo|Lotes —/, null, alvo);
  await pause(page, 1200);
  return await saveDetail(page);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 2000 }, locale: 'pt-BR' })).newPage();
  page.on('response', r => {
    if (r.status() >= 500 && r.url().includes(':3031')) console.log(`   [HTTP ${r.status()}] ${r.url().slice(0, 120)}`);
  });

  phase(`FASE 6 — troca de modo de faturamento (séries ${S}–${S + 3})`);
  await login(page, 'qa.admin@ankaa.test');

  const criado = await createQuote(page, {
    name: `QA Troca ${S}`,
    customer: /QA Alfa/, customerSearch: 'QA Alfa', category: /^Truck$/,
    serials: `${S} ${S + 3}`,
    orderNumber: `PEDM${S}`,
    services: [{ search: 'Logomarca', option: /./, amount: String(PRECO * 100) }],
    paymentCondition: /À Vista - Boleto/,
  });
  const t0 = await prisma.task.findUnique({
    where: { id: criado.url.split('/').pop()! },
    select: { quoteId: true },
  });
  const quote = await prisma.budget.findUnique({
    where: { id: t0!.quoteId! },
    select: { id: true, budgetNumber: true, tasks: { select: { id: true, serialNumber: true }, orderBy: { serialNumber: 'asc' } } },
  });
  if (!quote) { check('orçamento de apoio existe', false, 'não criou'); return; }
  info(`orçamento nº ${quote.budgetNumber} · veículos ${quote.tasks.map(t => t.serialNumber).join(', ')}`);
  const CONTRATO = PRECO * 4;
  const v = quote.tasks;

  // ───────────────────────────────────────────────────────────────────────────
  await scenario('M1 · único → por veículo → único, com nada faturado', page, async () => {
    const inicial = await retrato(quote.id);
    check('nasce com UMA fatura cobrindo os 4', inicial.grupos.length === 1 && inicial.grupos[0].seriais.length === 4, forma(inicial));
    check('e ela cobra o contrato inteiro', near(inicial.grupos[0]?.total ?? 0, CONTRATO), money(inicial.grupos[0]?.total ?? 0));

    await trocarModo(page, v[0].id, /Uma fatura por ve.culo/);
    const separado = await retrato(quote.id);
    check('trocou para QUATRO faturas, uma por veículo',
      separado.grupos.length === 4 && separado.grupos.every(g => g.seriais.length === 1), forma(separado));
    check('cada uma cobra um veículo',
      separado.grupos.every(g => near(g.total, PRECO)), separado.grupos.map(g => money(g.total)).join(' '));
    check('a soma das quatro reconstrói o contrato',
      near(separado.grupos.reduce((s, g) => s + g.total, 0), CONTRATO));

    await trocarModo(page, v[0].id, /Fatura .nica para os/);
    const junto = await retrato(quote.id);
    check('voltou para UMA fatura cobrindo os 4',
      junto.grupos.length === 1 && junto.grupos[0].seriais.length === 4, forma(junto));
    check('e ela cobra o contrato de novo', near(junto.grupos[0]?.total ?? 0, CONTRATO), money(junto.grupos[0]?.total ?? 0));
  });

  // ───────────────────────────────────────────────────────────────────────────
  await scenario('M2 · com uma fatia FATURADA, a tela TRAVA a troca e o servidor recusa', page, async () => {
    // Prepara: por veículo, orçamento aprovado, e o primeiro caminhão faturado.
    await trocarModo(page, v[0].id, /Uma fatura por ve.culo/);
    await openQuoteDetail(page, v[0].id);
    await goToLastStep(page);
    await setQuoteStatus(page, /^Aprovado$/);
    await pause(page, 2500);

    await openBillingDetail(page, v[0].id);
    await goToLastStep(page);
    await approveBillingForOpenVehicle(page);
    await pause(page, 9000);

    const antes = await retrato(quote.id);
    const presas = antes.grupos.filter(g => g.aprovada || g.faturasVivas > 0);
    if (!check('uma fatia ficou faturada', presas.length === 1, `${presas.length} · ${forma(antes)}`)) return;

    // ── A TELA ────────────────────────────────────────────────────────────
    // A recusa aqui NÃO é um toast depois de tentar: o seletor fica TRAVADO, e
    // ao lado dele a tela diz por quê e como sair. Recusar antes de deixar
    // pedir é melhor do que recusar depois — e é o que o componente faz.
    await openQuoteDetail(page, v[0].id);
    await gotoCustomerStep(page, 1);
    const seletor = page
      .locator('[role="combobox"]')
      .filter({ hasText: /Fatura .nica para os|Uma fatura por ve.culo|Lotes —/ })
      .first();
    check('o seletor de junto/separado/lotes continua na tela', (await seletor.count()) > 0);
    check('e está TRAVADO', await seletor.isDisabled());

    const tela = await screenText(page);
    check('a tela diz que há fatura aprovada', /j. foi aprovada|j. foram aprovadas/i.test(tela),
      tela.split('\n').filter(l => /aprovad/i.test(l)).slice(0, 3).join(' | '));
    check('e diz o caminho de saída (reverter)', /Reverta o faturamento/i.test(tela),
      tela.split('\n').filter(l => /revert/i.test(l)).slice(0, 3).join(' | '));

    // ── E O SERVIDOR, POR BAIXO ───────────────────────────────────────────
    // A trava da tela conta só `billingApprovedAt`. Uma fatia pode estar
    // congelada por ter FATURA VIVA sem carimbo de aprovação — é o que a
    // conciliação bancária produz — e nesse caso a tela não trava nada. O
    // servidor precisa recusar sozinho, senão a reconciliação pula a fatia em
    // silêncio e o orçamento passa a afirmar um modo que a cobertura contradiz.
    const resp = await page.evaluate(
      async ([api, quoteId]: string[]) => {
        // O token não tem chave fixa conhecida pelo teste — procura-se o JWT em
        // qualquer entrada do storage. Chutar a chave dava 401, e 401 é 4xx: o
        // teste "passava" sem nunca ter chegado à guarda que queria exercitar.
        let jwt = '';
        for (const store of [localStorage, sessionStorage]) {
          for (let i = 0; i < store.length; i++) {
            const raw = store.getItem(store.key(i)!) ?? '';
            const hit = raw.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
            if (hit) { jwt = hit[0]; break; }
          }
          if (jwt) break;
        }
        const r = await fetch(`${api}/task-quotes/${quoteId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ billingSplit: 'JOINT' }),
        });
        return { status: r.status, body: (await r.text()).slice(0, 500), autenticou: jwt !== '' };
      },
      [API, quote.id],
    );
    check('a sonda do servidor foi autenticada (senão não testa nada)',
      resp.autenticou && resp.status !== 401, `autenticou=${resp.autenticou} HTTP ${resp.status}`);
    check('o servidor recusa a troca com 4xx', resp.status >= 400 && resp.status < 500, `HTTP ${resp.status}`);
    check('e a recusa do servidor também manda reverter', /revert/i.test(resp.body), resp.body);

    // ── E NADA SE MEXEU ───────────────────────────────────────────────────
    const depois = await retrato(quote.id);
    check('o banco continua com as QUATRO fatias', depois.grupos.length === 4, forma(depois));
    check('a cobertura é exatamente a mesma de antes', forma(depois) === forma(antes),
      `${forma(antes)} → ${forma(depois)}`);
    check('a fatia faturada continua faturada',
      depois.grupos.filter(g => g.aprovada || g.faturasVivas > 0).length === 1);
    check('a soma continua sendo o contrato',
      near(depois.grupos.reduce((s, g) => s + g.total, 0), CONTRATO));
  });

  // ───────────────────────────────────────────────────────────────────────────
  await scenario('M3 · revertida a fatia, a MESMA troca passa', page, async () => {
    await openBillingDetail(page, v[0].id);
    await goToLastStep(page);
    await revertBilling(page);
    await pause(page, 9000);

    const revertido = await retrato(quote.id);
    const presas = revertido.grupos.filter(g => g.aprovada || g.faturasVivas > 0);
    if (!check('nenhuma fatia continua presa depois de reverter', presas.length === 0,
      presas.map(g => `${g.seriais.join('+')} aprovada=${g.aprovada} vivas=${g.faturasVivas}`).join(' · '))) return;

    const toast = await trocarModo(page, v[0].id, /Fatura .nica para os/);
    const junto = await retrato(quote.id);
    check('a troca passou', junto.grupos.length === 1, `${forma(junto)} · toast: ${toast}`);
    check('uma fatura cobrindo os 4', junto.grupos[0]?.seriais.length === 4, forma(junto));
    check('cobrando o contrato inteiro', near(junto.grupos[0]?.total ?? 0, CONTRATO), money(junto.grupos[0]?.total ?? 0));

    // E de volta, para provar que o caminho não é de mão única.
    await trocarModo(page, v[0].id, /Uma fatura por ve.culo/);
    const separado = await retrato(quote.id);
    check('e volta a separar em quatro', separado.grupos.length === 4, forma(separado));
    check('a soma continua fechando', near(separado.grupos.reduce((s, g) => s + g.total, 0), CONTRATO));
  });

  await browser.close();
  await prisma.$disconnect();
  process.exit(report() > 0 ? 1 : 0);
}

main();
