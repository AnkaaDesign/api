/**
 * Guarda da conciliação por tarefa — como um crédito bancário se distribui
 * sobre as parcelas de uma tarefa, e quando o sistema pode criar cobrança nova.
 *
 * O contexto é a perda de dados da migração: muitas tarefas ficaram com
 * `quoteId = NULL`, e sem orçamento não existe fatura nem parcela — ou seja,
 * não existe nada onde ancorar um `ReconciliationMatch`. Um crédito do Sicredi
 * que de fato pagou essas tarefas fica invisível para todo o conciliador.
 *
 * As regras que este arquivo protege:
 *
 *  1. FIFO por vencimento. Um cliente que abate um trabalho quita a parcela
 *     mais ANTIGA em aberto. Qualquer outra ordem deixa uma parcela velha
 *     aberta atrás de uma nova já paga — e ela passa a aparecer como vencida
 *     em todas as listas.
 *
 *  2. `planFifo` devolve `null` em vez de alocar parcialmente. Um plano que
 *     "quase" cobre o valor é pior que plano nenhum: o dinheiro sumiria sem
 *     ninguém perceber. O chamador precisa decidir entre criar cobrança nova
 *     ou recusar.
 *
 *  3. Identidade pesa mais que valor. Diferente do conciliador de parcelas,
 *     aqui não existe valor de parcela para corroborar nada. Coincidência de
 *     valor é evidência fraca, e pesá-la ao contrário faria a tarefa de um
 *     terceiro subir ao topo da lista só porque o número bateu.
 *
 * Rodar: pnpm tsx tests/task-match-allocation.test.ts
 */

import {
  ALLOC_TOLERANCE,
  deriveBillingState,
  openCapacityOf,
  planFifo,
  round2,
  scoreTaskCandidate,
} from '../src/modules/financial/reconciliation/task-match-allocation';
import { nameSimilarity } from '../src/modules/financial/reconciliation/text-normalization';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const d = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const inst = (id: string, due: string, remaining: number) => ({
  id,
  dueDate: d(due),
  remaining,
});

// ---------------------------------------------------------------------------
console.log('\nFIFO: a parcela mais antiga é quitada primeiro');
{
  // Deliberadamente fora de ordem na entrada — o plano tem de ordenar sozinho.
  const open = [
    inst('nova', '2026-09-10', 1000),
    inst('antiga', '2026-07-10', 1000),
    inst('meio', '2026-08-10', 1000),
  ];

  const plan = planFifo(open, 1500);
  check('devolve um plano', plan !== null);
  check(
    'começa pela parcela mais antiga',
    plan?.[0]?.installmentId === 'antiga',
    `veio ${plan?.[0]?.installmentId}`,
  );
  check('quita a antiga por inteiro', plan?.[0]?.amount === 1000);
  check('sobra vai para a do meio', plan?.[1]?.installmentId === 'meio');
  check('e só o restante', plan?.[1]?.amount === 500, `veio ${plan?.[1]?.amount}`);
  check('não toca na parcela nova', plan?.length === 2, `plano tem ${plan?.length} itens`);
  check(
    'a soma do plano é exatamente o crédito',
    round2((plan ?? []).reduce((s, p) => s + p.amount, 0)) === 1500,
  );
}

// ---------------------------------------------------------------------------
console.log('\nFIFO: saldo insuficiente devolve null, nunca um plano parcial');
{
  const open = [inst('a', '2026-07-10', 300), inst('b', '2026-08-10', 200)];

  check('null quando o crédito excede o saldo', planFifo(open, 900) === null);
  check('null também sem nenhuma parcela aberta', planFifo([], 100) === null);
  check('plano exato quando bate certinho', planFifo(open, 500)?.length === 2);

  // A tolerância de centavos existe para drift bancário, não para perder dinheiro.
  check(
    'centavos dentro da tolerância ainda planejam',
    planFifo(open, 500 + ALLOC_TOLERANCE / 2) !== null,
  );
  check('um real a mais já é recusado', planFifo(open, 501) === null);
}

// ---------------------------------------------------------------------------
console.log('\nFIFO: parcela parcialmente paga só oferece o saldo restante');
{
  // Parcela de 1000 com 400 já recebidos de um crédito anterior — é isto que
  // permite VÁRIOS créditos caírem sobre UMA tarefa.
  const open = [inst('parcial', '2026-07-10', 600)];

  const plan = planFifo(open, 600);
  check('aceita exatamente o saldo', plan?.[0]?.amount === 600);
  check('recusa acima do saldo', planFifo(open, 700) === null);

  const partial = planFifo(open, 250);
  check('aceita um segundo crédito menor', partial?.[0]?.amount === 250);
}

// ---------------------------------------------------------------------------
console.log('\nCapacidade: soma apenas saldo positivo');
{
  check('soma simples', openCapacityOf([inst('a', '2026-07-10', 100), inst('b', '2026-08-10', 250)]) === 350);
  check('ignora saldo negativo', openCapacityOf([inst('a', '2026-07-10', -50)]) === 0);
  check('lista vazia é zero', openCapacityOf([]) === 0);
}

// ---------------------------------------------------------------------------
console.log('\nEstado de faturamento da tarefa');
{
  check(
    'sem orçamento',
    deriveBillingState({ hasQuote: false, installmentCount: 0, openCapacity: 0 }) === 'NO_QUOTE',
  );
  check(
    'orçamento sem parcelas = não faturado',
    deriveBillingState({ hasQuote: true, installmentCount: 0, openCapacity: 0 }) === 'QUOTE_UNBILLED',
  );
  check(
    'parcelas com saldo = em aberto',
    deriveBillingState({ hasQuote: true, installmentCount: 2, openCapacity: 500 }) === 'QUOTE_OPEN',
  );
  check(
    'parcelas sem saldo = liquidado',
    deriveBillingState({ hasQuote: true, installmentCount: 2, openCapacity: 0 }) === 'QUOTE_SETTLED',
  );
  check(
    'saldo de centavos não conta como em aberto',
    deriveBillingState({ hasQuote: true, installmentCount: 1, openCapacity: 0.01 }) ===
      'QUOTE_SETTLED',
  );
}

// ---------------------------------------------------------------------------
console.log('\nPontuação: identidade pesa mais que valor');
{
  const base = {
    unallocated: 5000,
    postedAt: d('2026-07-15'),
    referenceDate: d('2026-07-14'),
    quoteTotal: null as number | null,
    openCapacity: 0,
    billingState: 'NO_QUOTE' as const,
    fromSearch: false,
    nameSimilarity,
  };

  const exactCnpj = scoreTaskCandidate({
    ...base,
    txCnpj: '07895343000170',
    txName: 'TRANSPORTES XYZ LTDA',
    customerCnpjCpf: '07895343000170',
    customerName: 'TRANSPORTES XYZ',
  });
  const noIdentity = scoreTaskCandidate({
    ...base,
    txCnpj: '',
    txName: null,
    customerCnpjCpf: null,
    customerName: null,
  });
  check('CNPJ exato pontua bem acima de nenhuma identidade', exactCnpj.confidence > noIdentity.confidence + 30);
  check('CNPJ exato aparece no motivo', exactCnpj.reason.includes('CNPJ/CPF exato'));

  const sameRoot = scoreTaskCandidate({
    ...base,
    txCnpj: '07895343000170',
    txName: null,
    customerCnpjCpf: '07895343000251', // outra filial
    customerName: null,
  });
  check('mesma raiz pontua, mas abaixo do exato', sameRoot.confidence < exactCnpj.confidence);
  check('mesma raiz aparece no motivo', sameRoot.reason.includes('raiz'));

  // A regra que evita subir a tarefa de um terceiro só porque o número bateu.
  const strangerExactValue = scoreTaskCandidate({
    ...base,
    txCnpj: '11111111111111',
    txName: 'OUTRA EMPRESA',
    customerCnpjCpf: '99999999999999',
    customerName: 'NADA A VER',
    quoteTotal: 5000,
    billingState: 'QUOTE_UNBILLED',
  });
  const rightPayerWrongValue = scoreTaskCandidate({
    ...base,
    txCnpj: '07895343000170',
    txName: 'TRANSPORTES XYZ LTDA',
    customerCnpjCpf: '07895343000170',
    customerName: 'TRANSPORTES XYZ',
    quoteTotal: 18000,
    billingState: 'QUOTE_UNBILLED',
  });
  check(
    'pagador certo com valor diferente vence estranho com valor exato',
    rightPayerWrongValue.confidence > strangerExactValue.confidence,
    `${rightPayerWrongValue.confidence} vs ${strangerExactValue.confidence}`,
  );

  check('pontuação nunca passa de 100', exactCnpj.confidence <= 100);
  check('pontuação nunca é negativa', noIdentity.confidence >= 0);
  check('sempre há um motivo', noIdentity.reason.length > 0);
}

// ---------------------------------------------------------------------------
console.log('\nPontuação: uma parcela em aberto vence uma tarefa sem orçamento');
{
  // Se o dinheiro cabe numa cobrança que JÁ existe, essa é a resposta certa —
  // criar orçamento novo seria duplicar receita.
  const shared = {
    unallocated: 5000,
    postedAt: d('2026-07-15'),
    txCnpj: '07895343000170',
    txName: 'TRANSPORTES XYZ',
    customerCnpjCpf: '07895343000170',
    customerName: 'TRANSPORTES XYZ',
    referenceDate: d('2026-07-14'),
    fromSearch: false,
    nameSimilarity,
  };

  const withOpen = scoreTaskCandidate({
    ...shared,
    quoteTotal: 5000,
    openCapacity: 5000,
    billingState: 'QUOTE_OPEN',
  });
  const withoutQuote = scoreTaskCandidate({
    ...shared,
    quoteTotal: null,
    openCapacity: 0,
    billingState: 'NO_QUOTE',
  });
  check(
    'parcela em aberto pontua acima de sem orçamento',
    withOpen.confidence > withoutQuote.confidence,
    `${withOpen.confidence} vs ${withoutQuote.confidence}`,
  );
}

// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n✅ Todos os testes passaram\n'
    : `\n❌ ${failures} teste(s) falharam\n`,
);
process.exit(failures === 0 ? 0 : 1);
