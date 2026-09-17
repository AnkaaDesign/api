/**
 * A TELA DE FATURAMENTO É DE UMA COBRANÇA — não do orçamento inteiro.
 *
 * O print de 16/09: orçamento de 3 veículos cobrado veículo a veículo, aberto em
 * `/financeiro/faturamento/detalhes/<taskId>`, e o Resumo desenhando os três
 * cartões (55556, 55557, 55558) lado a lado. Três cobranças separadas, uma tela.
 *
 * Duas causas, as duas consertadas:
 *   1. o Resumo filtrava por CLIENTE, e as três cobranças são do mesmo CNPJ —
 *      o filtro não cortava nada;
 *   2. a tela ainda carregava "Proposta" e "Serviços", que são do ORÇAMENTO.
 *
 * Este arquivo é curto de propósito: ele responde a UMA pergunta, a que o dono
 * fez, e responde pela tela.
 */
import { chromium } from 'playwright';
import { prisma, serialBase } from './helpers/env';
import { check, phase, scenario, report, info } from './helpers/harness';
import { login, createQuote, openBillingDetail, goToLastStep, stepTitles, screenText } from './helpers/ui';

const S = serialBase(7);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 2400 }, locale: 'pt-BR' })).newPage();

  phase(`FATURAMENTO SEPARADO — 3 veículos, um faturamento por veículo (séries ${S}–${S + 2})`);
  await login(page, 'qa.admin@ankaa.test');

  const criado = await createQuote(page, {
    name: `QA Separado ${S}`,
    customer: /QA Alfa/, customerSearch: 'QA Alfa', category: /^Truck$/,
    serials: `${S} ${S + 2}`,
    orderNumber: `PEDSEP${S}`,
    services: [{ search: 'Logomarca', option: /./, amount: '100000' }],
    billing: ['PER_TASK'],
    paymentCondition: /À Vista - Boleto/,
  });
  const t0 = await prisma.task.findUnique({
    where: { id: criado.url.split('/').pop()! },
    select: { quoteId: true },
  });
  const quote = await prisma.budget.findUnique({
    where: { id: t0!.quoteId! },
    select: {
      budgetNumber: true,
      tasks: { select: { id: true, serialNumber: true }, orderBy: { serialNumber: 'asc' } },
      customerConfigs: { select: { id: true } },
    },
  });
  if (!quote) { check('orçamento criado', false); return; }
  const seriais = quote.tasks.map(t => t.serialNumber!);
  info(`orçamento nº ${quote.budgetNumber} · ${quote.customerConfigs.length} cobranças · veículos ${seriais.join(', ')}`);

  await scenario('a tela de faturamento mostra UMA cobrança e não edita o orçamento', page, async () => {
    if (!check('nasceram 3 cobranças (uma por veículo)', quote.customerConfigs.length === 3,
      `${quote.customerConfigs.length}`)) return;

    const aberto = quote.tasks[0];
    const outros = seriais.filter(x => x !== aberto.serialNumber);
    await openBillingDetail(page, aberto.id);

    // ── 0. O ENDEREÇO ─────────────────────────────────────────────────────
    //
    // Entramos por um VEÍCULO, que é como todo link existente endereça. A URL
    // tem de CONVERGIR para a da cobrança: enquanto "faturamento" foi uma lista
    // pendurada no orçamento, quatro caminhões cobrados juntos davam QUATRO
    // endereços para UMA cobrança — quatro URLs, quatro favoritos, o mesmo
    // conteúdo. O `Billing` é o que dá um endereço a uma coisa.
    const billingDoVeiculo = await prisma.billingTask.findUnique({
      where: { taskId: aberto.id },
      select: { billingId: true },
    });
    // Esperar a CONVERGÊNCIA, não um tempo: a tradução taskId→billingId é uma
    // ida ao servidor, e afirmar sobre a URL antes dela é afirmar sobre o meio.
    await page.waitForURL(u => u.pathname.endsWith(`/${billingDoVeiculo?.billingId}`), {
      timeout: 20000,
    }).catch(() => {});
    const urlAgora = new URL(page.url()).pathname;
    check('a URL convergiu para o ENDEREÇO DA COBRANÇA, não o do veículo',
      !!billingDoVeiculo && urlAgora.endsWith(`/${billingDoVeiculo.billingId}`),
      `${urlAgora} · faturamento ${billingDoVeiculo?.billingId ?? '(nenhum)'}`);
    check('e a URL do veículo deixou de ser o endereço',
      !urlAgora.endsWith(`/${aberto.id}`), urlAgora);

    // ── 1. os passos ──────────────────────────────────────────────────────
    const passos = await stepTitles(page);
    info(`passos: ${passos.join(' · ')}`);
    check('não há passo "Proposta" (é do orçamento)',
      !passos.some(t => /Proposta/i.test(t)), passos.join(' · '));
    check('não há passo "Serviços" (é do orçamento)',
      !passos.some(t => /Servi.os/i.test(t)), passos.join(' · '));
    // Duas armadilhas neste contador, as duas já pisadas:
    //   `^Fatura` não casa, porque `stepTitles` cola o título no NÚMERO do passo
    //   ("2Fatura 3170000"); e `/Fatura/` solto casa dentro de "Dados da tarefa e
    //   faturaMENTO", no passo Tarefa. Exigir o dígito do rótulo resolve os dois,
    //   e continua valendo para "Cliente 1" (o rótulo de um veículo só).
    check('há exatamente UM passo de fatura',
      passos.filter(t => /(Fatura|Cliente)\s*\d/i.test(t)).length === 1, passos.join(' · '));

    // ── 2. o Resumo ───────────────────────────────────────────────────────
    await goToLastStep(page);
    const tela = await screenText(page);
    check('o Resumo cita o veículo desta cobrança',
      tela.includes(aberto.serialNumber!), aberto.serialNumber!);
    for (const outro of outros) {
      check(`o Resumo NÃO cita ${outro} (é cobrança de outra página)`,
        !tela.includes(outro),
        tela.split('\n').filter(l => l.includes(outro)).slice(0, 2).join(' | '));
    }
  });

  await browser.close();
  await prisma.$disconnect();
  process.exit(report() > 0 ? 1 : 0);
}

main();
