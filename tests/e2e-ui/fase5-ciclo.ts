/**
 * FASE 5 — O CICLO INTEIRO, PELAS COMBINAÇÕES QUE DE FATO EXISTEM.
 *
 * A fase 4 provou que, para uma fatura única, uma por veículo e um lote, o valor
 * da fatura, o da nota e o do boleto fecham. Esta fase percorre o que vem
 * DEPOIS e o que a fase 4 não combinava:
 *
 *   C1  desconto percentual num orçamento de 4 veículos, parcelado 3x —
 *       a nota tem de declarar `quantidade = 4` e o ISS tem de sair sobre o
 *       valor cobrado, não sobre o de um caminhão.
 *   C2  REVERTER e REAPROVAR. Depois de reverter, o orçamento volta a
 *       Orçamento Aprovado e tem de poder ser faturado de novo — e a fatura, as
 *       parcelas e os boletos do ciclo anterior têm de ter ido embora.
 *   C3  LOTES 2+2 com aprovação SEQUENCIAL: aprovar o primeiro lote não pode
 *       deixar o segundo sem caminho na tela, e a divisão congela na primeira
 *       aprovação.
 *   C4  DOIS CLIENTES de faturamento: cada um paga só o serviço dele, em todos
 *       os veículos, e a nota de cada um cita só os serviços dele.
 *   C5  sem NOTA e sem BOLETO (as duas chaves desligadas): a fatura e as
 *       parcelas nascem, e NADA sai para a prefeitura nem para o banco.
 *   C6  UM CAMINHÃO A MAIS depois de faturar: a fatia já emitida não se mexe, o
 *       veículo novo nasce com fatura própria e o contrato cresce por um.
 *   C7  MUDAR O PREÇO depois de faturar: a gravação é RECUSADA, porque a nota e
 *       os boletos saíram sobre o preço atual.
 *   C8  A COMBINAÇÃO MAIS DENSA: dois clientes × uma fatura por veículo. São
 *       2×N fatias, e aprovar UM caminhão tem de fechar as duas dele — nem a do
 *       vizinho, nem só uma das duas.
 *   CA  REVERTER COM O ORÇAMENTO PELA METADE: uma fatia aprovada, a outra não.
 *       A reversão é do orçamento inteiro, e o que ela desmonta é só o que
 *       existe — depois dela os dois caminhões voltam a poder ser faturados.
 *
 * A INVARIANTE que todo cenário confere, no fim:
 *
 *     Σ(faturas do orçamento) = total do contrato
 *     cada fatura            = total por veículo × veículos que ela cobre
 *     Σ(parcelas da fatura)  = fatura
 *     Σ(boletos da fatura)   = fatura
 *     líquido da NFS-e       = fatura
 *
 * Nada sai da máquina: Elotech e Sicredi respondem numa sentinela local que
 * GRAVA o corpo, e é sobre o corpo gravado que o teste afirma.
 */
import { chromium, Browser, Page } from 'playwright';
import { prisma, sentinelaReset, sentinelaCalls, mailPurge, serialBase } from './helpers/env';
import { check, phase, scenario, report, info, money, near } from './helpers/harness';
import {
  login, createQuote, openQuoteDetail, gotoCustomerStep, goToLastStep, setQuoteStatus,
  openBillingDetail, setLots, saveDetail, approveBillingForOpenVehicle, revertBilling,
  readApprovalDialog, screenText, addVehicleSerial, lastToast, setFirstServiceAmount,
  gotoStep, pause,
} from './helpers/ui';

/**
 * A faixa de séries deste worker.
 *
 * A série é ÚNICA no sistema: duas corridas simultâneas com a mesma faixa fazem
 * o save ser barrado por um toast, e a tela fica parada no resumo — o sintoma
 * lê como "botão não encontrado" e esconde a causa. `QA_SERIAL_BASE` é como as
 * fases rodam em paralelo sem se encostarem.
 */
const S = serialBase(5);
const PRECO = 1250.5; // por veículo — com centavos de propósito: arredondamento aparece

/**
 * QUAIS CENÁRIOS ESTA CORRIDA EXECUTA — `QA_ONLY=C1,C2`.
 *
 * É o que permite rodar a fase em PARALELO: cada processo leva uma faixa de
 * séries própria (`QA_SERIAL_BASE`) e um punhado de cenários, e os quatro
 * navegadores conversam com a mesma api sem disputar número de série. Vazio =
 * roda tudo, que é o modo de sempre.
 */
const SO = (process.env.QA_ONLY ?? '').split(',').map(x => x.trim()).filter(Boolean);
const rodar = (tag: string) => SO.length === 0 || SO.includes(tag);

interface Fatia {
  /** Quantos veículos esta fatura cobre. */
  cobertos: number;
  /** Quantas parcelas. */
  parcelas: number;
  /** Sai nota para esta fatura? */
  nota: boolean;
  /** Saem boletos para esta fatura? */
  boleto: boolean;
}

/** Total por veículo depois do desconto, na MESMA fórmula de `utils/quote-money.ts`. */
function porVeiculo(subtotal: number, desconto?: { tipo: 'PERCENTAGE' | 'FIXED_VALUE'; valor: number }) {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  if (!desconto) return r2(subtotal);
  const d = desconto.tipo === 'PERCENTAGE'
    ? r2((subtotal * desconto.valor) / 100)
    : Math.min(desconto.valor, subtotal);
  return Math.max(0, r2(subtotal - r2(d)));
}

/**
 * A CONFERÊNCIA DE DINHEIRO — a mesma para todo cenário.
 *
 * Lê o que o SERVIDOR gravou e o que a SENTINELA registrou, e fecha as duas
 * pontas contra a fórmula. Uma conferência por cenário seria a mesma conta
 * escrita cinco vezes, e é assim que duas delas passam a discordar.
 */
async function conferirDinheiro(
  tag: string,
  quoteId: string,
  /**
   * `totalPorVeiculo` é um NÚMERO quando há um cliente de faturamento, e um MAPA
   * `pedaço-do-nome → preço` quando há dois: com dois clientes não existe "o
   * preço do veículo", existe o preço que CADA UM paga por ele. Passar um número
   * só ali fazia o verificador cobrar R$ 1.500 de duas faturas que valem
   * R$ 1.000 e R$ 500 — e a soma delas, que é a invariante de verdade, fechava.
   */
  esperado: { totalPorVeiculo: number | Record<string, number>; fatias: Fatia[] },
  desdeSeq: number,
  /**
   * O NÚMERO DO PEDIDO deste orçamento — a âncora que recorta os BOLETOS.
   *
   * O corpo do boleto não leva a série do veículo (leva o pedido, a NF e os
   * serviços), então o recorte por série que serve para a nota não serve aqui.
   * O pedido é único por worker (`PEDC1<base>`), e é o que atravessa processos.
   */
  pedido: string,
) {
  const q = await prisma.budget.findUnique({
    where: { id: quoteId },
    select: {
      total: true, subtotal: true, vehicleCount: true,
      customerConfigs: {
        select: {
          id: true, total: true, generateInvoice: true, generateBankSlip: true,
          customer: { select: { fantasyName: true, corporateName: true } },
          billing: { select: { id: true, approvedAt: true, tasks: { select: { task: { select: { serialNumber: true } } } } } },
        },
      },
    },
  });
  const configs = q?.customerConfigs ?? [];
  const nVeic = q?.vehicleCount ?? 0;

  /** O preço por veículo que ESTE cliente paga. */
  const precoDe = (nome: string): number => {
    if (typeof esperado.totalPorVeiculo === 'number') return esperado.totalPorVeiculo;
    const achado = Object.entries(esperado.totalPorVeiculo).find(([k]) =>
      nome.toLowerCase().includes(k.toLowerCase()),
    );
    return achado ? achado[1] : 0;
  };
  /** A soma do que TODOS os clientes cobram por um veículo — o "por veículo" do contrato. */
  const precoPorVeiculo =
    typeof esperado.totalPorVeiculo === 'number'
      ? esperado.totalPorVeiculo
      : Object.values(esperado.totalPorVeiculo).reduce((a, b) => a + b, 0);

  const contrato = Math.round(precoPorVeiculo * nVeic * 100) / 100;
  check(`${tag}: o contrato é por veículo × ${nVeic} = ${money(contrato)}`,
    near(Number(q?.total ?? 0), contrato), `gravado=${money(Number(q?.total ?? 0))}`);

  const invoices = await prisma.invoice.findMany({
    where: { customerConfigId: { in: configs.map(c => c.id) }, status: { not: 'CANCELLED' } },
    select: {
      id: true, totalAmount: true, customerConfigId: true,
      installments: { select: { amount: true, number: true, dueDate: true, bankSlip: { select: { nossoNumero: true } } }, orderBy: { number: 'asc' } },
    },
  });
  check(`${tag}: nasceram ${esperado.fatias.length} fatura(s)`,
    invoices.length === esperado.fatias.length, `${invoices.length}`);

  // A SOMA DAS FATURAS RECONSTRÓI O CONTRATO. É a invariante que sustenta a
  // feature inteira: as coberturas PARTICIONAM os veículos, então somar as
  // fatias tem de dar o contrato nos três modos.
  const somaFaturas = Math.round(invoices.reduce((s, i) => s + Number(i.totalAmount), 0) * 100) / 100;
  check(`${tag}: Σ faturas = contrato (${money(contrato)})`, near(somaFaturas, contrato),
    `Σ faturas=${money(somaFaturas)}`);

  // ── O QUE SAIU POR CAUSA DESTE ORÇAMENTO ────────────────────────────────
  //
  // A sentinela é UMA para todos os workers: contar "quantas notas saíram desde
  // o marcador" contaria também as do worker ao lado, e a contagem falharia por
  // paralelismo e não por defeito. O recorte é pelo CONTEÚDO — a série de um
  // veículo deste orçamento aparece na discriminação da nota e no informativo do
  // boleto —, que é a única âncora que atravessa processos.
  const seriesDoOrcamento = configs
    .flatMap(c => (c.billing?.tasks ?? []).map(r => r.task?.serialNumber))
    .filter(Boolean) as string[];
  const meu = (x: { body: unknown }) => {
    const texto = JSON.stringify(x.body ?? {});
    return seriesDoOrcamento.some(sn => texto.includes(sn)) || texto.includes(pedido);
  };
  const chamadas = (await sentinelaCalls()).filter(x => x.seq > desdeSeq && meu(x));
  const notas = chamadas.filter(x => x.integration === 'elotech' && x.path.includes('salvar-nota-fiscal'));
  const boletos = chamadas.filter(x => x.integration === 'sicredi' && x.method === 'POST' && x.path.endsWith('/boletos'));

  const comNota = esperado.fatias.filter(f => f.nota).length;
  check(`${tag}: saíram ${comNota} nota(s) fiscais`, notas.length === comNota, `${notas.length}`);
  const comBoleto = esperado.fatias.filter(f => f.boleto).reduce((s, f) => s + f.parcelas, 0);
  check(`${tag}: saíram ${comBoleto} boleto(s)`, boletos.length === comBoleto, `${boletos.length}`);

  const usadosBoleto = new Set<number>();
  for (const inv of invoices) {
    const cfg = configs.find(c => c.id === inv.customerConfigId)!;
    const nomeCliente = `${cfg.customer?.corporateName ?? ''} ${cfg.customer?.fantasyName ?? ''}`.trim();
    const cobertos = (cfg.billing?.tasks ?? []).map(r => r.task?.serialNumber).filter(Boolean) as string[];
    const n = Math.max(1, cobertos.length);
    const esperadoFatura = Math.round(precoDe(nomeCliente) * n * 100) / 100;
    check(`${tag}: fatura de ${n} veículo(s) de ${nomeCliente.slice(0, 18)} = ${money(esperadoFatura)}`,
      near(Number(inv.totalAmount), esperadoFatura), money(Number(inv.totalAmount)));

    const somaParcelas = Math.round(inv.installments.reduce((s, i) => s + Number(i.amount), 0) * 100) / 100;
    check(`${tag}: Σ parcelas = fatura de ${n} veículo(s)`, near(somaParcelas, Number(inv.totalAmount)),
      `parcelas=${money(somaParcelas)} fatura=${money(Number(inv.totalAmount))}`);

    // ── A NOTA DESTA FATURA ─────────────────────────────────────────────────
    if (cfg.generateInvoice !== false) {
      // A nota é DESTA fatia quando cita alguma série que ela cobre e NENHUMA de
      // outra. Exigir TODAS falharia de propósito a partir de quatro veículos: a
      // discriminação ali declara a contagem e a FAIXA (primeira e última), e as
      // do meio não aparecem — que é justamente o comportamento correto, imposto
      // pelo teto de 11 linhas.
      const deOutraFatia = seriesDoOrcamento.filter(sn => !cobertos.includes(sn));
      // ⚠️ O TOMADOR TAMBÉM ENTRA NA IDENTIFICAÇÃO. Com dois clientes de
      // faturamento há DUAS notas do mesmo caminhão — uma para cada —, e casar
      // só pela série pega a primeira: a do Beta era conferida contra a fatura
      // do Alfa e o teste acusava uma diferença que não existe.
      const nota = notas.find(x => {
        const body: any = x.body;
        const texto = JSON.stringify(body ?? {});
        if (!cobertos.some(sn => texto.includes(sn))) return false;
        if (deOutraFatia.some(sn => texto.includes(sn))) return false;
        const razao: string = body?.formTomador?.razao ?? '';
        if (!razao || !nomeCliente) return true;
        const primeiraPalavra = nomeCliente.split(/\s+/).slice(0, 2).join(' ').toLowerCase();
        return razao.toLowerCase().includes(primeiraPalavra.split(' ')[1] ?? primeiraPalavra);
      });
      if (check(`${tag}: existe a nota da fatura que cobre ${cobertos.join('+')}`, !!nota)) {
        const body: any = nota!.body;
        const itens: any[] = body?.formItensNFSe ?? [];
        const liquido = Math.round(itens.reduce((a, i) => a + Number(i.valorLiquido ?? 0), 0) * 100) / 100;
        check(`${tag}: o líquido da NFS-e = a fatura (${money(Number(inv.totalAmount))})`,
          near(liquido, Number(inv.totalAmount)),
          `nota=${money(liquido)} diferença=${money(Number(inv.totalAmount) - liquido)}`);

        // A QUANTIDADE tem de ser os veículos cobertos, e o unitário o preço de
        // UM — é o que faz a nota dizer a mesma coisa que o boleto cobra.
        const qtdes = [...new Set(itens.map(i => Number(i.quantidade)))];
        check(`${tag}: cada linha da nota declara quantidade ${n}`,
          qtdes.length === 1 && qtdes[0] === n, `quantidades=${JSON.stringify(qtdes)}`);
        const somaLinhas = Math.round(itens.reduce((a, i) => a + Number(i.valorTotal ?? 0), 0) * 100) / 100;
        const unitario = Math.round(itens.reduce((a, i) => a + Number(i.valorUnitario ?? 0), 0) * 100) / 100;
        check(`${tag}: valorTotal das linhas = unitário × ${n}`,
          near(somaLinhas, Math.round(unitario * n * 100) / 100),
          `Σ valorTotal=${money(somaLinhas)} Σ unitário=${money(unitario)}`);

        // O ISS sai sobre o LÍQUIDO — subdeclarar a base é o mesmo defeito do
        // valor, com consequência fiscal própria.
        const base = Number(body?.formTotal?.baseCalculoIss ?? -1);
        check(`${tag}: a base do ISS é o líquido da nota`, near(base, liquido),
          `base=${money(base)} líquido=${money(liquido)}`);
        const iss = Number(body?.formImposto?.valorIss ?? -1);
        check(`${tag}: o ISS é 2% da base (${money(Math.round(base * 2) / 100)})`,
          near(iss, Math.round(base * 2) / 100, 0.02), `ISS=${money(iss)}`);
      }
    }

    // ── OS BOLETOS DESTA FATURA ─────────────────────────────────────────────
    if (cfg.generateBankSlip !== false) {
      for (const parcela of inv.installments) {
        const b = boletos.find(x => !usadosBoleto.has(x.seq) && near(Number((x.body as any)?.valor ?? -1), Number(parcela.amount)));
        if (b) usadosBoleto.add(b.seq);
        check(`${tag}: há boleto de ${money(Number(parcela.amount))} (parcela ${parcela.number}/${inv.installments.length})`,
          !!b, `registrados: ${JSON.stringify(boletos.map(x => (x.body as any)?.valor))}`);
        if (b) {
          const venc = String((b.body as any)?.dataVencimento ?? '');
          const esp = parcela.dueDate ? new Date(parcela.dueDate).toISOString().slice(0, 10) : '';
          check(`${tag}: o vencimento do boleto é o da parcela (${esp})`, venc === esp, `boleto=${venc}`);
        }
      }
    }
  }
}

/** Ids das tarefas do orçamento, na ordem da série. */
async function veiculosDo(quoteId: string) {
  return prisma.task.findMany({
    where: { quoteId },
    select: { id: true, serialNumber: true },
    orderBy: { serialNumber: 'asc' },
  });
}

async function seq(): Promise<number> {
  const all = await sentinelaCalls();
  return all.length ? Math.max(...all.map(x => x.seq)) : 0;
}

async function main() {
  const browser: Browser = await chromium.launch({ headless: true });
  const page: Page = await (await browser.newContext({ viewport: { width: 1600, height: 2400 }, locale: 'pt-BR' })).newPage();
  page.on('response', r => {
    if (r.status() >= 500 && r.url().includes(':3031')) console.log(`   [HTTP ${r.status()}] ${r.url().slice(0, 130)}`);
  });

  phase(`FASE 5 — ciclo completo (séries a partir de ${S})`);
  // ⚠️ SÓ LIMPA A SENTINELA QUANDO RODA SOZINHA. Com quatro workers, o segundo a
  // subir apagaria as chamadas que o primeiro ainda vai conferir — e a falha
  // apareceria como "a nota não saiu" numa nota que saiu. Em paralelo, o recorte
  // é por conteúdo (ver `conferirDinheiro`), não por marcador global.
  if (!process.env.QA_SHARD) {
    await sentinelaReset();
    await mailPurge();
  }
  await login(page, 'qa.admin@ankaa.test');

  // ═══════════════════════════════════════════════════════════════════════
  // C1 — 4 veículos, fatura única, desconto 12%, parcelado 3x
  // ═══════════════════════════════════════════════════════════════════════
  if (rodar('C1')) await scenario('C1 · 4 veículos JOINT, desconto 12%, 3x', page, async () => {
    const marcador = await seq();
    const res = await createQuote(page, {
      name: `QA C1 ${S}`,
      customer: /QA Alfa/, customerSearch: 'QA Alfa', category: /^Truck$/,
      serials: `${S} ${S + 3}`,
      orderNumber: `PEDC1${S}`,
      services: [{ search: 'Logomarca', option: /./, amount: String(Math.round(PRECO * 100)) }],
      discount: { type: /Percentual|Porcentagem|PERCENT/i, value: '12' },
      paymentCondition: /Parcelado 3x/,
    });
    const taskId = res.url.split('/').pop()!;
    const quoteId = (await prisma.task.findUnique({ where: { id: taskId }, select: { quoteId: true } }))!.quoteId!;
    const vs = await veiculosDo(quoteId);
    check('C1: nasceram 4 veículos', vs.length === 4, `${vs.length}`);

    const unit = porVeiculo(PRECO, { tipo: 'PERCENTAGE', valor: 12 });
    info(`por veículo com desconto: ${money(unit)} · contrato esperado ${money(unit * 4)}`);

    // O RESUMO tem de dizer as três linhas: por veículo, × N, total geral.
    check('C1: o resumo da criação mostra "TOTAL POR VEÍCULO"', /TOTAL POR VE/i.test(res.reviewText),
      res.reviewText.split('\n').filter(l => /TOTAL|Ve.culos/i.test(l)).slice(0, 6).join(' | '));
    check('C1: o resumo mostra "× 4"', /×\s*4|x\s*4/.test(res.reviewText));
    check('C1: o resumo mostra o TOTAL GERAL certo',
      res.reviewText.includes(money(Math.round(unit * 4 * 100) / 100)),
      res.reviewText.split('\n').filter(l => /R\$/.test(l)).slice(-8).join(' | '));

    await openQuoteDetail(page, vs[0].id);
    await goToLastStep(page);
    await setQuoteStatus(page, /^Aprovado$/);

    // ── O RESUMO DO FATURAMENTO DIZ O MESMO QUE O DO ORÇAMENTO? ────────────
    //
    // As duas telas falam do mesmo orçamento e usam o mesmo formulário por
    // veículo. Se uma imprime "TOTAL R$ 1.100,44" e a outra "TOTAL GERAL
    // R$ 4.401,76" sem dizer o que é o quê, quem aprova o faturamento lê o preço
    // de um caminhão logo antes de o banco cobrar o de quatro.
    await openBillingDetail(page, vs[0].id);
    await goToLastStep(page);
    const resumoFat = await screenText(page);
    const contrato = Math.round(unit * 4 * 100) / 100;
    const parcela = Math.round((contrato / 3) * 100) / 100;
    check('C1: o Resumo do Faturamento diz "TOTAL POR VEÍCULO"', /TOTAL POR VE/i.test(resumoFat),
      resumoFat.split('\n').filter(l => /TOTAL|Ve.culos|R\$/.test(l)).slice(0, 12).join(' | '));
    check('C1: o Resumo do Faturamento mostra o TOTAL GERAL certo',
      resumoFat.includes(money(contrato)),
      resumoFat.split('\n').filter(l => /R\$/.test(l)).slice(0, 12).join(' | '));
    check('C1: a cláusula de pagamento fala da PARCELA DA FATURA',
      resumoFat.includes(money(parcela)),
      resumoFat.split('\n').filter(l => /parcela/i.test(l)).slice(0, 3).join(' | '));

    // A PRÉVIA que o operador lê antes de aprovar tem de mostrar o valor da
    // fatura, não o de um caminhão.
    const dialogo = await readApprovalDialog(page);
    check('C1: a prévia da confirmação mostra o valor da PARCELA da fatura',
      dialogo.includes(money(parcela)),
      dialogo.split('\n').filter(l => /R\$/.test(l)).slice(0, 10).join(' | ') || '(diálogo vazio)');
    check('C1: a prévia NÃO mostra a parcela do valor de um veículo',
      !dialogo.includes(money(Math.round((unit / 3) * 100) / 100)),
      `não podia citar ${money(Math.round((unit / 3) * 100) / 100)}`);

    await openBillingDetail(page, vs[0].id);
    await goToLastStep(page);
    await approveBillingForOpenVehicle(page);
    await pause(page, 8000);

    await conferirDinheiro('C1', quoteId, {
      totalPorVeiculo: unit,
      fatias: [{ cobertos: 4, parcelas: 3, nota: true, boleto: true }],
    }, marcador, `PEDC1${S}`);

    // Com 4 veículos a discriminação declara a CONTAGEM e a faixa — o teto de
    // 11 linhas não cabe a lista por extenso.
    const nota = (await sentinelaCalls()).filter(
      x => x.seq > marcador && x.path.includes('salvar-nota-fiscal') &&
        JSON.stringify(x.body ?? {}).includes(`PEDC1${S}`),
    )[0];
    const disc: string = (nota?.body as any)?.formDadosNFSe?.discriminacaoServico ?? '';
    check('C1: a discriminação declara "4 veículos"', /4\s+ve.culos/i.test(disc), disc.replace(/\n/g, ' ⏎ '));
    check('C1: a discriminação declara a faixa de séries', disc.includes(String(S)) && disc.includes(String(S + 3)), disc.replace(/\n/g, ' ⏎ '));
    check('C1: a discriminação não passa de 11 linhas', disc.split('\n').length <= 11, `${disc.split('\n').length} linhas`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // C2 — reverter e reaprovar
  // ═══════════════════════════════════════════════════════════════════════
  if (rodar('C2')) await scenario('C2 · reverter o faturamento e faturar de novo', page, async () => {
    const marcador = await seq();
    const res = await createQuote(page, {
      name: `QA C2 ${S}`,
      customer: /QA Alfa/, customerSearch: 'QA Alfa', category: /^Truck$/,
      serials: `${S + 10} ${S + 11}`,
      orderNumber: `PEDC2${S}`,
      services: [{ search: 'Logomarca', option: /./, amount: String(Math.round(PRECO * 100)) }],
      paymentCondition: /À Vista - Boleto/,
    });
    const taskId = res.url.split('/').pop()!;
    const quoteId = (await prisma.task.findUnique({ where: { id: taskId }, select: { quoteId: true } }))!.quoteId!;
    const vs = await veiculosDo(quoteId);

    await openQuoteDetail(page, vs[0].id);
    await goToLastStep(page);
    await setQuoteStatus(page, /^Aprovado$/);
    await openBillingDetail(page, vs[0].id);
    await goToLastStep(page);
    await approveBillingForOpenVehicle(page);
    await pause(page, 6000);

    const antes = await prisma.invoice.count({ where: { customerConfig: { quoteId } } });
    check('C2: o primeiro faturamento gerou fatura', antes === 1, `${antes}`);

    // ── REVERTER ──────────────────────────────────────────────────────────
    await openBillingDetail(page, vs[0].id);
    await goToLastStep(page);
    await revertBilling(page);

    const depois = await prisma.budget.findUnique({
      where: { id: quoteId },
      select: {
        status: true, billingApprovedAt: true,
        customerConfigs: { select: { id: true, billing: { select: { status: true, approvedAt: true } } } },
      },
    });
    const faturasVivas = await prisma.invoice.count({
      where: { OR: [{ customerConfig: { quoteId } }, { task: { quoteId } }] },
    });
    const parcelasVivas = await prisma.installment.count({
      where: { invoice: { OR: [{ customerConfig: { quoteId } }, { task: { quoteId } }] } },
    });
    // O ORÇAMENTO NÃO SE MEXE: reverter é desfazer a COBRANÇA, e `APPROVED` é o
    // último estado do orçamento — ele já estava ali antes e continua depois.
    check('C2: o orçamento continua Aprovado', depois?.status === 'APPROVED', `status=${depois?.status}`);
    check('C2: a FATURA do ciclo anterior foi apagada', faturasVivas === 0, `${faturasVivas} fatura(s) de pé`);
    check('C2: as PARCELAS do ciclo anterior foram apagadas', parcelasVivas === 0, `${parcelasVivas} parcela(s) de pé`);
    check('C2: o carimbo de aprovação de cada fatia foi limpo',
      (depois?.customerConfigs ?? []).every(c => !c.billing?.approvedAt),
      JSON.stringify((depois?.customerConfigs ?? []).map(c => !!c.billing?.approvedAt)));
    // E o ESTADO da cobrança acompanha o carimbo. Sem fatura, sem parcela e sem
    // `approvedAt`, `BillingStatusCascadeService` só pode responder PENDENTE —
    // uma cobrança lendo "Aprovado" depois da reversão é o estado derivado que
    // ficou para trás, e a tela de Faturamento pagina por ele.
    check('C2: nenhuma cobrança continua aprovada',
      (depois?.customerConfigs ?? []).every(c => c.billing?.status === 'PENDING'),
      JSON.stringify((depois?.customerConfigs ?? []).map(c => c.billing?.status)));

    // ── REAPROVAR ─────────────────────────────────────────────────────────
    const marcador2 = await seq();
    await openBillingDetail(page, vs[0].id);
    await goToLastStep(page);
    await approveBillingForOpenVehicle(page);
    await pause(page, 6000);

    const novas = await prisma.invoice.findMany({
      where: { customerConfig: { quoteId }, status: { not: 'CANCELLED' } },
      select: { id: true, totalAmount: true },
    });
    check('C2: o refaturamento gerou UMA fatura nova', novas.length === 1, `${novas.length}`);

    // ── A NOTA DO CICLO ANTERIOR TEM DE SER SUBSTITUÍDA ───────────────────
    //
    // A reversão deixa a nota VIVA na prefeitura de propósito: um documento
    // fiscal não se destrói antes de existir o substituto. O substituto nasce
    // AGORA, e é agora que a antiga tem de ser cancelada CITANDO a nova. Sem
    // isso a prefeitura fica com duas notas autorizadas do mesmo serviço.
    const notas = await prisma.nfseDocument.findMany({
      where: { quoteId },
      select: { nfseNumber: true, status: true, supersededByNfseNumber: true },
      orderBy: { createdAt: 'asc' },
    });
    check('C2: nasceram DUAS notas (a do ciclo revertido e a nova)', notas.length === 2,
      JSON.stringify(notas));
    const antiga = notas[0];
    const nova = notas[notas.length - 1];
    check('C2: a nota do ciclo anterior foi substituída pela nova',
      !!antiga && antiga.supersededByNfseNumber === nova?.nfseNumber,
      JSON.stringify(notas));
    check('C2: a nota do ciclo anterior não ficou AUTORIZADA na prefeitura',
      !!antiga && antiga.status !== 'AUTHORIZED',
      `status da antiga = ${antiga?.status}`);
    check('C2: a nota NOVA está autorizada', nova?.status === 'AUTHORIZED', `${nova?.status}`);
    await conferirDinheiro('C2', quoteId, {
      totalPorVeiculo: porVeiculo(PRECO),
      fatias: [{ cobertos: 2, parcelas: 1, nota: true, boleto: true }],
    }, marcador2, `PEDC2${S}`);
    void marcador;
  });

  // ═══════════════════════════════════════════════════════════════════════
  // C3 — lotes 2+2 com aprovação sequencial
  // ═══════════════════════════════════════════════════════════════════════
  if (rodar('C3')) await scenario('C3 · lotes 2+2, aprovação um lote de cada vez', page, async () => {
    const marcador = await seq();
    const res = await createQuote(page, {
      name: `QA C3 ${S}`,
      customer: /QA Alfa/, customerSearch: 'QA Alfa', category: /^Truck$/,
      serials: `${S + 20} ${S + 23}`,
      orderNumber: `PEDC3${S}`,
      services: [{ search: 'Logomarca', option: /./, amount: String(Math.round(PRECO * 100)) }],
      paymentCondition: /À Vista - Boleto/,
    });
    const taskId = res.url.split('/').pop()!;
    const quoteId = (await prisma.task.findUnique({ where: { id: taskId }, select: { quoteId: true } }))!.quoteId!;
    const vs = await veiculosDo(quoteId);
    check('C3: nasceram 4 veículos', vs.length === 4, `${vs.length}`);

    await openQuoteDetail(page, vs[0].id);
    await gotoCustomerStep(page, 1);
    await setLots(page, [[vs[0].serialNumber!, vs[1].serialNumber!], [vs[2].serialNumber!, vs[3].serialNumber!]]);
    await saveDetail(page);

    const cobertura = await prisma.budgetPayer.findMany({
      where: { quoteId }, select: { billing: { select: { id: true, approvedAt: true, tasks: { select: { taskId: true } } } } },
    });
    check('C3: o lote gravou duas faturas de 2 veículos',
      JSON.stringify(cobertura.map(c => (c.billing?.tasks ?? []).length).sort()) === '[2,2]',
      JSON.stringify(cobertura.map(c => (c.billing?.tasks ?? []).length)));

    await openQuoteDetail(page, vs[0].id);
    await goToLastStep(page);
    await setQuoteStatus(page, /^Aprovado$/);

    // ── LOTE 1 ────────────────────────────────────────────────────────────
    await openBillingDetail(page, vs[0].id);
    await goToLastStep(page);
    await approveBillingForOpenVehicle(page);
    await pause(page, 6000);
    const meio = await prisma.budgetPayer.findMany({
      where: { quoteId }, select: { billing: { select: { approvedAt: true } } },
    });
    check('C3: só UMA fatia foi aprovada com o primeiro lote',
      meio.filter(c => c.billing?.approvedAt).length === 1,
      JSON.stringify(meio.map(c => !!c.billing?.approvedAt)));

    // ── A DIVISÃO CONGELA ─────────────────────────────────────────────────
    await openQuoteDetail(page, vs[0].id);
    await gotoCustomerStep(page, 1);
    const tela = await screenText(page);
    check('C3: a tela avisa que a divisão está travada por haver fatura aprovada',
      /aprovad|travad|bloquead|congel/i.test(tela),
      tela.split('\n').filter(l => /fatur|lote|divis/i.test(l)).slice(0, 6).join(' | '));

    // ── LOTE 2 — o caminho que não existia ────────────────────────────────
    await openBillingDetail(page, vs[2].id);
    await goToLastStep(page);
    await approveBillingForOpenVehicle(page);
    await pause(page, 6000);

    const fim = await prisma.budgetPayer.findMany({
      where: { quoteId }, select: { billing: { select: { approvedAt: true } } },
    });
    check('C3: as DUAS fatias ficaram aprovadas',
      fim.every(c => !!c.billing?.approvedAt), JSON.stringify(fim.map(c => !!c.billing?.approvedAt)));

    await conferirDinheiro('C3', quoteId, {
      totalPorVeiculo: porVeiculo(PRECO),
      fatias: [
        { cobertos: 2, parcelas: 1, nota: true, boleto: true },
        { cobertos: 2, parcelas: 1, nota: true, boleto: true },
      ],
    }, marcador, `PEDC3${S}`);

    // O BOLETO de um lote diz de quantos veículos ele é, e cita só o pedido
    // DELES — era ele que saía com o pedido de compra dos quatro.
    const boletosC3 = (await sentinelaCalls()).filter(
      x => x.seq > marcador && x.integration === 'sicredi' && x.method === 'POST' &&
        x.path.endsWith('/boletos') && JSON.stringify(x.body ?? {}).includes(`PEDC3${S}`),
    );
    for (const b of boletosC3) {
      const linhas: string[] = ((b.body as any)?.informativos ?? []) as string[];
      check('C3: o informativo do boleto declara 2 veículos',
        linhas.some(l => /2 veiculos/i.test(l)), JSON.stringify(linhas));
      const citadas = vs.filter(v => linhas.join(' ').includes(v.serialNumber!)).length;
      check('C3: o boleto cita a faixa de séries do SEU lote (2 séries)', citadas === 2,
        `cita ${citadas}: ${JSON.stringify(linhas)}`);
    }

    // Cada nota fala SÓ dos seus dois caminhões.
    const notas = (await sentinelaCalls()).filter(
      x => x.seq > marcador && x.path.includes('salvar-nota-fiscal') &&
        vs.some(v => JSON.stringify(x.body ?? {}).includes(v.serialNumber!)),
    );
    for (const n of notas) {
      const disc: string = (n.body as any)?.formDadosNFSe?.discriminacaoServico ?? '';
      const citados = vs.filter(v => disc.includes(v.serialNumber!)).length;
      check('C3: cada nota cita exatamente os 2 veículos do seu lote', citados === 2,
        `cita ${citados}: ${disc.replace(/\n/g, ' ⏎ ')}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // C4 — dois clientes de faturamento
  // ═══════════════════════════════════════════════════════════════════════
  if (rodar('C4')) await scenario('C4 · dois clientes, cada um paga o serviço dele', page, async () => {
    const marcador = await seq();
    const res = await createQuote(page, {
      name: `QA C4 ${S}`,
      customer: /QA Alfa/, customerSearch: 'QA Alfa', category: /^Truck$/,
      serials: `${S + 30} ${S + 31}`,
      orderNumber: `PEDC4${S}`,
      extraBillingCustomers: [{ search: 'QA Beta', option: /QA BETA/i }],
      services: [
        { search: 'Logomarca', option: /./, amount: '100000', customer: /QA ALFA/i },
        { search: 'Logomarca', option: /./, amount: '50000', customer: /QA BETA/i },
      ],
      paymentCondition: /À Vista - Boleto/,
    });
    const taskId = res.url.split('/').pop()!;
    const quoteId = (await prisma.task.findUnique({ where: { id: taskId }, select: { quoteId: true } }))!.quoteId!;
    const vs = await veiculosDo(quoteId);

    await openQuoteDetail(page, vs[0].id);
    await goToLastStep(page);
    await setQuoteStatus(page, /^Aprovado$/);
    await openBillingDetail(page, vs[0].id);
    await goToLastStep(page);
    await approveBillingForOpenVehicle(page);
    await pause(page, 8000);

    const cfgs = await prisma.budgetPayer.findMany({
      where: { quoteId },
      select: {
        id: true, total: true,
        customer: { select: { fantasyName: true, corporateName: true } },
        billing: { select: { id: true, approvedAt: true, tasks: { select: { taskId: true } } } },
        // `invoices` (plural): a relação é 1:N no banco desde sempre (a viva mais
        // as canceladas dos ciclos anteriores). O filtro isola a viva.
        invoices: { where: { status: { not: 'CANCELLED' } }, select: { id: true, totalAmount: true } },
      },
    });
    check('C4: nasceram 2 faturamentos (um por cliente)', cfgs.length === 2, `${cfgs.length}`);
    // Alfa paga R$ 1.000 por veículo (× 2), Beta R$ 500 por veículo (× 2).
    const alfa = cfgs.find(c => /Alfa/i.test(`${c.customer?.fantasyName} ${c.customer?.corporateName}`));
    const beta = cfgs.find(c => /Beta/i.test(`${c.customer?.fantasyName} ${c.customer?.corporateName}`));
    check('C4: a fatura do Alfa é 1.000 × 2 veículos', near(Number(alfa?.total ?? 0), 2000), money(Number(alfa?.total ?? 0)));
    check('C4: a fatura do Beta é 500 × 2 veículos', near(Number(beta?.total ?? 0), 1000), money(Number(beta?.total ?? 0)));
    check('C4: as duas faturas cobrem os 2 veículos',
      cfgs.every(c => (c.billing?.tasks ?? []).length === 2), JSON.stringify(cfgs.map(c => (c.billing?.tasks ?? []).length)));

    const notas = (await sentinelaCalls()).filter(
      x => x.seq > marcador && x.path.includes('salvar-nota-fiscal') &&
        vs.some(v => JSON.stringify(x.body ?? {}).includes(v.serialNumber!)),
    );
    check('C4: saiu uma nota por cliente', notas.length === 2, `${notas.length}`);
    for (const n of notas) {
      const body: any = n.body;
      // `razao` é o campo que a Elotech recebe (não `razaoSocial`): lendo o
      // nome errado, o teste caía no ramo "não é o Alfa" e cobrava do Beta o
      // valor do Alfa.
      const razao: string = body?.formTomador?.razao ?? '';
      const itens: any[] = body?.formItensNFSe ?? [];
      const liquido = Math.round(itens.reduce((a, i) => a + Number(i.valorLiquido ?? 0), 0) * 100) / 100;
      const esperado = /Alfa/i.test(razao) ? 2000 : 1000;
      check(`C4: a nota de ${razao.slice(0, 24)} vale ${money(esperado)}`, near(liquido, esperado),
        `nota=${money(liquido)}`);
      check(`C4: a nota de ${razao.slice(0, 24)} tem UMA linha (só o serviço dele)`, itens.length === 1,
        `${itens.length} linhas: ${JSON.stringify(itens.map(i => i.item))}`);
      check(`C4: a linha declara quantidade 2`, itens.every(i => Number(i.quantidade) === 2),
        JSON.stringify(itens.map(i => i.quantidade)));
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // C5 — sem nota e sem boleto
  // ═══════════════════════════════════════════════════════════════════════
  if (rodar('C5')) await scenario('C5 · faturamento sem NFS-e e sem boleto', page, async () => {
    const marcador = await seq();
    const res = await createQuote(page, {
      name: `QA C5 ${S}`,
      customer: /QA Alfa/, customerSearch: 'QA Alfa', category: /^Truck$/,
      serials: `${S + 40} ${S + 41}`,
      orderNumber: `PEDC5${S}`,
      services: [{ search: 'Logomarca', option: /./, amount: String(Math.round(PRECO * 100)) }],
      paymentCondition: /À Vista - Boleto/,
    });
    const taskId = res.url.split('/').pop()!;
    const quoteId = (await prisma.task.findUnique({ where: { id: taskId }, select: { quoteId: true } }))!.quoteId!;
    const vs = await veiculosDo(quoteId);

    await openQuoteDetail(page, vs[0].id);
    await goToLastStep(page);
    await setQuoteStatus(page, /^Aprovado$/);

    // As duas chaves ficam no passo do CLIENTE do assistente de Faturamento.
    await openBillingDetail(page, vs[0].id);
    await page.getByRole('button', { name: /Cliente 1/ }).click();
    await pause(page, 3000);
    for (const rotulo of ['Gerar NF', 'Gerar Boleto']) {
      const desligou = await page.evaluate((r: string) => {
        const lab = [...document.querySelectorAll('label')].find(
          e => (e.textContent || '').trim() === r,
        );
        const bloco = lab?.parentElement as HTMLElement | undefined;
        const sw = bloco?.querySelector('button[role="switch"]') as HTMLElement | null;
        if (!sw) return false;
        if (sw.getAttribute('aria-checked') === 'true') sw.click();
        return true;
      }, rotulo);
      check(`C5: a chave "${rotulo}" existe na tela do cliente`, desligou);
      await pause(page, 800);
    }
    await saveDetail(page);

    const cfg = await prisma.budgetPayer.findFirst({
      where: { quoteId }, select: { generateInvoice: true, generateBankSlip: true },
    });
    check('C5: as duas chaves gravaram desligadas',
      cfg?.generateInvoice === false && cfg?.generateBankSlip === false,
      `NF=${cfg?.generateInvoice} boleto=${cfg?.generateBankSlip}`);

    await openBillingDetail(page, vs[0].id);
    await goToLastStep(page);
    await approveBillingForOpenVehicle(page);
    await pause(page, 8000);

    // Recorte pelo CONTEÚDO, como em `conferirDinheiro`: a sentinela é comum aos
    // quatro workers, e "nenhuma nota saiu" só é afirmável sobre ESTES veículos.
    const meuC5 = (x: { body: unknown }) =>
      vs.some(v => JSON.stringify(x.body ?? {}).includes(v.serialNumber!));
    const chamadas = (await sentinelaCalls()).filter(x => x.seq > marcador && meuC5(x));
    const notas = chamadas.filter(x => x.path.includes('salvar-nota-fiscal'));
    const boletos = chamadas.filter(x => x.integration === 'sicredi' && x.method === 'POST' && x.path.endsWith('/boletos'));
    check('C5: NENHUMA nota saiu', notas.length === 0, `${notas.length}`);
    check('C5: NENHUM boleto saiu', boletos.length === 0, `${boletos.length}`);

    const inv = await prisma.invoice.findFirst({
      where: { customerConfig: { quoteId } },
      select: { totalAmount: true, installments: { select: { amount: true, bankSlip: { select: { id: true } } } } },
    });
    check('C5: a fatura nasceu mesmo assim', !!inv, `${inv ? money(Number(inv.totalAmount)) : 'nenhuma'}`);
    check('C5: a fatura vale por veículo × 2', near(Number(inv?.totalAmount ?? 0), porVeiculo(PRECO) * 2),
      money(Number(inv?.totalAmount ?? 0)));
    check('C5: a parcela nasceu SEM boleto', (inv?.installments ?? []).every(i => !i.bankSlip),
      JSON.stringify((inv?.installments ?? []).map(i => !!i.bankSlip)));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // C6 — um caminhão a mais depois de a primeira fatia ter saído
  // ═══════════════════════════════════════════════════════════════════════
  if (rodar('C6')) await scenario('C6 · acrescentar veículo a um orçamento já faturado', page, async () => {
    const res = await createQuote(page, {
      name: `QA C6 ${S}`,
      customer: /QA Alfa/, customerSearch: 'QA Alfa', category: /^Truck$/,
      serials: `${S + 50} ${S + 51}`,
      orderNumber: `PEDC6${S}`,
      services: [{ search: 'Logomarca', option: /./, amount: String(Math.round(PRECO * 100)) }],
      billing: ['PER_TASK'],
      paymentCondition: /À Vista - Boleto/,
    });
    const taskId = res.url.split('/').pop()!;
    const quoteId = (await prisma.task.findUnique({ where: { id: taskId }, select: { quoteId: true } }))!.quoteId!;
    const vs = await veiculosDo(quoteId);

    await openQuoteDetail(page, vs[0].id);
    await goToLastStep(page);
    await setQuoteStatus(page, /^Aprovado$/);
    await openBillingDetail(page, vs[0].id);
    await goToLastStep(page);
    await approveBillingForOpenVehicle(page);
    await pause(page, 6000);

    const antes = await prisma.budget.findUnique({
      where: { id: quoteId },
      select: { total: true, customerConfigs: { select: { id: true, total: true, billing: { select: { approvedAt: true } } } } },
    });
    const faturaEmitida = await prisma.invoice.findFirst({
      where: { customerConfig: { quoteId } }, select: { id: true, totalAmount: true },
    });
    check('C6: o primeiro caminhão foi faturado', !!faturaEmitida, `${faturaEmitida?.totalAmount}`);

    // ── O TERCEIRO CAMINHÃO ENTRA ─────────────────────────────────────────
    //
    // A interface OFERECE esse caminho? O campo de faixa de séries
    // (`SerialNumberRangeInput`) só é renderizado na CRIAÇÃO: em modo edição o
    // passo 1 mostra a série de UMA tarefa. A API aceita (`PUT /budgets/:id`
    // com `taskIds`, e `resliceQuoteCoverage` já trata fatia congelada, fatia
    // nova e veículo retirado) — o que falta é a tela.
    //
    // Contornar por endpoint aqui esconderia exatamente a falta que a bateria
    // procura, então o cenário REGISTRA a ausência e para.
    await openQuoteDetail(page, vs[0].id);
    let deuParaAcrescentar = true;
    try {
      await addVehicleSerial(page, String(S + 52));
    } catch (err: any) {
      deuParaAcrescentar = false;
      check(
        'C6: a tela do orçamento oferece como ACRESCENTAR um veículo',
        false,
        `o campo de séries não existe na edição — ${String(err?.message ?? err).slice(0, 120)}`,
      );
    }
    if (!deuParaAcrescentar) return;
    await saveDetail(page);
    await pause(page, 3000);

    const depois = await prisma.budget.findUnique({
      where: { id: quoteId },
      select: {
        total: true, vehicleCount: true,
        customerConfigs: {
          select: { id: true, total: true, billing: { select: { id: true, approvedAt: true, tasks: { select: { taskId: true } } } } },
        },
      },
    });
    const unit = porVeiculo(PRECO);
    check('C6: o orçamento passou a ter 3 veículos', depois?.vehicleCount === 3, `${depois?.vehicleCount}`);
    check('C6: o contrato cresceu para por veículo × 3',
      near(Number(depois?.total ?? 0), Math.round(unit * 3 * 100) / 100), money(Number(depois?.total ?? 0)));
    check('C6: nasceu uma fatia para o caminhão novo',
      (depois?.customerConfigs ?? []).length === 3, `${(depois?.customerConfigs ?? []).length}`);

    // A FATIA JÁ FATURADA NÃO SE MEXE — nem no valor, nem na cobertura.
    const aprovada = (depois?.customerConfigs ?? []).find(c => c.billing?.approvedAt);
    const antesAprovada = (antes?.customerConfigs ?? []).find(c => c.billing?.approvedAt);
    check('C6: a fatia já faturada manteve o valor',
      !!aprovada && near(Number(aprovada.total), Number(antesAprovada?.total ?? -1)),
      `antes=${antesAprovada?.total} depois=${aprovada?.total}`);
    check('C6: a fatia já faturada continua cobrindo 1 veículo',
      (aprovada?.billing?.tasks ?? []).length === 1, `${(aprovada?.billing?.tasks ?? []).length}`);
    const faturaDepois = await prisma.invoice.findUnique({
      where: { id: faturaEmitida!.id }, select: { totalAmount: true },
    });
    check('C6: a FATURA emitida não mudou de valor',
      near(Number(faturaDepois?.totalAmount ?? 0), Number(faturaEmitida!.totalAmount)),
      money(Number(faturaDepois?.totalAmount ?? 0)));
    check('C6: o caminhão novo ainda NÃO tem fatura',
      (depois?.customerConfigs ?? []).filter(c => !c.billing?.approvedAt).length === 2,
      JSON.stringify((depois?.customerConfigs ?? []).map(c => !!c.billing?.approvedAt)));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // C7 — mudar o preço depois de faturar
  // ═══════════════════════════════════════════════════════════════════════
  if (rodar('C7')) await scenario('C7 · mudar o preço de um orçamento já faturado é recusado', page, async () => {
    const res = await createQuote(page, {
      name: `QA C7 ${S}`,
      customer: /QA Alfa/, customerSearch: 'QA Alfa', category: /^Truck$/,
      serials: `${S + 60} ${S + 61}`,
      orderNumber: `PEDC7${S}`,
      services: [{ search: 'Logomarca', option: /./, amount: String(Math.round(PRECO * 100)) }],
      paymentCondition: /À Vista - Boleto/,
    });
    const taskId = res.url.split('/').pop()!;
    const quoteId = (await prisma.task.findUnique({ where: { id: taskId }, select: { quoteId: true } }))!.quoteId!;
    const vs = await veiculosDo(quoteId);

    await openQuoteDetail(page, vs[0].id);
    await goToLastStep(page);
    await setQuoteStatus(page, /^Aprovado$/);
    await openBillingDetail(page, vs[0].id);
    await goToLastStep(page);
    await approveBillingForOpenVehicle(page);
    await pause(page, 6000);

    const inv = await prisma.invoice.findFirst({
      where: { customerConfig: { quoteId } }, select: { totalAmount: true },
    });
    const totalAntes = Number(inv?.totalAmount ?? 0);

    // A tela de ORÇAMENTO não trava valores (a de Faturamento trava), então é
    // por ela que o preço de um contrato já faturado poderia ser reescrito — e a
    // fatura, o boleto e a nota já saíram sobre o preço antigo.
    await openQuoteDetail(page, vs[0].id);
    await gotoStep(page, /Servi/);
    await setFirstServiceAmount(page, '999999');
    await saveDetail(page);
    await pause(page, 3000);

    const aviso = await lastToast(page);
    const q = await prisma.budget.findUnique({
      where: { id: quoteId },
      select: { total: true, services: { select: { amount: true } } },
    });
    const precoGravado = Number(q?.services?.[0]?.amount ?? 0);
    const invDepois = await prisma.invoice.findFirst({
      where: { customerConfig: { quoteId } }, select: { totalAmount: true },
    });
    check('C7: o preço do serviço NÃO mudou no banco', near(precoGravado, porVeiculo(PRECO)),
      `gravado=${money(precoGravado)}`);
    check('C7: a fatura emitida continua com o valor de antes',
      near(Number(invDepois?.totalAmount ?? 0), totalAntes), money(totalAntes));
    // A RECUSA TEM DE DIZER O QUE FAZER — e o que se faz é REVERTER o
    // faturamento, não cancelar o orçamento. A mensagem antiga mandava
    // "solicitar o cancelamento do orçamento", que é destruir o contrato para
    // corrigir um preço.
    check('C7: a tela explicou a recusa e mandou REVERTER o faturamento',
      /faturamento/i.test(aviso) && /revert/i.test(aviso) && !/cancelamento do or/i.test(aviso),
      aviso.slice(0, 260) || '(nenhum aviso na tela)');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // C8 — dois clientes × uma fatura por veículo (2×N fatias)
  // ═══════════════════════════════════════════════════════════════════════
  if (rodar('C8')) await scenario('C8 · dois clientes E uma fatura por veículo', page, async () => {
    const marcador = await seq();
    const res = await createQuote(page, {
      name: `QA C8 ${S}`,
      customer: /QA Alfa/, customerSearch: 'QA Alfa', category: /^Truck$/,
      serials: `${S + 70} ${S + 71}`,
      orderNumber: `PEDC8${S}`,
      extraBillingCustomers: [{ search: 'QA Beta', option: /QA BETA/i }],
      services: [
        { search: 'Logomarca', option: /./, amount: '100000', customer: /QA ALFA/i },
        { search: 'Logomarca', option: /./, amount: '50000', customer: /QA BETA/i },
      ],
      // O recorte é do ORÇAMENTO: declarar uma vez vale para os dois clientes.
      billing: ['PER_TASK'],
      paymentCondition: /À Vista - Boleto/,
    });
    const taskId = res.url.split('/').pop()!;
    const quoteId = (await prisma.task.findUnique({ where: { id: taskId }, select: { quoteId: true } }))!.quoteId!;
    const vs = await veiculosDo(quoteId);

    const cfgs0 = await prisma.budgetPayer.findMany({
      where: { quoteId }, select: { customerId: true, billing: { select: { id: true, approvedAt: true, tasks: { select: { taskId: true } } } } },
    });
    check('C8: nasceram 4 fatias (2 clientes × 2 veículos)', cfgs0.length === 4, `${cfgs0.length}`);
    check('C8: cada fatia cobre UM veículo',
      cfgs0.every(c => (c.billing?.tasks ?? []).length === 1),
      JSON.stringify(cfgs0.map(c => (c.billing?.tasks ?? []).length)));

    await openQuoteDetail(page, vs[0].id);
    await goToLastStep(page);
    await setQuoteStatus(page, /^Aprovado$/);

    // ── APROVAR O PRIMEIRO CAMINHÃO ───────────────────────────────────────
    //
    // Aprovar um veículo fecha TODAS as faturas que o cobrem — as duas dele, uma
    // de cada cliente — e nenhuma do outro caminhão. É a pergunta de COBERTURA,
    // e é exatamente onde "fatia" e "cliente" seriam confundidos.
    await openBillingDetail(page, vs[0].id);
    await goToLastStep(page);
    await approveBillingForOpenVehicle(page);
    await pause(page, 8000);

    const meio = await prisma.budgetPayer.findMany({
      where: { quoteId },
      select: { billing: { select: { id: true, approvedAt: true, tasks: { select: { taskId: true } } } } },
    });
    const aprovadasDoPrimeiro = meio.filter(
      c => c.billing?.approvedAt && (c.billing?.tasks ?? []).some(r => r.taskId === vs[0].id),
    ).length;
    const aprovadasDoSegundo = meio.filter(
      c => c.billing?.approvedAt && (c.billing?.tasks ?? []).some(r => r.taskId === vs[1].id),
    ).length;
    check('C8: as DUAS faturas do primeiro caminhão foram aprovadas', aprovadasDoPrimeiro === 2,
      `${aprovadasDoPrimeiro}`);
    check('C8: NENHUMA fatura do segundo caminhão foi tocada', aprovadasDoSegundo === 0,
      `${aprovadasDoSegundo}`);

    // ── E O SEGUNDO ───────────────────────────────────────────────────────
    await openBillingDetail(page, vs[1].id);
    await goToLastStep(page);
    await approveBillingForOpenVehicle(page);
    await pause(page, 8000);

    await conferirDinheiro('C8', quoteId, {
      // Cada cliente tem o SEU preço por veículo: Alfa R$ 1.000, Beta R$ 500.
      // O contrato é a soma (R$ 1.500) × 2 veículos = R$ 3.000.
      totalPorVeiculo: { Alfa: 1000, Beta: 500 },
      fatias: [
        { cobertos: 1, parcelas: 1, nota: true, boleto: true },
        { cobertos: 1, parcelas: 1, nota: true, boleto: true },
        { cobertos: 1, parcelas: 1, nota: true, boleto: true },
        { cobertos: 1, parcelas: 1, nota: true, boleto: true },
      ],
    }, marcador, `PEDC8${S}`);

    // Cada nota fala de UM caminhão e de UM cliente.
    const notas = (await sentinelaCalls()).filter(
      x => x.seq > marcador && x.path.includes('salvar-nota-fiscal') &&
        vs.some(v => JSON.stringify(x.body ?? {}).includes(v.serialNumber!)),
    );
    check('C8: saíram 4 notas (uma por fatia)', notas.length === 4, `${notas.length}`);
    for (const n of notas) {
      const body: any = n.body;
      const itens: any[] = body?.formItensNFSe ?? [];
      const liquido = Math.round(itens.reduce((a, i) => a + Number(i.valorLiquido ?? 0), 0) * 100) / 100;
      const razao: string = body?.formTomador?.razao ?? '';
      const esperado = /Alfa/i.test(razao) ? 1000 : 500;
      check(`C8: a nota de ${razao.slice(0, 20)} vale ${money(esperado)}`, near(liquido, esperado),
        `nota=${money(liquido)}`);
      check('C8: a nota tem UMA linha e quantidade 1',
        itens.length === 1 && Number(itens[0]?.quantidade) === 1,
        JSON.stringify(itens.map(i => ({ q: i.quantidade, v: i.valorLiquido }))));
      const disc: string = body?.formDadosNFSe?.discriminacaoServico ?? '';
      const citados = vs.filter(v => disc.includes(v.serialNumber!)).length;
      check('C8: a discriminação cita exatamente UM veículo', citados === 1, disc.replace(/\n/g, ' ⏎ '));
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CA — reverter com o orçamento pela metade
  // ═══════════════════════════════════════════════════════════════════════
  if (rodar('CA')) await scenario('CA · reverter com uma fatia aprovada e outra não', page, async () => {
    const res = await createQuote(page, {
      name: `QA CA ${S}`,
      customer: /QA Alfa/, customerSearch: 'QA Alfa', category: /^Truck$/,
      serials: `${S + 80} ${S + 81}`,
      orderNumber: `PEDCA${S}`,
      services: [{ search: 'Logomarca', option: /./, amount: String(Math.round(PRECO * 100)) }],
      billing: ['PER_TASK'],
      paymentCondition: /À Vista - Boleto/,
    });
    const taskId = res.url.split('/').pop()!;
    const quoteId = (await prisma.task.findUnique({ where: { id: taskId }, select: { quoteId: true } }))!.quoteId!;
    const vs = await veiculosDo(quoteId);

    await openQuoteDetail(page, vs[0].id);
    await goToLastStep(page);
    await setQuoteStatus(page, /^Aprovado$/);
    await openBillingDetail(page, vs[0].id);
    await goToLastStep(page);
    await approveBillingForOpenVehicle(page);
    await pause(page, 6000);

    const meio = await prisma.budgetPayer.findMany({
      where: { quoteId }, select: { billing: { select: { approvedAt: true } } },
    });
    check('CA: só UMA fatia está aprovada antes de reverter',
      meio.filter(c => c.billing?.approvedAt).length === 1,
      JSON.stringify(meio.map(c => !!c.billing?.approvedAt)));

    // ── REVERTER COM O ORÇAMENTO PELA METADE ──────────────────────────────
    await openBillingDetail(page, vs[0].id);
    await goToLastStep(page);
    await revertBilling(page);

    const depois = await prisma.budget.findUnique({
      where: { id: quoteId },
      select: { status: true, customerConfigs: { select: { billing: { select: { approvedAt: true } } } } },
    });
    const faturas = await prisma.invoice.count({
      where: { OR: [{ customerConfig: { quoteId } }, { task: { quoteId } }] },
    });
    check('CA: o orçamento continua Aprovado', depois?.status === 'APPROVED',
      `status=${depois?.status}`);
    check('CA: não sobrou fatura nenhuma', faturas === 0, `${faturas}`);
    check('CA: nenhuma fatia ficou carimbada',
      (depois?.customerConfigs ?? []).every(c => !c.billing?.approvedAt),
      JSON.stringify((depois?.customerConfigs ?? []).map(c => !!c.billing?.approvedAt)));
    check('CA: as DUAS fatias continuam existindo — a divisão não se desfaz',
      (depois?.customerConfigs ?? []).length === 2,
      `${(depois?.customerConfigs ?? []).length}`);

    // ── E DÁ PARA FATURAR OS DOIS DE NOVO ─────────────────────────────────
    const marcador2 = await seq();
    for (const v of vs) {
      await openBillingDetail(page, v.id);
      await goToLastStep(page);
      await approveBillingForOpenVehicle(page);
      await pause(page, 6000);
    }
    await conferirDinheiro('CA', quoteId, {
      totalPorVeiculo: porVeiculo(PRECO),
      fatias: [
        { cobertos: 1, parcelas: 1, nota: true, boleto: true },
        { cobertos: 1, parcelas: 1, nota: true, boleto: true },
      ],
    }, marcador2, `PEDCA${S}`);
  });

  await scenario('C9 · nada vazou', page, async () => {
    const calls = await sentinelaCalls();
    const escapes = calls.filter(x => x.integration === 'ESCAPE');
    check('C9: nenhuma chamada a caminho não mapeado', escapes.length === 0,
      JSON.stringify(escapes.slice(0, 5).map(e => e.path)));
  });

  await browser.close();
  await prisma.$disconnect();
  process.exit(report() > 0 ? 1 : 0);
}

main();
