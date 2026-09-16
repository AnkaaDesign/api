/**
 * A FATIA DE UM VEÍCULO — e a fatia de faturamento que a nomeia.
 *
 * O DEFEITO QUE ESTE ARQUIVO IMPEDE
 * ─────────────────────────────────────────────────────────────────────────────
 * Desde o orçamento multitarefa, `TaskQuote.total` é o valor do CONTRATO:
 * `preço por veículo × N`. Mas quase toda tela lê o orçamento pelo lado da
 * TAREFA — a lista de Orçamentos, a de Faturamento, a Preparação, o Histórico,
 * a receita do painel — e cada linha ali é UM veículo. Lendo `quote.total`
 * direto, o Marquespan de sessenta caminhões afirmava R$ 730.224,00 em cada uma
 * das sessenta linhas, e o painel, que soma linha a linha, chegava a
 * R$ 43.813.440,00 de receita.
 *
 * A correção é dividir: `perVehicleAmount(total, vehicleCount)`. O que este
 * arquivo protege é a propriedade que a torna segura — **a soma das N fatias
 * reconstrói o contrato**. É isso que permite trocar a leitura em dezenas de
 * agregações sem que nenhuma delas precise saber que multitarefa existe.
 *
 * E `sliceTask`: com `billingSplit = PER_TASK` há uma fatia de faturamento POR
 * VEÍCULO, cada uma com sua fatura, suas parcelas e sua NFS-e. Responder a
 * "de qual tarefa é esta parcela?" com a primeira do orçamento manda o
 * conferente para o caminhão errado — com o número de série, a placa e o valor
 * de outro veículo na tela.
 */

import {
  coveredTaskCount,
  coversTask,
  orderNumberLabel,
  orderNumbersOfTasks,
  perVehicleAmount,
  sliceAnchorTaskId,
  sliceTask,
  withCoverageInclude,
} from '../src/utils/quote-tasks';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\nA fatia de um veículo reconstrói o contrato');
{
  // Marquespan, orçamentos 642–701 de 02/09: sessenta caminhões,
  // R$ 12.170,40 cada (12% de desconto sobre R$ 13.830,00), R$ 730.224,00.
  const GRAND = 730224;
  const N = 60;
  const share = perVehicleAmount(GRAND, N);
  check(
    'sessenta caminhões: a linha mostra R$ 12.170,40, não R$ 730.224,00',
    share === 12170.4,
    String(share),
  );
  check(
    'a soma das sessenta fatias é o contrato (é isto que mantém todo agregado correto)',
    Math.round(share * N * 100) / 100 === GRAND,
    String(Math.round(share * N * 100) / 100),
  );
}

console.log('\nO caso de um veículo é byte a byte o comportamento anterior');
{
  check('vehicleCount = 1 devolve o total', perVehicleAmount(12170.4, 1) === 12170.4);
  check(
    'vehicleCount ausente devolve o total (orçamento lido de uma consulta antiga)',
    perVehicleAmount(12170.4, null) === 12170.4,
  );
  check(
    'vehicleCount = 0 devolve o total, não uma divisão por zero',
    perVehicleAmount(12170.4, 0) === 12170.4,
  );
  check('Decimal do Prisma chega como string e é aceito', perVehicleAmount('730224.00', 60) === 12170.4);
  check('total nulo é zero, não NaN', perVehicleAmount(null, 60) === 0);
  check('total inválido é zero, não NaN', perVehicleAmount('abc', 3) === 0);
}

console.log('\nArredondamento: a fatia é dinheiro, não fração');
{
  // 100 / 3 não fecha: a fatia é arredondada ao centavo, e a soma pode diferir
  // do contrato em centavos. Documentado de propósito — o documento imprime
  // `por veículo × N`, e é essa a conta que a fatura e o boleto fazem.
  const share = perVehicleAmount(100, 3);
  check('a fatia é arredondada ao centavo', share === 33.33, String(share));
  check(
    'a diferença de arredondamento fica em centavos e não cresce',
    Math.abs(share * 3 - 100) < 0.05,
    String(share * 3),
  );
}

console.log('\n`sliceTask`: a parcela do caminhão 37 abre o caminhão 37');
{
  const tasks = [
    { id: 'truck-1', name: 'Caminhão 1' },
    { id: 'truck-37', name: 'Caminhão 37' },
  ];
  const cov = (...ids: string[]) => ids.map(taskId => ({ taskId }));
  check(
    'fatura de um veículo devolve a tarefa DELA',
    sliceTask({ tasks: cov('truck-37'), quote: { tasks } })?.id === 'truck-37',
  );
  check(
    'fatura conjunta ancora no primeiro veículo — qualquer um serve para o link',
    sliceTask({ tasks: cov('truck-1', 'truck-37'), quote: { tasks } })?.id === 'truck-1',
  );
  check(
    'a âncora segue a ordem do ORÇAMENTO, não a ordem em que a cobertura veio',
    sliceTask({ tasks: cov('truck-37', 'truck-1'), quote: { tasks } })?.id === 'truck-1',
  );
  check(
    'cobertura que a consulta não trouxe cai no primeiro, nunca em nulo',
    sliceTask({ tasks: [], quote: { tasks } })?.id === 'truck-1',
  );
  check(
    'cobertura de uma tarefa fora da consulta cai no primeiro',
    sliceTask({ tasks: cov('truck-99'), quote: { tasks } })?.id === 'truck-1',
  );
  check(
    'orçamento sem tarefa nenhuma devolve nulo',
    sliceTask({ tasks: [], quote: { tasks: [] } }) === null,
  );
  check('configuração ausente devolve nulo', sliceTask(null) === null);
  check('configuração sem orçamento devolve nulo', sliceTask({ tasks: cov('x') }) === null);
}

console.log('\n`sliceAnchorTaskId`: o `Invoice.taskId` só existe quando a fatura é de UM');
{
  const cov = (...ids: string[]) => ids.map(taskId => ({ taskId }));
  check(
    'fatura de um veículo carimba o veículo — inclusive no orçamento de UMA tarefa, que é o acervo inteiro',
    sliceAnchorTaskId({ tasks: cov('truck-1') }) === 'truck-1',
  );
  check(
    'fatura de um lote não é de nenhum veículo: nulo',
    sliceAnchorTaskId({ tasks: cov('truck-1', 'truck-2') }) === null,
  );
  check('sem cobertura, nulo', sliceAnchorTaskId({ tasks: [] }) === null);
}

console.log('\nA cobertura: quantos veículos esta fatura cobra');
{
  const cov = (...ids: string[]) => ids.map(taskId => ({ taskId }));
  const lote = { tasks: cov('t1', 't2', 't3') };
  check('conta os veículos cobertos', coveredTaskCount(lote) === 3);
  check('responde se cobra um veículo', coversTask(lote, 't2'));
  check('e se NÃO cobra', !coversTask(lote, 't9'));
  check('taskId nulo nunca é coberto', !coversTask(lote, null));
  check('sem cobertura, zero', coveredTaskCount({ tasks: [] }) === 0);
  check('relação ausente, zero', coveredTaskCount({}) === 0);
}

console.log('\nO número do pedido é do VEÍCULO');
{
  const tasks = [
    { customerOrderNumber: '16677' },
    { customerOrderNumber: '16677' },
    { customerOrderNumber: ' 16680 ' },
    { customerOrderNumber: null },
    { customerOrderNumber: '' },
  ];
  check(
    'deduplica e apara: dois veículos no mesmo pedido contam uma vez',
    JSON.stringify(orderNumbersOfTasks(tasks)) === JSON.stringify(['16677', '16680']),
    JSON.stringify(orderNumbersOfTasks(tasks)),
  );
  check(
    'um pedido só (o caso comum, mesmo com sessenta caminhões) sai limpo',
    orderNumberLabel([{ customerOrderNumber: '16677' }, { customerOrderNumber: '16677' }]) ===
      '16677',
  );
  check(
    'pedidos diferentes na nota conjunta são listados — omiti-los faria a nota não bater com nenhum',
    orderNumberLabel(tasks) === '16677, 16680',
    String(orderNumberLabel(tasks)),
  );
  check('nenhum veículo com pedido devolve nulo', orderNumberLabel([{ customerOrderNumber: null }]) === null);
  check('sem tarefa nenhuma devolve nulo', orderNumberLabel([]) === null);

  // O campo da discriminação da NFS-e e a linha do boleto têm tamanho fixo.
  const muitos = Array.from({ length: 30 }, (_, i) => ({ customerOrderNumber: `PED${1000 + i}` }));
  const aparado = orderNumberLabel(muitos, 40);
  check(
    'com limite, a linha cabe e diz quantos ficaram de fora',
    aparado !== null && aparado.length <= 40 && aparado.includes('(+'),
    String(aparado),
  );
  check(
    'sem limite, todos entram',
    (orderNumberLabel(muitos) ?? '').split(', ').length === 30,
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// O PEDIDO DE UM CLIENTE ANTIGO NÃO PODE DERRUBAR A TELA
//
// `coveredTasks` e `billingApprovedAt` saíram de `TaskQuoteCustomerConfig`
// quando a cobertura e o estado passaram para o `Billing`. Quem ainda os pede
// não recebe uma coluna a menos: recebe 500, porque o Prisma recusa a consulta
// INTEIRA com "Unknown field ... for select statement".
//
// Aconteceu em produção: um `select` esquecido na lista de faturamento derrubou
// a TELA TODA — não uma coluna, a tela. E clientes velhos não somem no deploy:
// um bundle em cache, uma aba de ontem, o app da loja, um favorito.
// ═══════════════════════════════════════════════════════════════════════════
{
  console.log('\nChaves aposentadas do pagador');
  const antigo: any = withCoverageInclude({
    select: { id: true, customerId: true, billingApprovedAt: true, coveredTasks: true },
  });
  check('o `select` de um cliente antigo perde `billingApprovedAt`',
    !('billingApprovedAt' in antigo.select), JSON.stringify(Object.keys(antigo.select)));
  check('e perde `coveredTasks`',
    !('coveredTasks' in antigo.select), JSON.stringify(Object.keys(antigo.select)));
  check('sem perder o que ele de fato pediu',
    antigo.select.id === true && antigo.select.customerId === true);
  check('e o FATURAMENTO vem no lugar, com o estado dentro',
    !!antigo.select.billing?.select?.approvedAt && !!antigo.select.billing?.select?.tasks);

  const include: any = withCoverageInclude({ include: { coveredTasks: true, customer: true } });
  check('o mesmo vale para `include`',
    !('coveredTasks' in include.include) && include.include.customer === true &&
    !!include.include.billing);

  // Quem pediu `billing` à mão sabe o que quer: não se sobrescreve.
  const proprio: any = withCoverageInclude({ select: { billing: { select: { id: true } } } });
  check('um `billing` pedido à mão é respeitado',
    JSON.stringify(proprio.select.billing) === JSON.stringify({ select: { id: true } }));
}

if (failures > 0) {
  console.log(`\n❌ ${failures} verificação(ões) falharam.`);
  process.exit(1);
}
console.log('\n✅ A fatia do veículo: todas as verificações passaram.');
