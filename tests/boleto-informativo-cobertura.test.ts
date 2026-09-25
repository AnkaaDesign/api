/**
 * O INFORMATIVO DO BOLETO DIZ DE QUAIS VEÍCULOS ELE É.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────
 * O boleto carrega até 5 linhas de 80 caracteres, e é por elas que o cliente
 * liga o título ao que foi entregue. Duas coisas quebravam nesse texto quando a
 * fatura cobre mais de um caminhão:
 *
 *   1. o NÚMERO DO PEDIDO saía errado. A leitura era `customerConfig.taskId` —
 *      coluna REMOVIDA em `20260913120000_billing_coverage` —, e como a condição
 *      passava por `as any` ela era sempre falsa: o boleto de um LOTE de vinte
 *      citava o pedido de compra dos SESSENTA.
 *   2. o VEÍCULO sumia. A descrição vinha de `Invoice.task`, que é NULO de
 *      propósito numa fatura conjunta (ela não é de nenhum dos caminhões) — o
 *      boleto de R$ 4.401,76 saía sem citar caminhão nenhum.
 *
 * DOIS CONSTRUTORES, O MESMO TEXTO. O registro acontece pelo caminho embutido
 * (`invoice-generation`, na aprovação) e, quando ele falha, pela varredura
 * (`sicredi-boleto.scheduler`). Os dois montam o informativo, e é justamente por
 * serem dois que podem divergir — este arquivo roda as MESMAS asserções nos
 * dois. Só o primeiro é exercitado pela bateria de tela; o segundo só aqui.
 *
 * Rodar: `npx tsx tests/boleto-informativo-cobertura.test.ts`
 */
import { InvoiceGenerationService } from '../src/modules/financial/invoice/invoice-generation.service';
import { SicrediBoletoScheduler } from '../src/modules/integrations/sicredi/sicredi-boleto.scheduler';

let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

// Os dois construtores só guardam dependências; `buildBoletoLines` lê apenas o
// argumento. Nenhum dublê aqui é chamado.
const stub: any = {};
const geracao = new InvoiceGenerationService(stub, stub, stub, stub);
const varredura = new SicrediBoletoScheduler(
  stub, stub, stub, stub, stub, { get: (_k: string, d?: any) => d } as any, stub, stub, stub,
);

/** Um veículo do orçamento, como as consultas o trazem. */
const veiculo = (serial: string, pedido: string | null) => ({
  id: `t-${serial}`,
  serialNumber: serial,
  customerOrderNumber: pedido,
  implement: { plate: `ABC${serial.slice(-4)}`, chassisNumber: null, category: 'TRUCK', type: 'REFRIGERATED' },
});

const FROTA = [
  veiculo('8101', 'PED-A'),
  veiculo('8102', 'PED-B'),
  veiculo('8103', 'PED-C'),
  veiculo('8104', 'PED-D'),
];

/**
 * A parcela como o registro do boleto a enxerga.
 *
 * `cobertos` são os veículos que a FATURA cobre; `taskDaFatura` é
 * `Invoice.task`, que só existe quando a fatura é de UM veículo.
 */
function parcela(opts: { cobertos: typeof FROTA; taskDaFatura: (typeof FROTA)[number] | null }) {
  return {
    id: 'inst-1',
    number: 1,
    amount: 1200,
    invoice: {
      task: opts.taskDaFatura,
      nfseDocuments: [{ nfseNumber: 9001 }],
      customerConfig: {
        customerId: 'cust-1',
        // A forma REAL que o Prisma devolve: a cobertura é do FATURAMENTO.
        billing: { tasks: opts.cobertos.map(t => ({ taskId: t.id })) },
        quote: {
          tasks: FROTA,
          services: [{ description: 'logomarca frente', invoiceToCustomerId: null }],
        },
      },
    },
  };
}

/** Roda as mesmas asserções nos dois construtores. */
function nosDois(titulo: string, inst: any, assert: (linhas: string[], onde: string) => void) {
  console.log(`\n${titulo}`);
  for (const [onde, alvo] of [
    ['aprovação (invoice-generation)', geracao],
    ['varredura (sicredi-boleto.scheduler)', varredura],
  ] as const) {
    const linhas: string[] = (alvo as any).buildBoletoLines(inst) ?? [];
    assert(linhas, onde);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
nosDois('UM veículo — o boleto de sempre, inalterado', parcela({ cobertos: [FROTA[0]], taskDaFatura: FROTA[0] }),
  (linhas, onde) => {
    const texto = linhas.join(' | ');
    check(`[${onde}] cita só o pedido DELE`, texto.includes('PED-A') && !texto.includes('PED-B'), texto);
    check(`[${onde}] descreve o veículo pela série`, texto.includes('N.º serie: 8101'), texto);
    check(`[${onde}] não fala em "N veiculos"`, !/\d+ veiculos/.test(texto), texto);
  });

// ═══════════════════════════════════════════════════════════════════════════
nosDois('LOTE de 2 num orçamento de 4 — o caso que citava os quatro',
  parcela({ cobertos: [FROTA[0], FROTA[1]], taskDaFatura: null }),
  (linhas, onde) => {
    const texto = linhas.join(' | ');
    check(`[${onde}] cita os pedidos dos DOIS do lote`, texto.includes('PED-A') && texto.includes('PED-B'), texto);
    check(`[${onde}] NÃO cita o pedido dos outros dois`,
      !texto.includes('PED-C') && !texto.includes('PED-D'), texto);
    check(`[${onde}] declara a contagem`, /2 veiculos/.test(texto), texto);
    check(`[${onde}] declara a faixa de séries do lote`, texto.includes('Series: 8101 a 8102'), texto);
    check(`[${onde}] não passa de 5 linhas de 80 caracteres`,
      linhas.length <= 5 && linhas.every(l => l.length <= 80),
      `${linhas.length} linhas, maior=${Math.max(...linhas.map(l => l.length))}`);
  });

// ═══════════════════════════════════════════════════════════════════════════
nosDois('FATURA CONJUNTA dos 4 — `Invoice.task` é nulo de propósito',
  parcela({ cobertos: FROTA, taskDaFatura: null }),
  (linhas, onde) => {
    const texto = linhas.join(' | ');
    check(`[${onde}] o boleto NÃO sai sem citar veículo`, /veiculos/.test(texto), texto);
    check(`[${onde}] declara os 4`, /4 veiculos/.test(texto), texto);
    check(`[${onde}] declara a faixa inteira`, texto.includes('Series: 8101 a 8104'), texto);
    check(`[${onde}] cita o pedido dos quatro`,
      ['PED-A', 'PED-B', 'PED-C', 'PED-D'].every(p => texto.includes(p)), texto);
    check(`[${onde}] leva o número da NF`, texto.includes('NF 9001'), texto);
  });

// ═══════════════════════════════════════════════════════════════════════════
nosDois('ACERVO — fatura antiga, sem linha de cobertura nenhuma',
  parcela({ cobertos: [], taskDaFatura: FROTA[2] }),
  (linhas, onde) => {
    const texto = linhas.join(' | ');
    check(`[${onde}] recua para a tarefa da fatura`, texto.includes('N.º serie: 8103'), texto);
    // O PEDIDO E O VEÍCULO TÊM DE FALAR DO MESMO CAMINHÃO. Aceitar só "contém
    // PED-C" deixava passar o boleto que nomeia o 8103 e cita os pedidos dos
    // quatro — que foi exatamente o que um dos dois construtores fazia.
    check(`[${onde}] cita o pedido DELA e só o dela`,
      texto.includes('PED-C') && !texto.includes('PED-A') && !texto.includes('PED-B') && !texto.includes('PED-D'),
      texto);
  });

console.log(
  failures === 0
    ? '\n\x1b[32mTodas as verificações passaram.\x1b[0m\n'
    : `\n\x1b[31m${failures} verificação(ões) falharam.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
