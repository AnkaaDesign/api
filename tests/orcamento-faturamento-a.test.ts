/**
 * ORÇAMENTO × FATURAMENTO — as regras que a frente A corrigiu em 17/09/2026.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────
 * Sete defeitos desta leva não eram erros de cálculo: eram PERGUNTAS respondidas
 * em lugares diferentes com respostas diferentes. Um campo que o schema aceitava
 * e ninguém lia; quatro definições de "congelado"; uma repartição de veículos
 * feita por fatia num lado e por cliente no outro. Nenhum deles aparece num
 * teste de total. Todos aparecem aqui.
 *
 * Rodar: pnpm tsx tests/orcamento-faturamento-a.test.ts
 */

import { planCoverage, planCoverageByCustomer } from '../src/utils/quote-money';
import {
  BILLING_FROZEN_WHERE,
  isBillingFrozen,
  isQuoteMoneyLocked,
  QUOTE_SAFE_AFTER_BILLING_FIELDS,
} from '../src/modules/production/task-quote/task-quote.guards';
import {
  taskQuoteUpdateSchema,
  taskQuoteCustomerConfigCreateNestedSchema,
} from '../src/schemas/task-quote';
import { TASK_QUOTE_STATUS_ORDER, BILLING_STATUS } from '../src/constants';
import { TaskQuoteService } from '../src/modules/production/task-quote/task-quote.service';

// O construtor do serviço só guarda dependências; a detecção de mudança material
// é pura (compara dois objetos) e não toca no Prisma, então um serviço vazio
// basta para exercitá-la — mesmo padrão de `tests/quote-diff.test.ts`.
const svc: any = new (TaskQuoteService as any)();

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const T = ['t1', 't2', 't3', 't4'];
const CLIENTE_A = '11111111-1111-4111-8111-111111111111';
const CLIENTE_B = '22222222-2222-4222-8222-222222222222';

/** Todo veículo aparece em EXATAMENTE um grupo de cada cliente? */
function particiona(
  plano: Array<{ config: { customerId?: string | null }; coverage: string[] }>,
  taskIds: string[],
): boolean {
  const porCliente = new Map<string, string[]>();
  for (const { config, coverage } of plano) {
    const k = String(config.customerId ?? '');
    // Um mesmo grupo entregue a dois pagadores do mesmo cliente contaria duas
    // vezes; a cobertura é do GRUPO, então deduplicamos por grupo.
    const atual = porCliente.get(k) ?? [];
    porCliente.set(k, atual);
  }
  for (const [cliente] of porCliente) {
    const gruposUnicos = new Set(
      plano
        .filter(p => String(p.config.customerId ?? '') === cliente)
        .map(p => [...p.coverage].sort().join('|')),
    );
    const vistos: string[] = [];
    for (const g of gruposUnicos) if (g) vistos.push(...g.split('|'));
    if (vistos.length !== new Set(vistos).size) return false;
    if (vistos.length !== taskIds.length) return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nA4 — criar em LOTES não pode gerar cobertura sobreposta');
// ═══════════════════════════════════════════════════════════════════════════
{
  // O defeito, reproduzido: `planCoverage` chamada POR CONFIGURAÇÃO, com um lote
  // cada. Ela isola o que sobrou — e o que sobrou é o lote da outra.
  const porFatia = [
    ...planCoverage('CUSTOM', T, [['t1', 't2']]),
    ...planCoverage('CUSTOM', T, [['t3', 't4']]),
  ];
  const aparicoes = porFatia.flat();
  check(
    'o defeito existia: chamada por fatia faz cada veículo aparecer 2×',
    aparicoes.length === 8 && new Set(aparicoes).size === 4,
    JSON.stringify(porFatia),
  );

  const plano = planCoverageByCustomer(
    [
      { customerId: CLIENTE_A, taskIds: ['t1', 't2'] },
      { customerId: CLIENTE_A, taskIds: ['t3', 't4'] },
    ],
    T,
    'CUSTOM',
  );
  check(
    'agrupando por cliente, os lotes PARTICIONAM os veículos',
    particiona(plano, T),
    JSON.stringify(plano.map(p => p.coverage)),
  );
  check(
    'cada lote fica com a configuração que o declarou',
    plano.length === 2 &&
      plano.every(p => {
        const declarado = [...((p.config as any).taskIds as string[])].sort().join('|');
        return declarado === [...p.coverage].sort().join('|');
      }),
  );
}

{
  const plano = planCoverageByCustomer(
    [{ customerId: CLIENTE_A }, { customerId: CLIENTE_B }],
    T,
    'JOINT',
  );
  check(
    'dois PAGADORES em JOINT continuam sendo dois — nenhum é descartado',
    plano.length === 2 && new Set(plano.map(p => p.config.customerId)).size === 2,
    JSON.stringify(plano.map(p => p.config.customerId)),
  );
  check(
    'e os dois cobrem os mesmos veículos (um Billing, dois pagadores)',
    plano.every(p => p.coverage.length === 4),
  );
}

{
  const plano = planCoverageByCustomer([{ customerId: CLIENTE_A }], T, 'PER_TASK');
  check('PER_TASK com um pagador rende uma fatia por veículo', plano.length === 4);
  check('e a partição continua valendo', particiona(plano, T));
}

{
  // Lote declarado parcialmente: o que ninguém reivindicou nasce sozinho, e
  // continua sendo partição.
  const plano = planCoverageByCustomer(
    [{ customerId: CLIENTE_A, taskIds: ['t1', 't2'] }],
    T,
    'CUSTOM',
  );
  check(
    'veículo não reivindicado nasce isolado, sem duplicar ninguém',
    plano.length === 3 && particiona(plano, T),
    JSON.stringify(plano.map(p => p.coverage)),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nA5 — "congelado" é UMA definição, não quatro');
// ═══════════════════════════════════════════════════════════════════════════
{
  check(
    'carimbo de aprovação congela',
    isBillingFrozen({ approvedAt: new Date(), status: 'APPROVED' }),
  );
  check(
    'LIQUIDADA SEM CARIMBO também congela (liquidação por conciliação bancária)',
    isBillingFrozen({ approvedAt: null, status: BILLING_STATUS.SETTLED }),
  );
  check(
    'VENCIDA sem carimbo congela',
    isBillingFrozen({ approvedAt: null, status: BILLING_STATUS.OVERDUE }),
  );
  check(
    'PARCIAL sem carimbo congela',
    isBillingFrozen({ approvedAt: null, status: BILLING_STATUS.PARTIAL }),
  );
  check(
    'PENDENTE sem carimbo NÃO congela',
    !isBillingFrozen({ approvedAt: null, status: BILLING_STATUS.PENDING }),
  );
  check(
    'CANCELADA não congela',
    !isBillingFrozen({ approvedAt: null, status: BILLING_STATUS.CANCELLED }),
  );
  check(
    'a trava do orçamento usa o mesmo predicado',
    isQuoteMoneyLocked([
      { approvedAt: null, status: BILLING_STATUS.PENDING },
      { approvedAt: null, status: BILLING_STATUS.SETTLED },
    ]) && !isQuoteMoneyLocked([{ approvedAt: null, status: BILLING_STATUS.PENDING }]),
  );
  check(
    'sem o include, a trava não acontece — e isso é documentado, não acidental',
    !isQuoteMoneyLocked(undefined) && !isQuoteMoneyLocked([]),
  );

  // A versão SQL tem de dizer a MESMA coisa que a versão em memória: mesma lista
  // de estados, mesma inclusão do carimbo. Uma divergência aqui é o defeito
  // voltando por outra porta.
  const estadosNoWhere = new Set<string>(
    (BILLING_FROZEN_WHERE.OR.find(o => 'status' in o) as any)?.status?.in ?? [],
  );
  const estadosNoPredicado = [
    BILLING_STATUS.APPROVED,
    BILLING_STATUS.PARTIAL,
    BILLING_STATUS.OVERDUE,
    BILLING_STATUS.SETTLED,
  ];
  check(
    'BILLING_FROZEN_WHERE enumera exatamente os estados do predicado',
    estadosNoWhere.size === estadosNoPredicado.length &&
      estadosNoPredicado.every(e => estadosNoWhere.has(e)),
    [...estadosNoWhere].join(', '),
  );
  check(
    'BILLING_FROZEN_WHERE também pega o carimbo',
    BILLING_FROZEN_WHERE.OR.some(o => 'approvedAt' in o),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nA2 — `taskId` não é campo do orçamento e não pode travar a tela');
// ═══════════════════════════════════════════════════════════════════════════
{
  const corpo = {
    taskId: '33333333-3333-4333-8333-333333333333',
    expiresAt: '2026-12-31T00:00:00.000Z',
  };
  const parsed = taskQuoteUpdateSchema.safeParse(corpo);
  check('o corpo com `taskId` continua sendo ACEITO (não é 400)', parsed.success);
  check(
    'mas `taskId` é DESCARTADO — `TaskQuote` não tem essa coluna',
    parsed.success && !('taskId' in parsed.data),
    parsed.success ? Object.keys(parsed.data).join(', ') : '',
  );
  check(
    'prorrogar a validade sobrevive — é o que a trava do dinheiro PERMITE',
    parsed.success && Object.keys(parsed.data).every(k => QUOTE_SAFE_AFTER_BILLING_FIELDS.has(k)),
  );
  // `taskIds` (plural) é lido e tem de continuar passando.
  const comTaskIds = taskQuoteUpdateSchema.safeParse({
    taskIds: ['33333333-3333-4333-8333-333333333333'],
  });
  check(
    '`taskIds` (plural), que é lido, continua passando',
    comTaskIds.success && Array.isArray((comTaskIds.data as any).taskIds),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nA3 — recompor lotes É alteração, e não pode virar "sucesso" mudo');
// ═══════════════════════════════════════════════════════════════════════════
{
  /** Como a fatia volta do banco: a cobertura mora em `billing.tasks`. */
  const gravado = (customerId: string, cobertura: string[]) => ({
    customerId,
    subtotal: 100,
    total: 100,
    discountType: 'NONE',
    billing: { tasks: cobertura.map(taskId => ({ taskId })) },
  });
  /** Como a tela manda: a cobertura vem em `taskIds`. */
  const enviado = (customerId: string, taskIds?: string[]) => ({
    customerId,
    subtotal: 100,
    total: 100,
    discountType: 'NONE',
    ...(taskIds ? { taskIds } : {}),
  });

  const doisLotes = [gravado(CLIENTE_A, ['t1', 't2']), gravado(CLIENTE_A, ['t3', 't4'])];

  check(
    'mover um caminhão de um lote para o outro É alteração material',
    svc.customerConfigsMateriallyChanged(doisLotes, [
      enviado(CLIENTE_A, ['t1', 't3']),
      enviado(CLIENTE_A, ['t2', 't4']),
    ]),
  );
  check(
    'reenviar os MESMOS lotes não é alteração (o save idempotente da tela)',
    !svc.customerConfigsMateriallyChanged(doisLotes, [
      enviado(CLIENTE_A, ['t3', 't4']),
      enviado(CLIENTE_A, ['t1', 't2']),
    ]),
  );
  check(
    'a ordem dentro do lote não conta — conjunto, não lista',
    !svc.customerConfigsMateriallyChanged(doisLotes, [
      enviado(CLIENTE_A, ['t2', 't1']),
      enviado(CLIENTE_A, ['t4', 't3']),
    ]),
  );
  check(
    'NÃO declarar cobertura continua significando "decida pelo modo", nunca "mudou"',
    !svc.customerConfigsMateriallyChanged(doisLotes, [enviado(CLIENTE_A), enviado(CLIENTE_A)]),
  );
  check(
    'sem a cobertura gravada na consulta, não se inventa mudança',
    !svc.customerConfigsMateriallyChanged(
      [
        { customerId: CLIENTE_A, subtotal: 100, total: 100, discountType: 'NONE' },
        { customerId: CLIENTE_A, subtotal: 100, total: 100, discountType: 'NONE' },
      ],
      [enviado(CLIENTE_A, ['t1', 't3']), enviado(CLIENTE_A, ['t2', 't4'])],
    ),
  );
  check(
    'mudar o número de lotes continua sendo detectado pela contagem',
    svc.customerConfigsMateriallyChanged(doisLotes, [enviado(CLIENTE_A, ['t1', 't2', 't3', 't4'])]),
  );
  check(
    'mudar o desconto continua sendo detectado (a regra antiga não regrediu)',
    svc.customerConfigsMateriallyChanged(doisLotes, [
      { ...enviado(CLIENTE_A, ['t1', 't2']), discountType: 'PERCENTAGE', discountValue: 10 },
      enviado(CLIENTE_A, ['t3', 't4']),
    ]),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nA2 (serviço) — chave fantasma não entra no diff');
// ═══════════════════════════════════════════════════════════════════════════
{
  // Rede para além do zod: se um dia outra chave inexistente chegar pelo caminho
  // aninhado (PUT /tasks/:id), ela não pode virar "alteração" e bater na trava.
  const filtrado = svc.filterToMaterialChanges(
    { customerConfigs: [], services: [], expiresAt: new Date('2026-12-31T00:00:00.000Z') },
    { taskId: 'qualquer-coisa', expiresAt: new Date('2027-01-31T00:00:00.000Z') },
  );
  check('`taskId` não sobrevive ao filtro', !('taskId' in filtrado));
  check('e `expiresAt`, que mudou de verdade, sobrevive', 'expiresAt' in filtrado);

  const semMudanca = svc.filterToMaterialChanges(
    { customerConfigs: [], services: [], expiresAt: new Date('2026-12-31T00:00:00.000Z') },
    { taskId: 'qualquer-coisa' },
  );
  check(
    'um corpo que SÓ traz `taskId` vira "nenhuma alteração", não um 400',
    Object.keys(semMudanca).length === 0,
    JSON.stringify(semMudanca),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nA13 — campo aceito e nunca lido é pior que campo recusado');
// ═══════════════════════════════════════════════════════════════════════════
{
  const parsed = taskQuoteCustomerConfigCreateNestedSchema.safeParse({
    customerId: CLIENTE_A,
    installments: [{ number: 1, dueDate: '2026-12-31', amount: 100 }],
  });
  check('o pagador com `installments` continua sendo aceito', parsed.success);
  check(
    '`installments` é descartado — ninguém o lia, e o 200 mentia',
    parsed.success && !('installments' in (parsed.data as any)),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nA15 — reverter para um estado que não existe mais');
// ═══════════════════════════════════════════════════════════════════════════
{
  // O `ChangeLog` guarda 468 linhas com estes valores. São histórico legítimo —
  // o que não pode é o reverter mandá-los para uma coluna enum.
  const mortos = [
    'BUDGET_APPROVED',
    'BILLING_APPROVED',
    'COMMERCIAL_APPROVED',
    'DRAFT',
    'UPCOMING',
    'DUE',
    'PARTIAL',
  ];
  check(
    'nenhum dos estados históricos está no enum vivo',
    mortos.every(m => !(m in TASK_QUOTE_STATUS_ORDER)),
    mortos.filter(m => m in TASK_QUOTE_STATUS_ORDER).join(', '),
  );
  check(
    'os vivos continuam no mapa (a guarda não pode recusar o que é válido)',
    ['PENDING', 'SIGNED', 'APPROVED', 'EXPIRED', 'CANCELLED'].every(
      v => v in TASK_QUOTE_STATUS_ORDER,
    ),
  );
  check(
    'e o espelho numérico nunca é `undefined` para um estado vivo',
    ['PENDING', 'SIGNED', 'APPROVED', 'EXPIRED', 'CANCELLED'].every(
      v => typeof (TASK_QUOTE_STATUS_ORDER as any)[v] === 'number',
    ),
  );
}

console.log(
  failures === 0 ? '\n✅ Tudo certo.\n' : `\n❌ ${failures} verificação(ões) falharam.\n`,
);
process.exit(failures === 0 ? 0 : 1);
