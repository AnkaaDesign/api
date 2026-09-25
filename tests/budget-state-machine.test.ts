/**
 * A MÁQUINA DO ORÇAMENTO NO MODELO C (P14, PLANO §2A) — o eixo do VALOR.
 *
 * `npm run test:budget-state-machine`
 *
 * O QUE ESTE ARQUIVO PROVA
 *   · G26: o grafo em DUAS tabelas (manuais × sistema) é o que o validador do
 *     serviço responde, par a par, e é o que sai no contrato gerado.
 *   · G31: as listas positivas do enum são DERIVADAS dele (o zod não apaga um
 *     estado do filtro); `PRE_APPROVED` não existe mais.
 *   · D-34: o servidor decide o nascimento (o corpo pede APPROVED, nasce PENDING).
 *   · Os ATOS (§2A.5): enviar ao cliente, retirar, aprovar em nome dele (nota
 *     obrigatória), reprovar (motivo obrigatório), o app antigo (LEGACY_APP), o
 *     portal (PORTAL, contato como ator), e o `/status` delegando (X7: o
 *     FINANCIAL não aprova valor).
 *   · D-27/DD8: a `BudgetValueApproval` vigente acompanha o status — nasce ao
 *     entrar em APPROVED, fecha ao sair (auto-revert, reprovação, cancelamento);
 *     com o status FIXADO o valor editado continua APROVADO e o registro vigente.
 *
 * Banco de TESTE com ao menos um cliente e um usuário ADMIN. Tudo o que o teste
 * cria sai no fim (tests/helpers/budget-fixture.ts).
 */
process.env.TZ = 'America/Sao_Paulo';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';
import { TaskService } from '../src/modules/production/task/task.service';
import { BudgetService } from '../src/modules/production/budget/budget.service';
import { taskBatchCreateWithQuoteSchema } from '../src/schemas/task';
import { budgetStatusSchema } from '../src/schemas/budget';
import { TASK_QUOTE_STATUS, BUDGET_VALUE_APPROVAL_SOURCE } from '../src/constants/enums';
import { TASK_QUOTE_STATUS_ORDER } from '../src/constants/sortOrders';
import { TASK_QUOTE_STATUS_LABELS } from '../src/constants/enum-labels';
import {
  BUDGET_MANUAL_TRANSITIONS,
  BUDGET_SYSTEM_TRANSITIONS,
} from '../src/modules/production/budget/budget-transitions';
import { buildContracts } from '../scripts/export-contracts';
import { readFileSync } from 'fs';
import { join } from 'path';
import { cleanup, mkQuote, newCreated } from './helpers/budget-fixture';

let failures = 0;
let passes = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
async function rejects(p: Promise<unknown>, status: number, fragment?: string): Promise<string | null> {
  try {
    await p;
    return 'não recusou';
  } catch (e: any) {
    const got = e?.status ?? e?.getStatus?.();
    const msg = String(e?.response?.message ?? e?.message ?? e);
    if (got !== status) return `status ${got}: ${msg}`;
    if (fragment && !msg.includes(fragment)) return msg;
    return null;
  }
}

const ALL = Object.values(TASK_QUOTE_STATUS) as TASK_QUOTE_STATUS[];

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nG31 — o enum do valor no Modelo C, e as listas DERIVADAS dele');
  // ═══════════════════════════════════════════════════════════════════════════
  check('PRE_APPROVED saiu do enum (nunca foi a produção)', !ALL.includes('PRE_APPROVED' as any));
  check(
    'os sete valores do alvo',
    ['REQUESTED', 'EXPIRED', 'PENDING', 'IN_NEGOTIATION', 'APPROVED', 'SIGNED', 'CANCELLED'].every(v =>
      ALL.includes(v as any),
    ) && ALL.length === 7,
    ALL.join(','),
  );
  check(
    'o zod do status aceita TODO valor do enum (nenhum some do filtro)',
    ALL.every(v => budgetStatusSchema.safeParse(v).success),
  );
  check('e recusa PRE_APPROVED', !budgetStatusSchema.safeParse('PRE_APPROVED').success);
  check(
    'a ordem cobre todo valor, sem 0',
    ALL.every(v => typeof TASK_QUOTE_STATUS_ORDER[v] === 'number' && TASK_QUOTE_STATUS_ORDER[v] > 0),
  );
  check(
    'a ordem do Modelo C (REQUESTED 1 … PENDING 3 … CANCELLED 6)',
    TASK_QUOTE_STATUS_ORDER.REQUESTED === 1 &&
      TASK_QUOTE_STATUS_ORDER.EXPIRED === 2 &&
      TASK_QUOTE_STATUS_ORDER.PENDING === 3 &&
      TASK_QUOTE_STATUS_ORDER.IN_NEGOTIATION === 4 &&
      TASK_QUOTE_STATUS_ORDER.APPROVED === 5 &&
      TASK_QUOTE_STATUS_ORDER.SIGNED === 5 &&
      TASK_QUOTE_STATUS_ORDER.CANCELLED === 6,
  );
  check('PENDING volta a ser "Pendente" (X2)', TASK_QUOTE_STATUS_LABELS.PENDING === 'Pendente');
  check(
    'IN_NEGOTIATION é "Aguardando aprovação do cliente" (pergunta 12)',
    TASK_QUOTE_STATUS_LABELS.IN_NEGOTIATION === 'Aguardando aprovação do cliente',
  );
  const schemaPrisma = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  check(
    'statusOrder @default(3) no Prisma (X8: schema e banco concordam)',
    /status\s+BudgetStatus @default\(PENDING\)[\s\S]{0,200}?statusOrder Int\s+@default\(3\)/.test(schemaPrisma),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nG26 — o grafo em duas tabelas: validador × tabela × contrato');
  // ═══════════════════════════════════════════════════════════════════════════
  const validate = (BudgetService.prototype as any).validateStatusTransition as (
    a: string,
    b: string,
  ) => void;
  const system = (BudgetService.prototype as any).assertTransitionAllowed as (a: string, b: string) => void;
  const ok = (fn: any, a: string, b: string) => {
    try {
      fn.call({}, a, b);
      return true;
    } catch {
      return false;
    }
  };
  let manualDiverge = 0;
  let systemDiverge = 0;
  for (const from of ALL) {
    for (const to of ALL) {
      if (from === to) continue;
      if (ok(validate, from, to) !== BUDGET_MANUAL_TRANSITIONS[from].includes(to)) manualDiverge++;
      if (ok(system, from, to) !== BUDGET_SYSTEM_TRANSITIONS[from].includes(to)) systemDiverge++;
    }
  }
  check('o validador MANUAL responde exatamente a tabela manual (49 pares)', manualDiverge === 0, String(manualDiverge));
  check('o validador de SISTEMA responde exatamente a tabela de sistema', systemDiverge === 0, String(systemDiverge));
  const contracts: any = buildContracts();
  const orc = contracts.enums.orcamento;
  check(
    'o contrato exporta as manuais iguais à tabela',
    ALL.every(
      s =>
        JSON.stringify([...(orc.transicoesManuais[s] ?? [])].sort()) ===
        JSON.stringify([...BUDGET_MANUAL_TRANSITIONS[s]].sort()),
    ),
  );
  check(
    'e as de sistema iguais à tabela',
    ALL.every(
      s =>
        JSON.stringify([...(orc.transicoesDoSistema[s] ?? [])].sort()) ===
        JSON.stringify([...BUDGET_SYSTEM_TRANSITIONS[s]].sort()),
    ),
  );
  check(
    'nenhuma aresta manual leva a EXPIRED (é o relógio da coleta legada, não um botão)',
    ALL.every(s => !BUDGET_MANUAL_TRANSITIONS[s].includes(TASK_QUOTE_STATUS.EXPIRED)),
  );
  check(
    'SIGNED (legado) não é destino de nenhuma aresta',
    ALL.every(
      s =>
        !BUDGET_MANUAL_TRANSITIONS[s].includes(TASK_QUOTE_STATUS.SIGNED) &&
        !BUDGET_SYSTEM_TRANSITIONS[s].includes(TASK_QUOTE_STATUS.SIGNED),
    ),
  );
  check(
    'a reativação nunca ressuscita APPROVED (volta a PENDING)',
    !BUDGET_SYSTEM_TRANSITIONS.CANCELLED.includes(TASK_QUOTE_STATUS.APPROVED),
  );
  check('CANCELLED é terminal para o operador', BUDGET_MANUAL_TRANSITIONS.CANCELLED.length === 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // COM BANCO
  // ═══════════════════════════════════════════════════════════════════════════
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService) as any;
  const tasks = app.get(TaskService);
  const budgets = app.get(BudgetService);
  const created = newCreated();
  const deps = { prisma, tasks, schema: taskBatchCreateWithQuoteSchema as any };

  try {
    const customer = await prisma.customer.findFirst({ select: { id: true } });
    const admin = await prisma.user.findFirst({
      where: { sector: { privileges: 'ADMIN' } },
      select: { id: true },
    });
    if (!customer || !admin) {
      check('banco com cliente e usuário ADMIN', false);
      return;
    }
    const vigentes = (quoteId: string) =>
      prisma.budgetValueApproval.findMany({ where: { budgetId: quoteId, revokedAt: null } });
    const statusOf = async (quoteId: string) =>
      (await prisma.budget.findUnique({ where: { id: quoteId }, select: { status: true } }))?.status;

    // ═════════════════════════════════════════════════════════════════════════
    console.log('\nD-34 — o servidor decide o nascimento');
    // ═════════════════════════════════════════════════════════════════════════
    const q1 = await mkQuote(deps, created, {
      tag: 'NASC',
      customerId: customer.id,
      userId: admin.id,
      status: 'APPROVED',
    });
    const nasc = await prisma.budget.findUnique({
      where: { id: q1.quoteId },
      select: { status: true, statusOrder: true, signatureStatus: true },
    });
    check('o corpo pediu APPROVED e o orçamento nasce PENDING', nasc.status === 'PENDING', nasc.status);
    check('com a ordem da tabela (3)', nasc.statusOrder === 3, String(nasc.statusOrder));
    check('e a assinatura "Não emitida"', nasc.signatureStatus === 'NOT_ISSUED');
    check('nenhuma aprovação de valor nasce junto', (await vigentes(q1.quoteId)).length === 0);

    // ═════════════════════════════════════════════════════════════════════════
    console.log('\nOS ATOS — enviar, retirar, aprovar em nome do cliente (nota), reprovar (motivo)');
    // ═════════════════════════════════════════════════════════════════════════
    await budgets.sendToCustomer(q1.quoteId, admin.id);
    check('enviar ao cliente: PENDING → IN_NEGOTIATION', (await statusOf(q1.quoteId)) === 'IN_NEGOTIATION');
    await budgets.withdrawFromCustomer(q1.quoteId, admin.id);
    check('retirar do cliente: IN_NEGOTIATION → PENDING', (await statusOf(q1.quoteId)) === 'PENDING');
    let err = await rejects(budgets.withdrawFromCustomer(q1.quoteId, admin.id), 400);
    check('retirar de PENDING ⇒ 400', err === null, err ?? '');

    err = await rejects(
      budgets.approveValue(q1.quoteId, { userId: admin.id, note: '  ', source: BUDGET_VALUE_APPROVAL_SOURCE.ON_BEHALF }),
      400,
      'nota',
    );
    check('aprovar em nome do cliente SEM nota ⇒ 400', err === null, err ?? '');
    err = await rejects(budgets.updateStatus(q1.quoteId, TASK_QUOTE_STATUS.APPROVED, admin.id, undefined, 'FINANCIAL'), 403);
    check('X7: o FINANCIAL não aprova valor pelo /status', err === null, err ?? '');
    err = await rejects(
      budgets.update(q1.quoteId, { status: TASK_QUOTE_STATUS.APPROVED } as any, admin.id, false, 'ADMIN'),
      400,
      'value-approval',
    );
    check('a gravação genérica não chega a APPROVED (aprovar é ato com nota)', err === null, err ?? '');

    await budgets.updateStatus(q1.quoteId, TASK_QUOTE_STATUS.APPROVED, admin.id, 'Aprovado por e-mail em 25/09', 'COMMERCIAL');
    check('/status {APPROVED, reason} delega ao ato: APPROVED', (await statusOf(q1.quoteId)) === 'APPROVED');
    let v = await vigentes(q1.quoteId);
    check(
      'nasce UMA aprovação vigente ON_BEHALF, com a nota e o total',
      v.length === 1 &&
        v[0].source === 'ON_BEHALF' &&
        v[0].note === 'Aprovado por e-mail em 25/09' &&
        v[0].userId === admin.id &&
        v[0].responsibleId === null &&
        Number(v[0].total) === 100,
      JSON.stringify(v),
    );

    err = await rejects(budgets.revokeValueApproval(q1.quoteId, admin.id, ''), 400, 'motivo');
    check('reprovar SEM motivo ⇒ 400', err === null, err ?? '');
    await budgets.revokeValueApproval(q1.quoteId, admin.id, 'o cliente pediu desconto');
    check('reprovar: APPROVED → PENDING', (await statusOf(q1.quoteId)) === 'PENDING');
    const fechada = await prisma.budgetValueApproval.findFirst({ where: { budgetId: q1.quoteId } });
    check(
      'a aprovação FECHA com o motivo (DD8)',
      !!fechada?.revokedAt && /Reprovado: o cliente pediu desconto/.test(fechada?.revokedReason ?? ''),
      JSON.stringify(fechada),
    );

    await budgets.budgetApprove(q1.quoteId, admin.id);
    v = await vigentes(q1.quoteId);
    check(
      '/budget-approve sem nota (app antigo) ⇒ LEGACY_APP com a nota automática (D-36)',
      (await statusOf(q1.quoteId)) === 'APPROVED' &&
        v.length === 1 &&
        v[0].source === 'LEGACY_APP' &&
        /app antigo/.test(v[0].note ?? ''),
      JSON.stringify(v),
    );

    // ═════════════════════════════════════════════════════════════════════════
    console.log('\nDD8 — editar o valor depois de aprovado: como hoje');
    // ═════════════════════════════════════════════════════════════════════════
    await budgets.update(
      q1.quoteId,
      { services: [{ description: 'Logomarca Lateral', amount: 150 }] } as any,
      admin.id,
      false,
      'ADMIN',
    );
    check('valor mudou SEM status fixado ⇒ volta a PENDING (auto-revert)', (await statusOf(q1.quoteId)) === 'PENDING');
    check('e a aprovação vigente fecha', (await vigentes(q1.quoteId)).length === 0);
    const auto = await prisma.budgetValueApproval.findFirst({
      where: { budgetId: q1.quoteId, source: 'LEGACY_APP' },
    });
    check('com o motivo "Valor alterado"', /Valor alterado/.test(auto?.revokedReason ?? ''), auto?.revokedReason ?? '');

    await budgets.approveValue(q1.quoteId, { userId: admin.id, note: 'reaprovado por telefone', source: BUDGET_VALUE_APPROVAL_SOURCE.ON_BEHALF });
    await budgets.update(
      q1.quoteId,
      { status: TASK_QUOTE_STATUS.APPROVED, services: [{ description: 'Logomarca Lateral', amount: 180 }] } as any,
      admin.id,
      false,
      'ADMIN',
    );
    check('com o status FIXADO em APPROVED o valor editado continua APROVADO', (await statusOf(q1.quoteId)) === 'APPROVED');
    v = await vigentes(q1.quoteId);
    check('e o registro continua vigente', v.length === 1 && v[0].note === 'reaprovado por telefone');

    // ═════════════════════════════════════════════════════════════════════════
    console.log('\nO PORTAL — o cliente aprova ou recusa (arestas de SISTEMA)');
    // ═════════════════════════════════════════════════════════════════════════
    const q2 = await mkQuote(deps, created, { tag: 'PORTAL', customerId: customer.id, userId: admin.id });
    err = await rejects(budgets.applyPortalDecision(q2.quoteId, 'APPROVE_VALUE', q2.responsibleId, null), 400);
    check('o portal não aprova um orçamento que não está com o cliente', err === null, err ?? '');
    await budgets.sendToCustomer(q2.quoteId, admin.id);
    await budgets.applyPortalDecision(q2.quoteId, 'REFUSE', q2.responsibleId, 'caro demais');
    check('recusa do cliente: IN_NEGOTIATION → PENDING', (await statusOf(q2.quoteId)) === 'PENDING');
    await budgets.sendToCustomer(q2.quoteId, admin.id);
    await budgets.applyPortalDecision(q2.quoteId, 'APPROVE_VALUE', q2.responsibleId, null);
    check('aprovação do cliente: IN_NEGOTIATION → APPROVED', (await statusOf(q2.quoteId)) === 'APPROVED');
    v = await vigentes(q2.quoteId);
    check(
      'BudgetValueApproval{PORTAL} com o CONTATO como ator — nunca em FK de User',
      v.length === 1 && v[0].source === 'PORTAL' && v[0].responsibleId === q2.responsibleId && v[0].userId === null,
      JSON.stringify(v),
    );
    const log = await prisma.changeLog.findFirst({
      where: { entityId: q2.quoteId, field: 'status', newValue: { equals: 'APPROVED' } as any },
      orderBy: { createdAt: 'desc' },
    });
    check('a trilha do status não tem funcionário (sentinela → null)', !log || log.userId === null, log?.userId ?? '');

    // ═════════════════════════════════════════════════════════════════════════
    console.log('\nCancelar fecha a aprovação vigente');
    // ═════════════════════════════════════════════════════════════════════════
    // O cancelamento pelo `/status` desce por `cancelForTaskCancellation`, que só
    // desmonta quando não sobra veículo ativo — o veículo sai primeiro.
    await prisma.task.update({ where: { id: q2.taskId }, data: { status: 'CANCELLED' } });
    await budgets.updateStatus(q2.quoteId, TASK_QUOTE_STATUS.CANCELLED, admin.id, 'o cliente desistiu', 'ADMIN');
    check('CANCELLED', (await statusOf(q2.quoteId)) === 'CANCELLED');
    check('e nenhuma aprovação vigente sobra', (await vigentes(q2.quoteId)).length === 0);
  } finally {
    await cleanup(prisma, created);
    await app.close();
  }

  console.log(
    `\n${failures === 0 ? `✅ máquina do orçamento: ${passes} verificações passaram.` : `❌ ${failures} verificação(ões) falharam (${passes} passaram).`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('❌ O teste estourou:', e?.message ?? e);
  process.exit(1);
});
