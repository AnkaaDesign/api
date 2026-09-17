/**
 * P0 · ESTANCAMENTO — os conceitos que passaram a ter nome.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────
 * Dois enganos do mesmo tipo: um campo respondia a uma pergunta que ele não
 * sabia responder, e ninguém percebia porque a resposta errada era plausível.
 *
 *   1. `BudgetPayer.invoice` — o `schema.prisma` dizia to-one, o
 *      banco sempre permitiu 1:N (a viva MAIS as canceladas dos ciclos
 *      anteriores). Qual linha o Prisma devolvia não era escolha de ninguém, e a
 *      leitura que decide se uma fatia está CONGELADA dependia disso.
 *
 *   2. `Invoice.taskId` — três avisos montavam o link do faturamento com ele.
 *      Ele é preenchido só quando a cobertura tem UM veículo, então toda fatura
 *      conjunta e todo lote mandavam o financeiro para `/detalhes/null`.
 *
 * Os dois agora são funções com nome, e é isso que se verifica aqui. Sem banco e
 * sem rede: o que se testa é a REGRA, não a consulta.
 */

import { liveInvoiceOf, hasLiveInvoice } from '../src/utils/billing-invoice';
import { billingDeepLinkForInvoice } from '../src/utils/billing-links';
import { planCoverage } from '../src/utils/quote-money';
import { deleteInstallmentsWithSlips } from '../src/utils/billing-teardown';

let failures = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const CANCELADA = { id: 'inv-ciclo-1', status: 'CANCELLED' };
const VIVA = { id: 'inv-ciclo-2', status: 'ACTIVE' };

async function main() {
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nA fatura VIVA de uma fatia');
  {
    check('entre uma cancelada e uma viva, devolve a viva',
      liveInvoiceOf({ invoices: [CANCELADA, VIVA] })?.id === 'inv-ciclo-2');
    check('a ORDEM não importa — o ciclo cancelado pode vir depois',
      liveInvoiceOf({ invoices: [VIVA, CANCELADA] })?.id === 'inv-ciclo-2');
    check('só canceladas ⇒ nenhuma viva',
      liveInvoiceOf({ invoices: [CANCELADA, { id: 'x', status: 'CANCELLED' }] }) === null);
    check('lista vazia ⇒ null', liveInvoiceOf({ invoices: [] }) === null);
    check('fatia ausente ⇒ null', liveInvoiceOf(null) === null);
    check('ainda entende a forma antiga (`invoice` to-one) viva',
      liveInvoiceOf({ invoice: VIVA })?.id === 'inv-ciclo-2');
    check('e a forma antiga CANCELADA não conta como viva',
      liveInvoiceOf({ invoice: CANCELADA }) === null);
    check('`hasLiveInvoice` é o mesmo critério, em booleano',
      hasLiveInvoice({ invoices: [CANCELADA, VIVA] }) === true &&
        hasLiveInvoice({ invoices: [CANCELADA] }) === false);
  }

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nO link do faturamento nunca aponta para `null`');

  // Banco de mentira: só o que o resolvedor lê.
  const fakePrisma = (invoice: any, tasksOfQuote: string[]) => ({
    invoice: { findUnique: async () => invoice },
    task: {
      findFirst: async ({ where }: any) => {
        const pool: string[] = where.id?.in ?? tasksOfQuote;
        // A ordem canônica é `createdAt asc, id asc`; no fake, a ordem da lista
        // JÁ é a canônica, então a âncora é o primeiro que sobrevive ao filtro.
        const ordered = tasksOfQuote.filter(t => pool.includes(t));
        return ordered.length ? { id: ordered[0] } : null;
      },
    },
  });

  {
    // 1. fatia de um veículo só — `Invoice.taskId` preenchido
    const link = await billingDeepLinkForInvoice(
      fakePrisma({ taskId: 'v2', customerConfig: { quoteId: 'q', billing: { tasks: [{ taskId: 'v2' }] } } },
        ['v1', 'v2', 'v3', 'v4']) as any, 'inv');
    check('fatia de um veículo aponta para ele', link.web.endsWith('/v2'), link.web);

    // 2. JOINT de quatro — `taskId` NULO, é aqui que dava `/detalhes/null`
    const joint = await billingDeepLinkForInvoice(
      fakePrisma({ taskId: null, customerConfig: { quoteId: 'q', billing: { tasks: [
        { taskId: 'v1' }, { taskId: 'v2' }, { taskId: 'v3' }, { taskId: 'v4' }] } } },
        ['v1', 'v2', 'v3', 'v4']) as any, 'inv');
    check('fatura conjunta cai na âncora da COBERTURA, não em null',
      joint.web.endsWith('/v1'), joint.web);

    // 3. lote 3+4 — a âncora é o primeiro DO LOTE, não o primeiro do orçamento
    const lote = await billingDeepLinkForInvoice(
      fakePrisma({ taskId: null, customerConfig: { quoteId: 'q', billing: { tasks: [
        { taskId: 'v4' }, { taskId: 'v3' }] } } },
        ['v1', 'v2', 'v3', 'v4']) as any, 'inv');
    check('lote aponta para o primeiro veículo DO LOTE', lote.web.endsWith('/v3'), lote.web);

    // 4. fatia sem cobertura — sobra o orçamento
    const semCobertura = await billingDeepLinkForInvoice(
      fakePrisma({ taskId: null, customerConfig: { quoteId: 'q', billing: { tasks: [] } } },
        ['v1', 'v2']) as any, 'inv');
    check('fatia sem cobertura cai na âncora do ORÇAMENTO',
      semCobertura.web.endsWith('/v1'), semCobertura.web);

    // 5. nada — a lista, nunca uma tela morta
    const nada = await billingDeepLinkForInvoice(
      fakePrisma({ taskId: null, customerConfig: null }, []) as any, 'inv');
    check('sem nenhum elo, cai na LISTA e não em /detalhes/null',
      nada.web === '/financeiro/faturamento' && !nada.web.includes('null'), nada.web);

    // 6. o banco explode — o aviso não pode cair junto
    const quebrado = await billingDeepLinkForInvoice(
      { invoice: { findUnique: async () => { throw new Error('banco fora'); } }, task: {} } as any, 'inv');
    check('erro de banco não derruba o aviso', quebrado.web === '/financeiro/faturamento');
  }

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nOs cinco arranjos que o dono pediu, e as trocas entre eles');
  {
    const V = ['v1', 'v2', 'v3', 'v4'];
    const key = (g: string[][]) => g.map(x => x.join('+')).join(' | ');

    // 1. orçamento simples
    check('um veículo ⇒ um faturamento', key(planCoverage('JOINT', ['v1'])) === 'v1');

    // 2. multitarefa, faturamento ÚNICO
    check('quatro veículos, fatura única ⇒ um grupo de quatro',
      key(planCoverage('JOINT', V)) === 'v1+v2+v3+v4');

    // 3. multitarefa, MÚLTIPLOS faturamentos
    check('quatro veículos, um por veículo ⇒ quatro grupos de um',
      key(planCoverage('PER_TASK', V)) === 'v1 | v2 | v3 | v4');
    check('quatro veículos em lotes 2+2',
      key(planCoverage('CUSTOM', V, [['v1', 'v2'], ['v3', 'v4']])) === 'v1+v2 | v3+v4');
    check('lote desigual 1+3',
      key(planCoverage('CUSTOM', V, [['v1'], ['v2', 'v3', 'v4']])) === 'v1 | v2+v3+v4');

    // 4. a TROCA, nos dois sentidos, sobre o arranjo que já existe
    const unico = planCoverage('JOINT', V);
    check('único → por veículo', key(planCoverage('PER_TASK', V, unico)) === 'v1 | v2 | v3 | v4');
    const porVeiculo = planCoverage('PER_TASK', V);
    check('por veículo → único', key(planCoverage('JOINT', V, porVeiculo)) === 'v1+v2+v3+v4');
    const lotes = planCoverage('CUSTOM', V, [['v1', 'v2'], ['v3', 'v4']]);
    check('lotes → único', key(planCoverage('JOINT', V, lotes)) === 'v1+v2+v3+v4');
    check('lotes → por veículo', key(planCoverage('PER_TASK', V, lotes)) === 'v1 | v2 | v3 | v4');
    check('único → lotes', key(planCoverage('CUSTOM', V, [['v1', 'v2'], ['v3', 'v4']])) === 'v1+v2 | v3+v4');

    // e a ida e volta tem de fechar no ponto de partida
    const ida = planCoverage('PER_TASK', V, unico);
    const volta = planCoverage('JOINT', V, ida);
    check('ida e volta devolvem o arranjo original', key(volta) === key(unico), key(volta));

    // 5. um veículo acrescentado depois não pode sumir de todo faturamento
    const V5 = [...V, 'v5'];
    const comNovo = planCoverage('CUSTOM', V5, lotes);
    const cobertos = comNovo.flat();
    check('veículo novo entra num grupo — nenhum fica sem cobrança',
      cobertos.length === 5 && new Set(cobertos).size === 5, key(comNovo));
    check('e ele é ISOLADO, não enfiado num lote já combinado',
      comNovo.some(g => g.length === 1 && g[0] === 'v5'), key(comNovo));

    // partição: todo veículo coberto exatamente uma vez, em todo arranjo
    for (const [nome, grupos] of [
      ['único', planCoverage('JOINT', V)],
      ['por veículo', planCoverage('PER_TASK', V)],
      ['lotes', lotes],
    ] as [string, string[][]][]) {
      const flat = grupos.flat();
      check(`${nome}: partição exata dos quatro veículos`,
        flat.length === 4 && new Set(flat).size === 4, key(grupos));
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nDesmontar faturamento apaga o boleto ANTES da parcela');
  {
    // As três FKs de dinheiro deixaram de ser `Cascade`. O preço dessa escolha —
    // e foi uma escolha: o banco não apaga mais parcela PAGA por efeito colateral
    // — é que quem desmonta precisa dizer a ordem. Esquecer o boleto não dá um
    // erro compreensível: dá `P2003 BankSlip_installmentId_fkey`, 400, no meio de
    // uma reversão de faturamento. Foi exatamente o que aconteceu, e é o que este
    // caso impede de voltar.
    const chamadas: string[] = [];
    const parcelas = [{ id: 'p1' }, { id: 'p2' }];
    const tx = {
      installment: {
        findMany: async () => { chamadas.push('installment.findMany'); return parcelas; },
        deleteMany: async ({ where }: any) => {
          chamadas.push('installment.deleteMany');
          return { count: (where.id?.in ?? []).length };
        },
      },
      bankSlip: {
        deleteMany: async ({ where }: any) => {
          chamadas.push('bankSlip.deleteMany');
          // O filtro tem de ser por ID, não relacional: depois do delete da
          // parcela a relação já não existe para filtrar.
          if (!Array.isArray(where?.installmentId?.in)) throw new Error('filtro relacional');
          return { count: 1 };
        },
      },
    };
    const r = await deleteInstallmentsWithSlips(tx as any, { invoiceId: { in: ['i1'] } });
    check('o boleto é apagado ANTES da parcela',
      chamadas.indexOf('bankSlip.deleteMany') < chamadas.indexOf('installment.deleteMany'),
      chamadas.join(' → '));
    check('os ids são lidos antes de qualquer delete',
      chamadas[0] === 'installment.findMany', chamadas.join(' → '));
    check('devolve a contagem do que apagou', r.installments === 2 && r.slips === 1, JSON.stringify(r));

    // Sem parcela nenhuma, não toca em nada — o caminho mais comum.
    const vazio: string[] = [];
    const txVazio = {
      installment: { findMany: async () => { vazio.push('find'); return []; },
                     deleteMany: async () => { vazio.push('del'); return { count: 0 }; } },
      bankSlip: { deleteMany: async () => { vazio.push('slip'); return { count: 0 }; } },
    };
    const r2 = await deleteInstallmentsWithSlips(txVazio as any, {});
    check('sem parcela, nenhum delete é emitido',
      vazio.join(',') === 'find' && r2.installments === 0, vazio.join(','));
  }

  if (failures > 0) {
    console.log(`\n❌ ${failures} verificação(ões) falharam.`);
    process.exit(1);
  }
  console.log('\n✅ P0 · estancamento: todas as verificações passaram.');
}

void main();
