/**
 * Guarda da CASCATA DE EXTRAS E DESCONTOS do bônus.
 *
 * `applyModifiersToBase` é o único lugar que transforma bruto em líquido, e
 * agora atende dois donos: o bônus GRAVADO (a folha já pagou aquilo) e a
 * SIMULAÇÃO (e se esta pessoa tivesse outro cargo?). A diferença é uma só e
 * está escrita no nome da opção: com `preferPercentage`, uma linha que tem
 * porcentagem vale a porcentagem, mesmo tendo também um valor materializado.
 *
 * Por que isso importa: 63 lançamentos do acervo trazem OS DOIS campos — a
 * "Assiduidade do Ponto Eletrônico" é 21% *e* os R$ 287,92 que aquele 21%
 * valeu na base daquele mês. Trocar o cargo muda a base; o valor de então
 * deixa de valer, a porcentagem não.
 *
 * O teste protege as duas pontas:
 *  1. o caminho GRAVADO tem de continuar dando exatamente o que dava antes —
 *     extra lê o valor primeiro, desconto lê a porcentagem primeiro, e trocar
 *     essa ordem mexeria em bônus já pago;
 *  2. o caminho da SIMULAÇÃO tem de escalar com a base.
 *
 * Rodar: npx tsx tests/bonus-modifiers.test.ts
 */

import { BonusService } from '../src/modules/personnel-department/bonus/bonus.service';

let failures = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const close = (a: number, b: number, tol = 0.005) => Math.abs(a - b) <= tol;

// A função é pura: não precisa das doze dependências do serviço para rodar.
const service = Object.create(BonusService.prototype) as any;
const apply = (base: number, extras: any[], discounts: any[], options?: any) =>
  service.applyModifiersToBase(base, extras, discounts, options);

/** A implementação ANTERIOR, copiada aqui como testemunha. */
function legacy(base: number, extras: any[], discounts: any[]): number {
  let totalExtras = 0;
  for (const extra of extras) {
    if (extra.value !== null && extra.value !== undefined) totalExtras += Number(extra.value);
    else if (extra.percentage !== null && extra.percentage !== undefined)
      totalExtras += base * (Number(extra.percentage) / 100);
  }
  let net = base + totalExtras;
  const sorted = [...discounts].sort(
    (a: any, b: any) =>
      (a.calculationOrder || 0) - (b.calculationOrder || 0) ||
      String(a.id || '').localeCompare(String(b.id || '')),
  );
  for (const d of sorted) {
    if (d.percentage !== null && d.percentage !== undefined) {
      net = Math.max(0, net - net * (Number(d.percentage) / 100));
    } else if (d.value !== null && d.value !== undefined) {
      net = Math.max(0, net - Math.min(Number(d.value), net));
    }
  }
  const hasModifiers = discounts.length > 0 || extras.length > 0;
  return hasModifiers ? Math.round(net * 100) / 100 : base;
}

// Os quatro estados que uma linha pode ter no banco, medidos no acervo:
// 63 com os dois campos, 73 só porcentagem, 17 só valor, 7 sem nenhum.
const LINES = [
  { nome: 'os dois campos', percentage: 21, value: 287.92 },
  { nome: 'só porcentagem', percentage: 25, value: null },
  { nome: 'só valor', percentage: null, value: 80 },
  { nome: 'nenhum (linha só de aviso)', percentage: null, value: null },
];

console.log('\no bônus GRAVADO não pode mudar de valor');
for (const extra of LINES) {
  for (const desconto of LINES) {
    for (const base of [0, 126.08, 857.85, 1338.99]) {
      const novo = apply(base, [extra], [desconto]);
      const velho = legacy(base, [extra], [desconto]);
      check(
        `base ${base} · extra ${extra.nome} · desconto ${desconto.nome}`,
        close(novo, velho),
        `novo ${novo} ≠ antigo ${velho}`,
      );
    }
  }
}

console.log('\ncascata em ordem, com vários lançamentos');
{
  const extras = [
    { percentage: 21, value: 287.92, calculationOrder: 1 },
    { percentage: null, value: 50, calculationOrder: 2 },
  ];
  const descontos = [
    { percentage: 50, value: null, calculationOrder: 1, id: 'a' },
    { percentage: null, value: 100, calculationOrder: 2, id: 'b' },
  ];
  check('gravado bate com a testemunha', close(apply(1000, extras, descontos), legacy(1000, extras, descontos)));
  // Gravado: 1000 + 287,92 + 50 = 1337,92 → −50% = 668,96 → −100 = 568,96.
  check('gravado: 568,96', close(apply(1000, extras, descontos), 568.96), String(apply(1000, extras, descontos)));
  // Simulação: 1000 + 210 + 50 = 1260 → −50% = 630 → −100 = 530.
  check(
    'simulação escala o extra pela base nova: 530',
    close(apply(1000, extras, descontos, { preferPercentage: true }), 530),
    String(apply(1000, extras, descontos, { preferPercentage: true })),
  );
}

console.log('\nsem lançamento, o líquido é o próprio bruto');
{
  check('nenhuma linha', apply(857.85, [], []) === 857.85);
  check('linha só de aviso não muda nada', close(apply(857.85, [], [{ percentage: null, value: null }]), 857.85));
}

console.log('\ndesconto não deixa o líquido negativo');
{
  check('valor maior que a base', apply(100, [], [{ percentage: null, value: 500 }]) === 0);
  check('porcentagem acima de 100', apply(100, [], [{ percentage: 150, value: null }]) === 0);
}

console.log('\na simulação escala com a base');
{
  const extra = [{ percentage: 21, value: 287.92 }];
  const dobro = apply(2000, extra, [], { preferPercentage: true });
  const simples = apply(1000, extra, [], { preferPercentage: true });
  check('dobrar a base dobra o extra', close(dobro, simples * 2), `${dobro} vs ${simples * 2}`);
  const gravadoDobro = apply(2000, extra, []);
  check(
    'no gravado o extra é o valor de então, não escala',
    close(gravadoDobro - 2000, 287.92),
    String(gravadoDobro - 2000),
  );
}

console.log(failures === 0 ? '\nTUDO CERTO\n' : `\n${failures} FALHA(S)\n`);
process.exit(failures === 0 ? 0 : 1);
