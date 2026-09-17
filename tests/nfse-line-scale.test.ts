/**
 * A LINHA DA NFS-e CARREGA OS VEÍCULOS QUE A FATURA COBRA.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────
 * `BudgetItem.amount` é o preço de UM veículo (ver `utils/quote-money.ts`),
 * e `Invoice.totalAmount` é `por veículo × cobertos`. A nota precisa fazer a
 * MESMA multiplicação: `quantidade = cobertos`, `valorUnitario` = o preço do
 * caminhão. Sem ela a nota saía pelo valor de UM enquanto o boleto cobrava os
 * sessenta — R$ 12.170,40 declarados contra R$ 730.224,00 cobrados, com o ISS
 * subdeclarado na mesma proporção.
 *
 * O defeito era silencioso porque `resolveGlobalDiscount` media
 * `linhas − fatura`: com mais de um veículo o resultado era NEGATIVO, e o ramo
 * do negativo devolve o desconto declarado sem acusar nada.
 *
 * As três propriedades verificadas aqui:
 *
 *   1. `Σ valorTotal das linhas` = `unitário × cobertos`
 *   2. `Σ valorLiquido` = `Invoice.totalAmount` — até o centavo, com desconto
 *   3. a base do ISS é esse líquido, e não a soma dos unitários
 *
 * Rodar: `npx tsx tests/nfse-line-scale.test.ts`
 */
import { ElotechOxyNfseService } from '../src/modules/integrations/nfse/elotech-oxy-nfse.service';

let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const cents = (v: number) => Math.round(v * 100);
const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ── Dublês: o construtor só lê configuração, e `buildPayload` só chama três
// métodos do serviço de autenticação. Nada aqui toca rede nem banco.
const configStub = { get: (_k: string, d?: any) => d } as any;
const prismaStub = {} as any;
const authStub = {
  baseUrl: 'http://sentinela.invalid',
  getToken: async () => 'token',
  getAuthHeaders: () => ({}),
  getContribuinteData: () => ({ id: 1, cnpjCpf: '00000000000191', razaoSocialNome: 'ANKAA (teste)', regimeFiscal: 'NORMAL' }),
  buildUfObject: (uf: string) => ({ id: { codigoPais: 32, unidadeFederacao: uf } }),
  findCity: async () => ({ id: 4110003, descricao: 'IBIPORA', codigoIBGE: 4110003 }),
} as any;

const service = new ElotechOxyNfseService(configStub, prismaStub, authStub);

/** O tomador mínimo que `buildPayload` exige. */
const CUSTOMER = {
  cnpj: '11222333000181',
  name: 'QA Alfa Transportes',
  corporateName: 'QA ALFA TRANSPORTES LTDA',
  address: {
    cityName: 'Ibiporã',
    state: 'PR',
    zipCode: '86200000',
    street: 'Rua de Teste',
    number: '100',
    neighborhood: 'Centro',
  },
};

async function payloadFor(opts: {
  services: { description: string; amount: number }[];
  quantity: number;
  totalAmount: number;
  globalDiscount?: { type: string; value: number };
}) {
  return (service as any).buildPayload({
    id: 'inv-teste',
    totalAmount: opts.totalAmount,
    customer: CUSTOMER,
    task: { id: 't1', name: 'Logomarca', serialNumber: '8101' },
    vehicles: Array.from({ length: opts.quantity }, (_, i) => ({
      serialNumber: String(8101 + i),
      plate: null,
      chassisNumber: null,
      category: 'TRUCK',
      implementType: 'REFRIGERATED',
    })),
    budgetNumber: 594,
    orderNumber: 'PED-1',
    services: opts.services,
    serviceQuantity: opts.quantity,
    globalDiscount: opts.globalDiscount,
  }) as Promise<Record<string, any>>;
}

/** Soma os itens do payload como a prefeitura somaria. */
function totals(payload: Record<string, any>) {
  const itens: any[] = payload.formItensNFSe ?? [];
  return {
    itens,
    bruto: itens.reduce((s, i) => s + Number(i.valorTotal ?? 0), 0),
    desconto: itens.reduce((s, i) => s + Number(i.valorDesconto ?? 0), 0),
    liquido: itens.reduce((s, i) => s + Number(i.valorLiquido ?? 0), 0),
    baseIss: Number(payload.formTotal?.baseCalculoIss ?? -1),
    totalNfse: Number(payload.formTotal?.totalNfse ?? -1),
    discriminacao: String(payload.formDadosNFSe?.discriminacaoServico ?? ''),
  };
}

async function main() {
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\nUM veículo — a nota de sempre, byte a byte igual');
  // ══════════════════════════════════════════════════════════════════════════
  {
    const p = await payloadFor({
      services: [{ description: 'Logomarca Frente', amount: 1200 }],
      quantity: 1,
      totalAmount: 1200,
    });
    const t = totals(p);
    check('quantidade = 1', t.itens.every(i => i.quantidade === 1), JSON.stringify(t.itens.map(i => i.quantidade)));
    check('valorUnitario = o preço do serviço', cents(t.itens[0].valorUnitario) === cents(1200));
    check('o líquido é o da fatura', cents(t.liquido) === cents(1200), money(t.liquido));
    check('a base do ISS é o líquido', cents(t.baseIss) === cents(1200), money(t.baseIss));
  }

  // ══════════════════════════════════════════════════════════════════════════
  console.log('\nDOIS veículos, sem desconto — o caso que saía pela metade');
  // ══════════════════════════════════════════════════════════════════════════
  {
    const p = await payloadFor({
      services: [{ description: 'Logomarca Frente', amount: 1200 }],
      quantity: 2,
      totalAmount: 2400,
    });
    const t = totals(p);
    check('quantidade = 2 em cada linha', t.itens.every(i => i.quantidade === 2));
    check('valorUnitario continua o preço de UM veículo', cents(t.itens[0].valorUnitario) === cents(1200));
    check('valorTotal da linha = unitário × 2', cents(t.itens[0].valorTotal) === cents(2400));
    check('o líquido é o da fatura (R$ 2.400,00)', cents(t.liquido) === cents(2400), money(t.liquido));
    check('totalNfse é o bruto escalado', cents(t.totalNfse) === cents(2400), money(t.totalNfse));
    check('a base do ISS é R$ 2.400,00', cents(t.baseIss) === cents(2400), money(t.baseIss));
  }

  // ══════════════════════════════════════════════════════════════════════════
  console.log('\nSESSENTA veículos com 12% — o Marquespan, com o desconto pelo GAP');
  // ══════════════════════════════════════════════════════════════════════════
  {
    // 13.830,00 por veículo, 12% ⇒ 12.170,40 cada ⇒ 730.224,00 de contrato.
    // O desconto que a emissão resolve é o GAP: 13.830×60 − 730.224 = 99.576,00.
    const p = await payloadFor({
      services: [
        { description: 'Pintura completa', amount: 4545 },
        { description: 'Logomarca', amount: 1285 },
        { description: 'Faixa lateral', amount: 8000 },
      ],
      quantity: 60,
      totalAmount: 730224,
      globalDiscount: { type: 'FIXED_VALUE', value: 99576 },
    });
    const t = totals(p);
    check('quantidade = 60 em todas as linhas', t.itens.every(i => i.quantidade === 60));
    check('o bruto é 13.830 × 60', cents(t.bruto) === cents(829800), money(t.bruto));
    check('o desconto reparte exatamente o gap', cents(t.desconto) === cents(99576), money(t.desconto));
    check(
      'o líquido fecha com a fatura, ao centavo (R$ 730.224,00)',
      cents(t.liquido) === cents(730224),
      money(t.liquido),
    );
    check('a base do ISS é o líquido', cents(t.baseIss) === cents(730224), money(t.baseIss));
    check(
      'a discriminação declara 60 veículos e a faixa de séries',
      /60 ve.culos/i.test(t.discriminacao) && t.discriminacao.includes('8101'),
      t.discriminacao.replace(/\n/g, ' ⏎ '),
    );
    check(
      'a discriminação cabe no teto de 11 linhas',
      t.discriminacao.split('\n').length <= 11,
      `${t.discriminacao.split('\n').length} linhas`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  console.log('\nCENTAVOS que não dividem — o desconto reparte por maior resto');
  // ══════════════════════════════════════════════════════════════════════════
  {
    // 3 serviços de 333,33 ⇒ 999,99 por veículo × 7 = 6.999,93.
    // 10% de desconto ⇒ 699,99 ⇒ fatura de 6.299,94.
    const p = await payloadFor({
      services: [
        { description: 'A', amount: 333.33 },
        { description: 'B', amount: 333.33 },
        { description: 'C', amount: 333.33 },
      ],
      quantity: 7,
      totalAmount: 6299.94,
      globalDiscount: { type: 'FIXED_VALUE', value: 699.99 },
    });
    const t = totals(p);
    check('o bruto é 999,99 × 7', cents(t.bruto) === cents(6999.93), money(t.bruto));
    check('o desconto soma exatamente 699,99', cents(t.desconto) === cents(699.99), money(t.desconto));
    check('o líquido fecha com a fatura', cents(t.liquido) === cents(6299.94), money(t.liquido));
  }

  // ══════════════════════════════════════════════════════════════════════════
  console.log('\nA TRAVA: a nota nunca sai abaixo do que o boleto cobra');
  // ══════════════════════════════════════════════════════════════════════════
  {
    // O defeito, reproduzido: fatura de dois veículos com linhas de um só.
    // `serviceQuantity` ausente ⇒ 1 ⇒ o líquido daria R$ 1.200,00 contra uma
    // fatura de R$ 2.400,00. A emissão tem de RECUSAR, não subdeclarar.
    let recusou = false;
    let mensagem = '';
    try {
      await (service as any).buildPayload({
        id: 'inv-torto',
        totalAmount: 2400,
        customer: CUSTOMER,
        task: { id: 't1', name: 'Logomarca', serialNumber: '8101' },
        budgetNumber: 594,
        services: [{ description: 'Logomarca Frente', amount: 1200 }],
      });
    } catch (err: any) {
      recusou = true;
      mensagem = String(err?.message ?? err);
    }
    check('a emissão é recusada quando o líquido ficaria abaixo da fatura', recusou, mensagem);
    check(
      'a recusa diz os dois valores e quantos veículos a fatura cobre',
      /1\.200,00/.test(mensagem) && /2\.400,00/.test(mensagem),
      mensagem,
    );
  }

  console.log(
    failures === 0
      ? '\n\x1b[32mTodas as verificações passaram.\x1b[0m\n'
      : `\n\x1b[31m${failures} verificação(ões) falharam.\x1b[0m\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
