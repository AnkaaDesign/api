/**
 * A gravação genérica (`PUT /budgets/:id` com `status`) não é segunda porta dos
 * atos: aprovar, enviar ao cliente, retirar e reprovar têm checagem própria.
 *
 *   npx tsx -r tsconfig-paths/register tests/budget-generic-update-acts.test.ts
 */
import assert from 'node:assert/strict';
import { TASK_QUOTE_STATUS as S } from '../src/constants/enums';
import { genericUpdateStatusActMessage as act } from '../src/modules/production/budget/budget-transitions';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check('fixar o status atual passa (o faturamento manda o que leu)', () => {
  for (const s of Object.values(S)) assert.equal(act(s, s), null, s);
});
check('→ APPROVED manda para o ato com nota', () => assert.match(act(S.PENDING, S.APPROVED) ?? '', /value-approval/));
check('→ IN_NEGOTIATION manda para "Enviar ao cliente"', () => {
  assert.match(act(S.PENDING, S.IN_NEGOTIATION) ?? '', /send-to-customer/);
  assert.match(act(S.REQUESTED, S.IN_NEGOTIATION) ?? '', /send-to-customer/);
});
check('IN_NEGOTIATION → PENDING manda para "Retirar do cliente"', () =>
  assert.match(act(S.IN_NEGOTIATION, S.PENDING) ?? '', /withdraw-from-customer/),
);
check('APPROVED → PENDING manda para "Reprovar valor" (com motivo)', () =>
  assert.match(act(S.APPROVED, S.PENDING) ?? '', /DELETE \/budgets\/:id\/value-approval/),
);
check('arestas que não são ato seguem (cancelar, reabrir vencido)', () => {
  assert.equal(act(S.PENDING, S.CANCELLED), null);
  assert.equal(act(S.EXPIRED, S.PENDING), null);
});

console.log(`\n✓ TODAS as verificações passaram (${passed})`);
