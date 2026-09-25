/**
 * FASE 1 — CRIAÇÃO PELO ASSISTENTE DE ORÇAMENTO.
 *
 * Um veículo, quatro veículos com fatura única, quatro com uma fatura cada.
 * A pergunta de cada cenário é a mesma: o que a TELA mostrou bate com o que o
 * BANCO gravou, e a cobertura particiona os veículos?
 */
import { chromium, Browser, Page } from 'playwright';
import { prisma, serialBase } from './helpers/env';
import { check, phase, scenario, report, brl, money, near, info, shoot } from './helpers/harness';
import { login, createQuote, BASE, QuoteSpec } from './helpers/ui';

const TAG = `QA${Date.now().toString().slice(-6)}`;
// Série é ÚNICA no sistema: uma faixa nova por corrida, senão o save é barrado
// por um toast e a tela fica parada no resumo (foi assim que a bateria "falhou"
// inteira numa segunda execução).
/**
 * A faixa de séries desta corrida. `QA_SERIAL_BASE` a fixa — é o que permite
 * rodar esta fase ao lado das outras sem disputar número de série (ele é ÚNICO
 * no sistema, e repetir um faz o save ser barrado por um toast).
 */
const S = serialBase(1);

interface Expect {
  vehicles: number;
  configs: number;
  perVehicleTotal: number;
  /** cobertura esperada por fatia, em nº de veículos */
  coverage: number[];
}

async function assertQuote(label: string, taskUrl: string, e: Expect) {
  const taskId = taskUrl.split('/').pop()!;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { quoteId: true, implement: { select: { serialNumber: true } } },
  });
  if (!check(`${label}: a tela redirecionou para uma tarefa que existe`, !!task?.quoteId, taskUrl)) return null;

  const quote = await prisma.budget.findUnique({
    where: { id: task!.quoteId! },
    select: {
      id: true, budgetNumber: true, vehicleCount: true, subtotal: true, total: true,
      billingSplit: true,
      tasks: { select: { id: true, implement: { select: { serialNumber: true } } } },
      customerConfigs: {
        select: {
          id: true, customerId: true, total: true, subtotal: true,
          billing: { select: { id: true, approvedAt: true, tasks: { select: { taskId: true } } } },
        },
      },
    },
  });
  if (!quote) return null;

  check(`${label}: nasceram ${e.vehicles} veículo(s)`, quote.tasks.length === e.vehicles, `veio ${quote.tasks.length}`);
  check(`${label}: vehicleCount gravado = ${e.vehicles}`, quote.vehicleCount === e.vehicles, `veio ${quote.vehicleCount}`);
  check(`${label}: ${e.configs} fatura(s) de faturamento`, quote.customerConfigs.length === e.configs, `veio ${quote.customerConfigs.length}`);

  const grand = e.perVehicleTotal * e.vehicles;
  check(
    `${label}: total do contrato = ${money(grand)} (por veículo × N)`,
    near(Number(quote.total), grand),
    `banco: ${money(Number(quote.total))}`,
  );

  // A PARTIÇÃO: todo veículo coberto uma vez, e uma só.
  const covered = quote.customerConfigs.flatMap(c => (c.billing?.tasks ?? []).map(r => r.taskId));
  check(
    `${label}: a cobertura particiona os ${e.vehicles} veículos (sem sobra, sem repetição)`,
    covered.length === e.vehicles && new Set(covered).size === e.vehicles,
    `cobertos=${covered.length} distintos=${new Set(covered).size}`,
  );

  const sizes = quote.customerConfigs.map(c => (c.billing?.tasks ?? []).length).sort((a, b) => a - b);
  const want = [...e.coverage].sort((a, b) => a - b);
  check(
    `${label}: tamanhos de cobertura ${JSON.stringify(want)}`,
    JSON.stringify(sizes) === JSON.stringify(want),
    `veio ${JSON.stringify(sizes)}`,
  );

  for (const c of quote.customerConfigs) {
    const n = (c.billing?.tasks ?? []).length || e.vehicles;
    const esperado = e.perVehicleTotal * n;
    check(
      `${label}: fatia de ${n} veículo(s) cobra ${money(esperado)}`,
      near(Number(c.total), esperado),
      `banco: ${money(Number(c.total))}`,
    );
  }

  // A soma das fatias reconstrói o contrato — a propriedade que o lote precisa.
  const soma = quote.customerConfigs.reduce((s, c) => s + Number(c.total), 0);
  check(
    `${label}: a soma das faturas reconstrói o contrato`,
    near(soma, grand),
    `soma=${money(soma)} contrato=${money(grand)}`,
  );

  return quote;
}

async function main() {
  const browser: Browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1400 }, locale: 'pt-BR' });
  const page: Page = await ctx.newPage();
  page.on('response', r => {
    if (r.status() >= 500 && r.url().includes(':3031')) console.log(`   [HTTP ${r.status()}] ${r.url().slice(0, 130)}`);
  });

  phase('FASE 1 — criação pelo assistente de orçamento');
  await login(page, 'qa.admin@ankaa.test');

  const base: Omit<QuoteSpec, 'name' | 'serials' | 'billing'> = {
    customer: /QA Alfa/,
    customerSearch: 'QA Alfa',
    category: /^Truck$/,
    services: [{ search: 'Logomarca', option: /./, amount: '100000' }],
  };

  let r1: any, r2: any, r3: any;

  await scenario('C1 · um veículo, fatura única', page, async () => {
    const res = await createQuote(page, { ...base, name: `${TAG} C1 1V`, serials: String(S) } as QuoteSpec);
    info(`resumo mostrou: ${res.reviewText.match(/Total[^\n]*\n[^\n]*/g)?.slice(0, 3).join(' ; ') ?? '—'}`);
    r1 = await assertQuote('C1', res.url, { vehicles: 1, configs: 1, perVehicleTotal: 1000, coverage: [1] });
  });

  await scenario('C2 · quatro veículos, FATURA ÚNICA', page, async () => {
    const res = await createQuote(page, { ...base, name: `${TAG} C2 4V JOINT`, serials: `${S + 10} ${S + 13}` } as QuoteSpec);
    info(`serviços mostrou: ${res.servicesText.replace(/\n/g, ' | ').slice(0, 220)}`);
    r2 = await assertQuote('C2', res.url, { vehicles: 4, configs: 1, perVehicleTotal: 1000, coverage: [4] });
  });

  await scenario('C3 · quatro veículos, UMA FATURA POR VEÍCULO', page, async () => {
    const res = await createQuote(page, {
      ...base, name: `${TAG} C3 4V PER_TASK`, serials: `${S + 20} ${S + 23}`, billing: ['PER_TASK'],
    } as QuoteSpec);
    r3 = await assertQuote('C3', res.url, { vehicles: 4, configs: 4, perVehicleTotal: 1000, coverage: [1, 1, 1, 1] });
  });

  await scenario('C4 · quatro veículos, DOIS clientes no faturamento', page, async () => {
    const res = await createQuote(page, {
      ...base,
      name: `${TAG} C4 2 clientes`,
      serials: `${S + 30} ${S + 33}`,
      extraBillingCustomers: [{ search: 'QA Beta', option: /QA BETA/i }],
      services: [
        { search: 'Logomarca', option: /./, amount: '100000', customer: /QA ALFA/i },
        { search: 'Logomarca', option: /./, amount: '30000', customer: /QA BETA/i },
      ],
    } as QuoteSpec);
    const taskId = res.url.split('/').pop()!;
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { quoteId: true } });
    const q = await prisma.budget.findUnique({
      where: { id: t!.quoteId! },
      select: {
        total: true, vehicleCount: true,
        customerConfigs: {
          select: { customerId: true, total: true, billing: { select: { id: true, approvedAt: true, tasks: { select: { taskId: true } } } },
                    customer: { select: { fantasyName: true } } },
        },
      },
    });
    const clientes = [...new Set((q?.customerConfigs ?? []).map(c => c.customer?.fantasyName))];
    info(`faturas: ${(q?.customerConfigs ?? []).map(c => `${c.customer?.fantasyName}=${money(Number(c.total))}/${(c.billing?.tasks ?? []).length}v`).join(' · ')}`);
    check('C4: nasceu uma fatura para CADA cliente', (q?.customerConfigs ?? []).length === 2, `${q?.customerConfigs.length}`);
    check('C4: os dois clientes são distintos', clientes.length === 2, JSON.stringify(clientes));
    // Cada cliente cobra os 4 veículos: a cobertura é por cliente, e o índice
    // único é (taskId, customerId) — o mesmo caminhão pode estar na fatura de
    // dois clientes diferentes, o que não é sobreposição.
    check('C4: cada fatura cobre os 4 veículos',
      (q?.customerConfigs ?? []).every(c => (c.billing?.tasks ?? []).length === 4),
      JSON.stringify((q?.customerConfigs ?? []).map(c => (c.billing?.tasks ?? []).length)));
    // Cada cliente paga SÓ o serviço dele, vezes os veículos.
    const alfa = (q?.customerConfigs ?? []).find(c => /ALFA/i.test(c.customer?.fantasyName ?? ''));
    const beta = (q?.customerConfigs ?? []).find(c => /BETA/i.test(c.customer?.fantasyName ?? ''));
    check('C4: a fatura do cliente 1 cobra o serviço dele × 4', near(Number(alfa?.total ?? 0), 4000), money(Number(alfa?.total ?? 0)));
    check('C4: a fatura do cliente 2 cobra o serviço dele × 4', near(Number(beta?.total ?? 0), 1200), money(Number(beta?.total ?? 0)));
    check('C4: o contrato é a soma dos dois', near(Number(q?.total ?? 0), 5200), money(Number(q?.total ?? 0)));
  });

  console.log(`\nORÇAMENTOS CRIADOS: ${[r1, r2, r3].filter(Boolean).map((q: any) => q.budgetNumber).join(', ')}`);
  await browser.close();
  await prisma.$disconnect();
  process.exit(report() > 0 ? 1 : 0);
}

main();
