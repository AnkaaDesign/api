/**
 * A COBERTURA DO FATURAMENTO — a repartição dos veículos entre as faturas.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────
 * A aritmética do orçamento tinha um "se": `PER_TASK` cobrava um veículo, o
 * resto cobrava todos. Com lotes existiria um terceiro caso — e um terceiro caso
 * numa fórmula de dinheiro é onde os centavos divergem entre o PDF que o cliente
 * assinou e o boleto que ele recebe.
 *
 * A fórmula passou a ser UMA:
 *
 *     total da fatura = total por veículo × veículos COBERTOS
 *
 * `JOINT` cobre N, `PER_TASK` cobre 1, um lote cobre k. As três leituras são a
 * mesma linha, e o que este arquivo verifica é a propriedade que torna isso
 * seguro: **a soma das faturas reconstrói o contrato, nos três modos**. É ela que
 * permite a dezenas de agregações existentes continuarem certas sem saber que
 * lote existe.
 */

import { computeQuoteMoney, planCoverage, round2 } from '../src/utils/quote-money';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Marquespan, 02/09: sessenta caminhões, R$ 13.830,00 de serviços por veículo,
// 12% de desconto ⇒ R$ 12.170,40 cada, R$ 730.224,00 de contrato.
const SERVICES = [4545, 1285, 8000];
const N = 60;
const PER_VEHICLE = 12170.4;
const CONTRACT = 730224;
const money = (covered?: number) =>
  computeQuoteMoney({
    serviceAmounts: SERVICES,
    discountType: 'PERCENTAGE',
    discountValue: 12,
    taskCount: N,
    coveredTaskCount: covered,
  });

console.log('\nA fórmula é uma só: por veículo × cobertos');
{
  check('o preço de um caminhão sai como sempre', money(1).perVehicleTotal === PER_VEHICLE);
  check('cobrindo os 60, a fatura é o contrato', money(N).configTotal === CONTRACT);
  check('cobrindo 1, a fatura é um caminhão', money(1).configTotal === PER_VEHICLE);
  check(
    'cobrindo 20, a fatura é o lote',
    money(20).configTotal === round2(PER_VEHICLE * 20),
    String(money(20).configTotal),
  );
  check(
    'cobertura omitida = cobre o orçamento inteiro (o padrão, e o de sempre)',
    money().configTotal === CONTRACT,
  );
}

console.log('\nA soma das faturas reconstrói o contrato — nos três modos');
{
  const joint = money(N).configTotal;
  check('JOINT: uma fatura', joint === CONTRACT, String(joint));

  const perTask = round2(
    Array.from({ length: N }, () => money(1).configTotal).reduce((a, b) => a + b, 0),
  );
  check('PER_TASK: sessenta faturas somam o contrato', perTask === CONTRACT, String(perTask));

  const lotes = round2([20, 20, 20].map(k => money(k).configTotal).reduce((a, b) => a + b, 0));
  check('lotes 20+20+20 somam o contrato', lotes === CONTRACT, String(lotes));

  const desiguais = round2([1, 19, 40].map(k => money(k).configTotal).reduce((a, b) => a + b, 0));
  check('lotes desiguais 1+19+40 somam o contrato', desiguais === CONTRACT, String(desiguais));
}

console.log('\nDesconto FIXO é por veículo — e o lote multiplica igual');
{
  // R$ 500 de desconto é R$ 500 POR CAMINHÃO. É a leitura declarada em
  // `quote-money.ts`, e a única compatível com cobrar veículo a veículo.
  const fixo = (covered: number) =>
    computeQuoteMoney({
      serviceAmounts: [1000],
      discountType: 'FIXED_VALUE',
      discountValue: 500,
      taskCount: 4,
      coveredTaskCount: covered,
    });
  check('um veículo custa 500', fixo(1).configTotal === 500);
  check('um lote de dois custa 1000', fixo(2).configTotal === 1000);
  check('a fatura conjunta custa 2000', fixo(4).configTotal === 2000);
  check(
    'desconto maior que o serviço não produz total negativo (o banco recusa)',
    computeQuoteMoney({
      serviceAmounts: [100],
      discountType: 'FIXED_VALUE',
      discountValue: 5000,
      taskCount: 2,
      coveredTaskCount: 2,
    }).configTotal === 0,
  );
}

console.log('\nGuardas da cobertura');
{
  check('cobertura zero cai no orçamento inteiro, nunca em R$ 0,00', money(0).configTotal === CONTRACT);
  check(
    'cobertura maior que o orçamento é aparada — cobrar 70 de 60 seria cobrar a mais',
    money(70).configTotal === CONTRACT,
    String(money(70).configTotal),
  );
  check('a contagem coberta é devolvida para quem escreve a cláusula', money(20).coveredVehicleCount === 20);
}

console.log('\n`planCoverage`: quem cobra quem');
{
  const ids = ['t1', 't2', 't3', 't4'];

  const joint = planCoverage('JOINT', ids);
  check('JOINT: um grupo com todos', joint.length === 1 && joint[0].length === 4);

  const perTask = planCoverage('PER_TASK', ids);
  check(
    'PER_TASK: um grupo por veículo, na ordem do orçamento',
    perTask.length === 4 && perTask.every((g, i) => g.length === 1 && g[0] === ids[i]),
  );

  const custom = planCoverage('CUSTOM', ids, [['t1', 't2'], ['t3', 't4']]);
  check(
    'CUSTOM: respeita os lotes declarados',
    JSON.stringify(custom) === JSON.stringify([['t1', 't2'], ['t3', 't4']]),
    JSON.stringify(custom),
  );

  // ⚠️ A regra que evita mudar em silêncio o valor de uma fatura já conferida.
  const sobra = planCoverage('CUSTOM', ids, [['t1', 't2']]);
  check(
    'veículo que nenhum lote reivindicou fica SOZINHO, nunca enfiado no primeiro lote',
    JSON.stringify(sobra) === JSON.stringify([['t1', 't2'], ['t3'], ['t4']]),
    JSON.stringify(sobra),
  );

  const removido = planCoverage('CUSTOM', ['t1', 't2'], [['t1', 't2', 't9']]);
  check(
    'veículo que saiu do orçamento some do lote em vez de derrubar a gravação',
    JSON.stringify(removido) === JSON.stringify([['t1', 't2']]),
    JSON.stringify(removido),
  );

  const duplicado = planCoverage('CUSTOM', ids, [['t1', 't2'], ['t2', 't3']]);
  check(
    'veículo declarado em dois lotes fica no PRIMEIRO — a sobreposição é o que o índice único proíbe',
    JSON.stringify(duplicado) === JSON.stringify([['t1', 't2'], ['t3'], ['t4']]),
    JSON.stringify(duplicado),
  );

  check(
    'CUSTOM sem lote nenhum começa cada veículo sozinho, e a tela agrupa a partir daí',
    planCoverage('CUSTOM', ids, []).length === 4,
  );

  // O registro nasce antes do vínculo com a tarefa.
  const semVeiculo = planCoverage('JOINT', []);
  check(
    'orçamento sem veículo devolve UM grupo vazio — devolver lista vazia apagaria a fatia e o desconto junto',
    semVeiculo.length === 1 && semVeiculo[0].length === 0,
    JSON.stringify(semVeiculo),
  );
}

console.log('\nA partição: toda tarefa coberta uma vez, e só uma');
{
  const ids = Array.from({ length: 60 }, (_, i) => `t${i}`);
  for (const mode of ['JOINT', 'PER_TASK'] as const) {
    const groups = planCoverage(mode, ids);
    const flat = groups.flat();
    check(
      `${mode}: cobre os 60 sem repetir nenhum`,
      flat.length === 60 && new Set(flat).size === 60,
      `${flat.length}/${new Set(flat).size}`,
    );
  }
  const lotes = planCoverage('CUSTOM', ids, [ids.slice(0, 20), ids.slice(20)]);
  const flat = lotes.flat();
  check(
    'lotes 20+40: cobrem os 60 sem repetir nenhum',
    flat.length === 60 && new Set(flat).size === 60,
    `${flat.length}/${new Set(flat).size}`,
  );
}

if (failures > 0) {
  console.log(`\n❌ ${failures} verificação(ões) falharam.`);
  process.exit(1);
}
console.log('\n✅ Cobertura de faturamento: todas as verificações passaram.');
