/**
 * COBERTURA VAZIA NÃO É "TODOS OS VEÍCULOS" — e "congelado" é UMA pergunta só.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. `emitServiceQuantity` da NFS-e sai da contagem dos veículos cobertos, e a
 *    nota DECLARA essa contagem à prefeitura. Com cobertura vazia e
 *    `Invoice.taskId` nulo (o LOTE de vinte dos sessenta), o recuo antigo
 *    declarava SESSENTA: o líquido ainda fechava — o desconto por diferença
 *    absorve a sobra —, então o boleto batia, a conciliação casava pelo líquido e
 *    ninguém via. O que saiu autorizado foi documento fiscal irreversível com
 *    quarenta caminhões que ninguém cobrou.
 *
 *    A separação NÃO é "recuo = erro": no acervo cobertura vazia significa mesmo
 *    "todos", porque a entidade `Billing` nasceu em 16/09/2026. O que separa é de
 *    onde a fatura vem — ver `missingCoverageError`.
 *
 * 2. "Cobrança congelada" tinha TRÊS definições que discordavam exatamente no
 *    resíduo de uma aprovação que falhou no meio (fatura viva, carimbo nulo,
 *    estado PENDENTE): `GET /billings/:id/frozen` dizia congelado e travava a
 *    tela, enquanto `recalcQuoteTotals` dizia que não e REESCREVIA
 *    `BudgetPayer.subtotal`/`total` por cima de fatura já emitida. Agora é uma
 *    função só, com três braços.
 *
 * 3. E o gêmeo em SQL (`BILLING_FROZEN_WHERE`) tem de continuar com DOIS braços:
 *    ele é o gate de EMISSÃO, e aceitar "tem fatura viva" reabriria o buraco —
 *    o resíduo TEM fatura e NÃO tem aprovação.
 *
 * Rodar: npx tsx tests/nfse-coverage-guard.test.ts
 */
import { missingCoverageError, resolveCoveredVehicles } from '../src/utils/nfse-coverage';
import {
  BILLING_FROZEN_WHERE,
  isBillingApproved,
  isBillingFrozen,
} from '../src/modules/production/budget/budget.guards';
import { BILLING_STATUS } from '../src/constants';

let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/** Um pagador como a consulta da NFS-e o traz. */
const payer = (coveredIds: string[] | null, quoteTasks: Array<{ id: string }>) => ({
  billing:
    coveredIds === null
      ? null
      : { id: 'bil-1', approvedAt: new Date(), tasks: coveredIds.map(taskId => ({ taskId })) },
  quote: { id: 'q-1', tasks: quoteTasks },
});

const sessenta = Array.from({ length: 60 }, (_, i) => ({ id: `t${i + 1}` }));
const vinte = sessenta.slice(0, 20).map(t => t.id);

console.log('\n── 1. De onde a cobertura veio ─────────────────────────────────');

{
  const config = payer(vinte, sessenta);
  const r = resolveCoveredVehicles(config, sessenta, null);
  check('lote de 20 em 60: a cobertura responde', r.source === 'coverage', `source=${r.source}`);
  check('lote de 20 em 60: quantidade = 20', r.rows.length === 20, `rows=${r.rows.length}`);
}

{
  // Cobertura vazia, mas a FATURA nomeia o seu único veículo. `sliceAnchorTaskId`
  // só preenche `Invoice.taskId` quando a cobertura tem exatamente um.
  const config = payer([], sessenta);
  const r = resolveCoveredVehicles(config, sessenta, { id: 't7' });
  check('âncora da fatura: um veículo, sem chute', r.source === 'invoice-anchor');
  check('âncora da fatura: quantidade = 1', r.rows.length === 1 && r.rows[0].id === 't7');
}

{
  const config = payer([], sessenta);
  const r = resolveCoveredVehicles(config, sessenta, null);
  check('sem cobertura e sem âncora: é RECUO, e ele se declara', r.source === 'whole-quote');
  check('o recuo mediria 60 veículos', r.rows.length === 60);
}

console.log('\n── 2. O recuo pode virar nota fiscal? ──────────────────────────');

{
  const config = payer([], sessenta);
  const r = resolveCoveredVehicles(config, sessenta, null);
  const erro = missingCoverageError(config, r);
  check('cobrança MODERNA sem cobertura: RECUSA', erro !== null);
  check(
    'a recusa diz o número que sairia na nota',
    !!erro && erro.includes('60') && erro.includes('Refaça o faturamento'),
    erro ?? '(sem mensagem)',
  );
}

{
  // Acervo: fatura sem `customerConfigId` nenhum. Não há cobertura a faltar —
  // "todos" é a leitura de sempre e continua valendo.
  const r = resolveCoveredVehicles(null, sessenta, null);
  check('legado (sem cobrança): o recuo continua valendo', missingCoverageError(null, r) === null);
}

{
  // A migração de cobertura escreveu uma linha por tarefa para toda fatia antiga,
  // então vazio COM cobrança é dado faltando — exceto quando "todos" é UM.
  const umVeiculo = [{ id: 't1' }];
  const config = payer([], umVeiculo);
  const r = resolveCoveredVehicles(config, umVeiculo, null);
  check(
    'orçamento de UM veículo: "todos" e "este" são o mesmo conjunto, emite',
    missingCoverageError(config, r) === null,
  );
}

{
  const config = payer(vinte, sessenta);
  const r = resolveCoveredVehicles(config, sessenta, null);
  check('cobertura declarada nunca é recusada', missingCoverageError(config, r) === null);
}

console.log('\n── 3. "Congelado" é uma pergunta só, com três braços ───────────');

const viva = [{ status: 'PENDING' }];
const cancelada = [{ status: 'CANCELLED' }];

check('braço 1 — o carimbo', isBillingFrozen({ approvedAt: new Date(), status: null }));
check(
  'braço 2 — estado pós-aprovação sem carimbo (liquidada por conciliação)',
  isBillingFrozen({ approvedAt: null, status: BILLING_STATUS.SETTLED }),
);
check(
  'braço 3 — fatura viva pelo PAGADOR',
  isBillingFrozen({ approvedAt: null, status: BILLING_STATUS.PENDING, invoices: viva }),
);
check(
  'braço 3 — fatura viva pelos pagadores do FATURAMENTO',
  isBillingFrozen({
    approvedAt: null,
    status: BILLING_STATUS.PENDING,
    customerConfigs: [{ invoices: viva }],
  }),
);
check(
  'braço 3 — fatura viva já contada no banco',
  isBillingFrozen({ approvedAt: null, status: BILLING_STATUS.PENDING, hasLiveInvoice: true }),
);
check(
  'fatura CANCELADA de ciclo anterior não congela',
  !isBillingFrozen({ approvedAt: null, status: BILLING_STATUS.PENDING, invoices: cancelada }),
);
check(
  'nada de nada não congela',
  !isBillingFrozen({ approvedAt: null, status: BILLING_STATUS.PENDING, invoices: [] }),
);

console.log('\n── 4. O gate de EMISSÃO continua com dois braços ───────────────');

// O resíduo do rollback de `internalApprove`: fatura viva, carimbo levantado,
// estado devolvido a PENDENTE. Congelado (não se reescreve o dinheiro dele),
// mas NÃO aprovado (não se emite nota nem boleto sobre ele).
const residuo = { approvedAt: null, status: BILLING_STATUS.PENDING, invoices: viva };
check('resíduo do rollback: congelado', isBillingFrozen(residuo));
check('resíduo do rollback: NÃO aprovado', !isBillingApproved(residuo));
check(
  'BILLING_FROZEN_WHERE não ganhou o braço da fatura viva',
  BILLING_FROZEN_WHERE.OR.length === 2 &&
    BILLING_FROZEN_WHERE.OR.some(o => 'approvedAt' in o) &&
    BILLING_FROZEN_WHERE.OR.some(o => 'status' in o),
  JSON.stringify(BILLING_FROZEN_WHERE),
);

console.log(
  failures === 0
    ? '\nTodos os testes passaram.\n'
    : `\n${failures} teste(s) FALHARAM.\n`,
);
process.exit(failures === 0 ? 0 : 1);
