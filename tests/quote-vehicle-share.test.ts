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

import { perVehicleAmount, sliceTask } from '../src/utils/quote-tasks';

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
  check(
    'fatia PER_TASK devolve a tarefa DELA',
    sliceTask({ taskId: 'truck-37', quote: { tasks } })?.id === 'truck-37',
  );
  check(
    'fatia JOINT (taskId nulo) ancora no primeiro veículo — qualquer um serve para o link',
    sliceTask({ taskId: null, quote: { tasks } })?.id === 'truck-1',
  );
  check(
    'fatia cuja tarefa não veio na consulta cai no primeiro, nunca em nulo',
    sliceTask({ taskId: 'truck-99', quote: { tasks } })?.id === 'truck-1',
  );
  check('orçamento sem tarefa nenhuma devolve nulo', sliceTask({ taskId: null, quote: { tasks: [] } }) === null);
  check('configuração ausente devolve nulo', sliceTask(null) === null);
  check('configuração sem orçamento devolve nulo', sliceTask({ taskId: 'x' }) === null);
}

if (failures > 0) {
  console.log(`\n❌ ${failures} verificação(ões) falharam.`);
  process.exit(1);
}
console.log('\n✅ A fatia do veículo: todas as verificações passaram.');
