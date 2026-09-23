/**
 * G21 — RÓTULOS FISCAIS DE OURO: o texto de hoje, byte a byte, em cada documento.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────
 * A nota fiscal não se edita: emitida, ela é da prefeitura. E os documentos que
 * nomeiam o veículo NÃO falam a mesma língua (D-18):
 *
 *   - NFS-e da tarefa (Elotech)  → "Carga seca", "Isotérmico", "Prancha/Plataforma";
 *   - boleto e fatura            → "Carga Seca", "Isoplastic", "Carroceria";
 *   - NFS-e do aerografista      → os rótulos da TELA (hoje iguais aos do boleto).
 *
 * "Nenhuma palavra muda na nota até o dono escolher" quer dizer que CADA
 * documento continua com o texto de hoje. Uma fonte única de rótulos que
 * unificasse os mapas já mudaria dois documentos — por isso ela nasce com um
 * perfil por documento, e este arquivo trava, sobre os construtores REAIS:
 *
 *   1. a frase do veículo com série, só placa, só chassi e sem nada, em
 *      `buildDiscriminacao` (via `ElotechOxyNfseService.buildPayload`),
 *      `buildServiceDescription` (DPS do aerografista), `buildBoletoLines`
 *      (os DOIS construtores do informativo), recibo de quitação,
 *      `coverageLabels`/`coverageSummary` e `formatTaskIdentifier`;
 *   2. cada palavra de categoria e de implemento, em cada documento;
 *   3. o DTO de entrada de `emitNfse({ task: { id, name, serialNumber } })` que
 *      três scripts montam à mão: se a série sumir dele, a nota sai com
 *      "Ref. OS" em silêncio (§6.15).
 *
 * As fixtures têm a forma que o `select` real de cada serviço carrega
 * (`Task { id, name, serialNumber, customerOrderNumber, truck { plate,
 * chassisNumber, category, implementType } }`). A série continua em
 * `task.serialNumber` — os leitores só mudam no P28, e este teste é o que vai
 * dizer se a mudança manteve o texto.
 *
 * Rodar: `npx tsx tests/fiscal-labels-golden.test.ts` (sem banco).
 */
import { InvoiceGenerationService } from '../src/modules/financial/invoice/invoice-generation.service';
import { SicrediBoletoScheduler } from '../src/modules/integrations/sicredi/sicredi-boleto.scheduler';
import {
  ElotechOxyNfseService,
  type MunicipalEmitNfseInput,
} from '../src/modules/integrations/nfse/elotech-oxy-nfse.service';
import { buildServiceDescription } from '../src/modules/integrations/nfse/painter/dps.builder';
import { BudgetReceiptService } from '../src/modules/production/budget/budget-receipt.service';
import { coverageLabels, coverageSummary } from '../src/utils/quote-tasks';
import { formatTaskIdentifier } from '../src/utils/task';
import {
  implementTypeLabel,
  truckCategoryLabel,
} from '../src/modules/common/signature/document/quote-text';
import { IMPLEMENT_TYPE, TRUCK_CATEGORY } from '../src/constants/enums';
import { Logger } from '@nestjs/common';

// Os construtores logam cada informativo montado; aqui isso é só ruído.
Logger.overrideLogger(false);

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
/** Igualdade exata; na falha mostra os dois textos inteiros. */
function golden(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `\n      hoje:     ${e}\n      recebido: ${a}`);
}

// ─── Os construtores, com dublês que nunca são chamados ────────────────────
const stub: any = {};
const config = { get: (_k: string, d?: any) => d } as any;
const geracao: any = new InvoiceGenerationService(stub, stub, stub, stub);
const varredura: any = new SicrediBoletoScheduler(
  stub, stub, stub, stub, stub, config, stub, stub, stub,
);
const elotechAuth: any = { getContribuinteData: () => ({}), buildUfObject: () => ({}) };
const elotech: any = new ElotechOxyNfseService(config, stub, elotechAuth);

// ─── As fixtures: a tarefa como o `select` real a devolve ──────────────────
interface TaskRow {
  id: string;
  name: string;
  serialNumber: string | null;
  customerOrderNumber: string | null;
  truck: {
    plate: string | null;
    chassisNumber: string | null;
    category: string | null;
    implementType: string | null;
  } | null;
}

const COM_SERIE: TaskRow = {
  id: 'task-a-000001',
  name: 'Frota Carlotti',
  serialNumber: '78000',
  customerOrderNumber: '4000000',
  truck: { plate: 'TES1T01', chassisNumber: '9BM979026CS006620', category: 'RIGID', implementType: 'INSULATED' },
};
const SO_PLACA: TaskRow = {
  id: 'task-b-000002',
  name: 'Frota Carlotti',
  serialNumber: null,
  customerOrderNumber: null,
  truck: { plate: 'TES1T02', chassisNumber: null, category: 'TRUCK', implementType: 'FLATBED' },
};
const SO_CHASSI: TaskRow = {
  id: 'task-c-000003',
  name: 'Frota Carlotti',
  serialNumber: null,
  customerOrderNumber: null,
  truck: { plate: null, chassisNumber: '9BM979026CS006621', category: 'BITRUCK', implementType: 'DRY_CARGO' },
};
const SEM_NADA: TaskRow = {
  id: 'task-d-000004',
  name: 'Frota Carlotti',
  serialNumber: null,
  customerOrderNumber: null,
  truck: { plate: null, chassisNumber: null, category: null, implementType: null },
};

// ─── Como cada serviço transforma a tarefa no seu documento ────────────────

/**
 * A NFS-e da tarefa: o `emitInput` como `nfse-emission.scheduler.ts` o monta
 * (task/truck de contexto + `vehicles` da cobertura), passado ao
 * `buildPayload` real. Devolve a discriminação que vai à prefeitura.
 */
async function nfseDiscriminacao(rows: TaskRow[], budgetNumber = 990): Promise<string> {
  const slice = rows[0];
  const truck = slice.truck;
  const input: MunicipalEmitNfseInput = {
    id: 'invoice-1',
    totalAmount: 100 * rows.length,
    customer: { name: 'Carlotti', cnpj: '12345678000199' },
    task: { id: slice.id, name: slice.name, serialNumber: slice.serialNumber || undefined },
    truck: truck
      ? {
          plate: truck.plate || undefined,
          chassisNumber: truck.chassisNumber || undefined,
          category: truck.category || undefined,
          implementType: truck.implementType || undefined,
        }
      : undefined,
    vehicles: rows.map(t => ({
      serialNumber: t.serialNumber ?? null,
      plate: t.truck?.plate ?? null,
      chassisNumber: t.truck?.chassisNumber ?? null,
      category: t.truck?.category ?? null,
      implementType: t.truck?.implementType ?? null,
      orderNumber: t.customerOrderNumber ?? null,
    })),
    budgetNumber,
    orderNumber: slice.customerOrderNumber ?? undefined,
    services: [{ description: 'Logomarca Lateral', amount: 100 }],
    serviceQuantity: rows.length,
  } as MunicipalEmitNfseInput;
  return discriminacaoOf(await elotech.buildPayload(input));
}

/** O payload da Elotech aninha a discriminação; acha-a onde estiver. */
function discriminacaoOf(payload: unknown): string {
  const seen = new Set<unknown>();
  const walk = (node: any): string | undefined => {
    if (!node || typeof node !== 'object' || seen.has(node)) return undefined;
    seen.add(node);
    if (typeof node.discriminacaoServico === 'string') return node.discriminacaoServico;
    for (const value of Object.values(node)) {
      const found = walk(value);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const found = walk(payload);
  if (found === undefined) throw new Error('payload da Elotech sem discriminacaoServico');
  return found;
}

/** A parcela como o registro do boleto a enxerga (mesma forma do select). */
function parcela(rows: TaskRow[], taskDaFatura: TaskRow | null): any {
  return {
    id: 'inst-1',
    number: 1,
    amount: 1200,
    invoice: {
      task: taskDaFatura,
      nfseDocuments: [{ nfseNumber: 9001 }],
      customerConfig: {
        customerId: 'cust-1',
        billing: { tasks: rows.map(t => ({ taskId: t.id })) },
        quote: {
          tasks: rows,
          services: [{ description: 'logomarca frente', invoiceToCustomerId: null }],
        },
      },
    },
  };
}

/** Os DOIS construtores do informativo; têm de dizer a mesma coisa. */
function boletoLines(rows: TaskRow[], taskDaFatura: TaskRow | null): string[] {
  const a: string[] = geracao.buildBoletoLines(parcela(rows, taskDaFatura)) ?? [];
  const b: string[] = varredura.buildBoletoLines(parcela(rows, taskDaFatura)) ?? [];
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`  ✗ os dois construtores do boleto divergiram\n      ${JSON.stringify(a)}\n      ${JSON.stringify(b)}`);
  }
  return a;
}

/** A DPS do aerografista: a aerografia como `painter-nfse.service.ts` a seleciona. */
function dpsDescription(row: TaskRow): string {
  return buildServiceDescription('Serviço de aerografia', {
    description: null,
    task: {
      name: row.name,
      serialNumber: row.serialNumber,
      customer: { fantasyName: 'Carlotti', corporateName: null },
      truck: row.truck,
    },
  });
}

/**
 * O recibo de quitação: o `generate` real, com o banco dublado pela forma do
 * `include` dele e o Chromium trocado por quem só guarda o HTML.
 */
async function receiptVehicleRow(rows: TaskRow[]): Promise<string | null> {
  const quote = {
    id: 'quote-1',
    budgetNumber: 990,
    total: 100 * rows.length,
    updatedAt: new Date('2026-09-23T12:00:00Z'),
    tasks: rows.map(t => ({
      ...t,
      createdAt: new Date('2026-09-01T12:00:00Z'),
      customer: { id: 'cust-1', fantasyName: 'Carlotti', corporateName: 'Carlotti Ltda', cnpj: null, cpf: null },
    })),
    services: [{ description: 'Logomarca Lateral', amount: 100 }],
    customerConfigs: [],
    billings: [{ status: 'SETTLED' }],
  };
  const prisma: any = { budget: { findUnique: async () => quote } };
  const service: any = new BudgetReceiptService(prisma);
  let html = '';
  service.renderPdf = async (h: string) => {
    html = h;
    return Buffer.from('');
  };
  service.getLogoDataUri = () => null;
  await service.generate('quote-1');
  const m = html.match(/<span class="k">VEÍCULO<\/span><span class="v">([^<]*)<\/span>/);
  return m ? m[1] : null;
}

const cobertura = (rows: TaskRow[]) => ({ tasks: rows.map(t => ({ taskId: t.id, task: t })) });

// ═══════════════════════════════════════════════════════════════════════════
// 1. Um veículo, quatro identidades: o texto de hoje em cada documento
// ═══════════════════════════════════════════════════════════════════════════
async function umVeiculo(): Promise<void> {
  console.log('\n1. NFS-e da tarefa (Elotech) — um veículo');
  golden('com série', await nfseDiscriminacao([COM_SERIE]), [
    'Pedido: 4000000',
    'Referente aos serviços executados no veículo Toco Isotérmico de n série: 78000, placa: TES1T01, chassi: 9BM979026CS006620.',
    'Logomarca Lateral',
  ].join('\n'));
  golden('só placa', await nfseDiscriminacao([SO_PLACA]), [
    'Referente aos serviços executados no veículo Truck Prancha/Plataforma de placa: TES1T02.',
    'Logomarca Lateral',
  ].join('\n'));
  golden('só chassi', await nfseDiscriminacao([SO_CHASSI]), [
    'Referente aos serviços executados no veículo Bitruck Carga seca de chassi: 9BM979026CS006621.',
    'Logomarca Lateral',
  ].join('\n'));
  golden('sem nada: recua para "Ref. OS" com o orçamento', await nfseDiscriminacao([SEM_NADA]), [
    'Ref. OS Orçamento 990',
    'Logomarca Lateral',
  ].join('\n'));

  console.log('\n2. Boleto — informativo (invoice-generation e sicredi-boleto.scheduler)');
  golden('com série', boletoLines([COM_SERIE], COM_SERIE), [
    'Pedido: 4000000 - NF 9001',
    'Referente aos servicos no veiculo Toco Isoplastic',
    'N.º serie: 78000, placa: TES1T01, chassi: 9BM979026CS006620',
    'Logomarca frente',
  ]);
  golden('só placa', boletoLines([SO_PLACA], SO_PLACA), [
    'NF 9001',
    'Referente aos servicos no veiculo Truck Carroceria',
    'Placa: TES1T02',
    'Logomarca frente',
  ]);
  golden('só chassi', boletoLines([SO_CHASSI], SO_CHASSI), [
    'NF 9001',
    'Referente aos servicos no veiculo Bitruck Carga Seca',
    'chassi: 9BM979026CS006621',
    'Logomarca frente',
  ]);
  golden('sem nada', boletoLines([SEM_NADA], SEM_NADA), ['NF 9001', 'Logomarca frente']);

  console.log('\n3. NFS-e do aerografista (DPS nacional, xDescServ)');
  golden('com série', dpsDescription(COM_SERIE),
    'Serviço de aerografia. Referente aos serviços executados no veículo Toco Isoplastic de ' +
      'n série: 78000, placa: TES1T01, chassi: 9BM979026CS006620. Cliente: Carlotti.');
  golden('só placa', dpsDescription(SO_PLACA),
    'Serviço de aerografia. Referente aos serviços executados no veículo Truck Carroceria de ' +
      'placa: TES1T02. Cliente: Carlotti.');
  golden('só chassi', dpsDescription(SO_CHASSI),
    'Serviço de aerografia. Referente aos serviços executados no veículo Bitruck Carga Seca de ' +
      'chassi: 9BM979026CS006621. Cliente: Carlotti.');
  golden('sem nada: cita a ordem de serviço pelo nome', dpsDescription(SEM_NADA),
    'Serviço de aerografia. Referente à ordem de serviço Frota Carlotti. Cliente: Carlotti.');

  console.log('\n4. Recibo de quitação — linha VEÍCULO');
  golden('com série', await receiptVehicleRow([COM_SERIE]), 'SÉRIE 78000 · PLACA TES1T01');
  golden('só placa', await receiptVehicleRow([SO_PLACA]), 'PLACA TES1T02');
  golden('só chassi: o recibo não cita chassi', await receiptVehicleRow([SO_CHASSI]), null);
  golden('sem nada', await receiptVehicleRow([SEM_NADA]), null);

  console.log('\n5. coverageLabels / coverageSummary (cláusula de pagamento)');
  golden('com série', coverageLabels(cobertura([COM_SERIE]) as any), ['78000']);
  golden('só placa', coverageLabels(cobertura([SO_PLACA]) as any), ['TES1T02']);
  golden('só chassi: recua para o nome', coverageLabels(cobertura([SO_CHASSI]) as any), ['Frota Carlotti']);
  golden('sem nada: recua para o nome', coverageLabels(cobertura([SEM_NADA]) as any), ['Frota Carlotti']);
  golden('um de quatro', coverageSummary(cobertura([COM_SERIE]) as any, 4), 'Veículo 78000');

  console.log('\n6. formatTaskIdentifier');
  golden('com série', formatTaskIdentifier(COM_SERIE as any), '78000');
  golden('só placa', formatTaskIdentifier(SO_PLACA as any), 'TES1T02');
  golden('só chassi: recua para o id', formatTaskIdentifier(SO_CHASSI as any), '#000003');
  golden('sem nada: recua para o id', formatTaskIdentifier(SEM_NADA as any), '#000004');
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Vários veículos: lista, colapso e faixa de séries
// ═══════════════════════════════════════════════════════════════════════════
async function variosVeiculos(): Promise<void> {
  const frota = [COM_SERIE, SO_PLACA, SO_CHASSI, SEM_NADA];

  console.log('\n7. NFS-e conjunta de quatro (tipos diferentes vão na linha)');
  golden('lista veículo a veículo; o sem identidade some', await nfseDiscriminacao(frota), [
    'Pedido: 4000000 - Orçamento nº 990',
    'Serviços: Logomarca Lateral',
    'Veículos (3):',
    '1) Toco Isotérmico - Série 78000 - Placa TES1T01 - Chassi 9BM979026CS006620',
    '2) Truck Prancha/Plataforma - Placa TES1T02',
    '3) Bitruck Carga seca - Chassi 9BM979026CS006621',
  ].join('\n'));

  console.log('\n8. Boleto de uma fatura conjunta (Invoice.task nulo)');
  golden('contagem, tipo do primeiro e pedido', boletoLines(frota, null), [
    'Pedido: 4000000 - NF 9001',
    'Referente aos servicos em 4 veiculos Toco Isoplastic',
    'Logomarca frente',
  ]);

  console.log('\n9. Recibo de quatro veículos');
  golden('até três por extenso', await receiptVehicleRow(frota),
    'SÉRIE 78000 · PLACA TES1T01 | PLACA TES1T02');

  console.log('\n10. coverageSummary de todos');
  golden('todos os veículos', coverageSummary(cobertura(frota) as any, 4), 'Todos os 4 veículos');
  golden('dois de quatro', coverageSummary(cobertura([COM_SERIE, SO_PLACA]) as any, 4),
    'Veículos 78000, TES1T02');
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Cada palavra, em cada documento
// ═══════════════════════════════════════════════════════════════════════════
//
// As tabelas abaixo são o TEXTO DE HOJE, escrito à mão de propósito: não vêm
// da fonte de rótulos, porque é justamente a fonte que elas conferem.

const CATEGORIAS: Record<string, string> = {
  MINI: 'Mini',
  VUC: 'VUC',
  THREE_QUARTER: '3/4',
  RIGID: 'Toco',
  TRUCK: 'Truck',
  SEMI_TRAILER: 'Semirreboque',
  SEMI_TRAILER_2_AXLES: 'Semirreboque 2 Eixos',
  B_DOUBLE_FRONT: 'Bitrem Composição Dianteira',
  B_DOUBLE_REAR: 'Bitrem Composição Traseira',
  BITRUCK: 'Bitruck',
};
/** NFS-e da tarefa (Elotech). */
const IMPLEMENTOS_NFSE_TAREFA: Record<string, string> = {
  DRY_CARGO: 'Carga seca',
  REFRIGERATED: 'Refrigerado',
  INSULATED: 'Isotérmico',
  CURTAIN_SIDE: 'Sider',
  TANK: 'Tanque',
  FLATBED: 'Prancha/Plataforma',
};
/** Boleto, fatura e NFS-e do aerografista. */
const IMPLEMENTOS_BOLETO_E_PINTOR: Record<string, string> = {
  DRY_CARGO: 'Carga Seca',
  REFRIGERATED: 'Refrigerado',
  INSULATED: 'Isoplastic',
  CURTAIN_SIDE: 'Sider',
  TANK: 'Tanque',
  FLATBED: 'Carroceria',
};

const umTipo = (category: string | null, implementType: string | null): TaskRow => ({
  ...COM_SERIE,
  customerOrderNumber: null,
  truck: { plate: null, chassisNumber: null, category, implementType },
});

async function cadaPalavra(): Promise<void> {
  console.log('\n11. Cada categoria e cada implemento, documento a documento');
  const casos: Array<[string, string | null, string | null, string]> = [
    ...Object.keys(CATEGORIAS).map(c => [`categoria ${c}`, c, null, ''] as [string, string, null, string]),
    ...Object.keys(IMPLEMENTOS_NFSE_TAREFA).map(
      i => [`implemento ${i}`, null, i, ''] as [string, null, string, string],
    ),
  ];
  for (const [nome, category, implementType] of casos) {
    const row = umTipo(category, implementType);
    const tipoTarefa = category ? CATEGORIAS[category] : IMPLEMENTOS_NFSE_TAREFA[implementType!];
    const tipoBoleto = category ? CATEGORIAS[category] : IMPLEMENTOS_BOLETO_E_PINTOR[implementType!];

    const nfse = (await nfseDiscriminacao([row])).split('\n')[0];
    const boleto = boletoLines([row], row)[1];
    const dps = dpsDescription(row);
    check(
      `${nome}: NFS-e da tarefa diz "${tipoTarefa}"`,
      nfse === `Referente aos serviços executados no veículo ${tipoTarefa} de n série: 78000.`,
      nfse,
    );
    check(
      `${nome}: boleto e fatura dizem "${tipoBoleto}"`,
      boleto === `Referente aos servicos no veiculo ${tipoBoleto}`,
      boleto,
    );
    check(
      `${nome}: NFS-e do aerografista diz "${tipoBoleto}"`,
      dps.includes(`no veículo ${tipoBoleto} de n série: 78000.`),
      dps,
    );
  }

  console.log('\n12. Valor fora do enum passa CRU (nunca some da nota)');
  const cru = umTipo('CATEGORIA_NOVA', 'IMPLEMENTO_NOVO');
  golden('NFS-e da tarefa', (await nfseDiscriminacao([cru])).split('\n')[0],
    'Referente aos serviços executados no veículo CATEGORIA_NOVA IMPLEMENTO_NOVO de n série: 78000.');
  golden('boleto', boletoLines([cru], cru)[1],
    'Referente aos servicos no veiculo CATEGORIA_NOVA IMPLEMENTO_NOVO');
  check('NFS-e do aerografista', dpsDescription(cru).includes('no veículo CATEGORIA_NOVA IMPLEMENTO_NOVO de'),
    dpsDescription(cru));
}

// ═══════════════════════════════════════════════════════════════════════════
// 3b. O documento do ORÇAMENTO ASSINADO (quote-text → quote-html.builder)
// ═══════════════════════════════════════════════════════════════════════════
//
// O hash das assinaturas (G11) NÃO protege estas palavras: o snapshot guarda o
// VALOR do enum (`categoryLabel: t.truck?.category`), e o rótulo só entra na
// hora de montar o HTML. Mudar uma palavra do perfil de tela mudava o
// documento que o cliente assina sem reprovar nada (R-B-08). O texto de hoje
// fica aqui, escrito por extenso.
const TIPOS_DOCUMENTO_ASSINADO: Record<string, string> = {
  DRY_CARGO: 'Carga Seca',
  REFRIGERATED: 'Refrigerado',
  INSULATED: 'Isoplastic',
  CURTAIN_SIDE: 'Sider',
  TANK: 'Tanque',
  FLATBED: 'Carroceria',
};

async function documentoAssinado(): Promise<void> {
  console.log('\n12b. Documento do orçamento assinado: cada categoria e cada implemento');
  for (const [valor, palavra] of Object.entries(CATEGORIAS)) {
    golden(`categoria ${valor} no documento assinado`, truckCategoryLabel(valor), palavra);
  }
  for (const [valor, palavra] of Object.entries(TIPOS_DOCUMENTO_ASSINADO)) {
    golden(`implemento ${valor} no documento assinado`, implementTypeLabel(valor), palavra);
  }
  check(
    'o documento assinado cobre todo valor dos dois enums',
    Object.values(TRUCK_CATEGORY).every(v => v in CATEGORIAS) &&
      Object.values(IMPLEMENT_TYPE).every(v => v in TIPOS_DOCUMENTO_ASSINADO),
  );
  golden('valor fora do enum passa cru no documento assinado', truckCategoryLabel('NOVA'), 'NOVA');
  golden('rótulo já resolvido passa como veio', implementTypeLabel('Baú'), 'Baú');
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. O DTO que os scripts montam à mão
// ═══════════════════════════════════════════════════════════════════════════
async function dtoDosScripts(): Promise<void> {
  console.log('\n13. emitNfse({ task: { id, name, serialNumber } }) — scripts de homologação');
  // A forma EXATA de `src/scripts/test-nfse-tomador-contact.ts` e
  // `test-nfse-cancel-roundtrip.ts`: sem truck, sem vehicles, com description.
  const dto: MunicipalEmitNfseInput = {
    id: 'invoice-script',
    totalAmount: 2,
    customer: { name: 'TESTE', cnpj: '12345678000199' },
    task: { id: 'test-tomador', name: 'TESTE INTEGRACAO', serialNumber: 'TEST-TOMADOR' },
    services: [{ description: 'Servico de teste de integracao', amount: 2 }],
    description: 'TESTE de integracao - dados do tomador. Valor simbolico R$ 2,00.',
  };
  golden('a série do DTO chega à nota', discriminacaoOf(await elotech.buildPayload(dto)), [
    'Referente aos serviços executados no veículo n série: TEST-TOMADOR.',
    'TESTE de integracao - dados do tomador. Valor simbolico R$ 2,00.',
  ].join('\n'));

  const semSerie: MunicipalEmitNfseInput = {
    ...dto,
    task: { id: 'test-tomador', name: 'TESTE INTEGRACAO' },
    services: [],
    description: undefined,
  };
  golden('sem série e sem serviço: "Serviço ref. OS <nome>"',
    discriminacaoOf(await elotech.buildPayload(semSerie)), 'Serviço ref. OS TESTE INTEGRACAO');
}

(async () => {
  await umVeiculo();
  await variosVeiculos();
  await cadaPalavra();
  await documentoAssinado();
  await dtoDosScripts();
  console.log(
    failures === 0
      ? `\n✅ rótulos fiscais de ouro: ${passes} verificações, texto de hoje intacto\n`
      : `\n❌ ${failures} verificação(ões) falharam (${passes} passaram)\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
