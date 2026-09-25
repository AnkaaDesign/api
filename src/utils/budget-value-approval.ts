// A APROVAÇÃO DO VALOR — o registro que acompanha `Budget.status = APPROVED` (D-27, DD8).
//
// `BudgetValueApproval` é REGISTRO, não autoridade: quem responde "o valor
// mudou?" continua sendo o auto-revert de hoje (`hasValueAffectingChange` em
// `budget.service.ts` e o gêmeo em `task.service.ts`), que devolve o orçamento a
// PENDING — salvo quando o chamador fixa o status (DD8). O registro só ACOMPANHA:
//
//   · entrou em APPROVED  → nasce uma aprovação vigente (quem, quando, como,
//     com que nota e sobre que total);
//   · saiu de APPROVED    → a vigente é fechada (`revokedAt` + motivo), e um
//     "Assinado fora do sistema" vigente cai junto: eixo `SIGNED_OFFLINE →
//     INVALIDATED` e o `BudgetOfflineSignature` fechado (DD11).
//
// ⛔ POR QUE UMA FUNÇÃO DE RECONCILIAÇÃO E NÃO UM "AO SAIR" EM CADA ESCRITOR.
// O status do orçamento tem SETE escritores fora do `BudgetService.update`: a
// escrita aninhada da tarefa, o cancelamento pela tarefa (dois ramos na O.S.,
// um na tarefa), a união de orçamentos, a reativação pela O.S. comercial e o
// desmonte do cancelamento. Um gancho "ao sair de APPROVED" escrito sete vezes
// é esquecido na oitava. `syncValueApprovalWithStatus` olha o estado GRAVADO e
// faz o registro concordar com ele — idempotente, e chamável por qualquer um
// dentro da própria transação.
import type { Prisma } from '@prisma/client';
import {
  BUDGET_SIGNATURE_STATUS,
  BUDGET_VALUE_APPROVAL_SOURCE,
  TASK_QUOTE_STATUS,
} from '../constants/enums';

type Tx = Prisma.TransactionClient;

/** Uma linha da trilha que a reconciliação quer escrever (o chamador tem o `ChangeLogService`). */
export interface ValueApprovalLogEntry {
  field: 'signatureStatus';
  oldValue: string;
  newValue: string;
  reason: string;
}

/** A nota automática do app antigo (D-36): aprovou sem nota. */
export const LEGACY_APP_APPROVAL_NOTE = 'Aprovado pelo app antigo, sem nota.';

/**
 * Registra uma aprovação do valor e a torna a VIGENTE.
 *
 * Fecha a vigente anterior, se houver ("substituída"): uma aprovação por vez.
 * `total` é o do orçamento no instante do ato — é o número que o portal e o
 * documento mostram como "aprovado", e não muda se o total mudar depois (aí o
 * auto-revert já tirou o orçamento de APPROVED e fechou este registro).
 */
export async function recordValueApproval(
  tx: Tx,
  args: {
    budgetId: string;
    source: BUDGET_VALUE_APPROVAL_SOURCE;
    userId?: string | null;
    responsibleId?: string | null;
    note?: string | null;
    decidedAt?: Date;
  },
): Promise<{ id: string }> {
  const at = args.decidedAt ?? new Date();
  await tx.budgetValueApproval.updateMany({
    where: { budgetId: args.budgetId, revokedAt: null },
    data: { revokedAt: at, revokedReason: 'Substituída por uma nova aprovação do valor.' },
  });
  const budget = await tx.budget.findUnique({
    where: { id: args.budgetId },
    select: { total: true },
  });
  const note = args.note?.trim() || null;
  return tx.budgetValueApproval.create({
    data: {
      budgetId: args.budgetId,
      source: args.source as any,
      // Ator DISCRIMINADO (CHECK `BudgetValueApproval_actor_check`): contato do
      // cliente OU usuário, nunca os dois — e nunca id de contato em FK de User.
      responsibleId: args.responsibleId ?? null,
      userId: args.responsibleId ? null : (args.userId ?? null),
      note,
      total: budget?.total ?? null,
      decidedAt: at,
    },
    select: { id: true },
  });
}

/**
 * Faz o registro concordar com o status GRAVADO. Idempotente.
 *
 * - status ≠ APPROVED: fecha a aprovação vigente e derruba o "assinado fora do
 *   sistema" vigente (eixo → INVALIDATED). Devolve as linhas de trilha do eixo
 *   para o chamador gravar com o `ChangeLogService` dele, na mesma transação.
 * - status = APPROVED sem aprovação vigente e com `approvedFallback`: registra
 *   (é o caminho de quem escreve APPROVED por fora dos atos — a gravação
 *   aninhada da tarefa, por exemplo). Sem `approvedFallback`, não inventa.
 */
export async function syncValueApprovalWithStatus(
  tx: Tx,
  budgetId: string,
  opts: {
    /** Por que o orçamento saiu de APPROVED ("valor alterado", "reprovado: …", "cancelado"). */
    leftReason: string;
    approvedFallback?: {
      source: BUDGET_VALUE_APPROVAL_SOURCE;
      userId?: string | null;
      responsibleId?: string | null;
      note?: string | null;
    };
  },
): Promise<{ closed: number; created: boolean; log: ValueApprovalLogEntry[] }> {
  const budget = await tx.budget.findUnique({
    where: { id: budgetId },
    select: { status: true, signatureStatus: true },
  });
  const log: ValueApprovalLogEntry[] = [];
  if (!budget) return { closed: 0, created: false, log };

  if (budget.status !== TASK_QUOTE_STATUS.APPROVED) {
    const at = new Date();
    const closed = await tx.budgetValueApproval.updateMany({
      where: { budgetId, revokedAt: null },
      data: { revokedAt: at, revokedReason: opts.leftReason },
    });
    if (budget.signatureStatus === BUDGET_SIGNATURE_STATUS.SIGNED_OFFLINE) {
      await tx.budgetOfflineSignature.updateMany({
        where: { budgetId, revokedAt: null },
        data: { revokedAt: at, revokedReason: opts.leftReason },
      });
      const moved = await tx.budget.updateMany({
        where: { id: budgetId, signatureStatus: BUDGET_SIGNATURE_STATUS.SIGNED_OFFLINE as any },
        data: { signatureStatus: BUDGET_SIGNATURE_STATUS.INVALIDATED as any },
      });
      if (moved.count > 0) {
        log.push({
          field: 'signatureStatus',
          oldValue: BUDGET_SIGNATURE_STATUS.SIGNED_OFFLINE,
          newValue: BUDGET_SIGNATURE_STATUS.INVALIDATED,
          reason: `Assinatura fora do sistema invalidada — ${opts.leftReason}`,
        });
      }
    }
    return { closed: closed.count, created: false, log };
  }

  if (opts.approvedFallback) {
    const vigente = await tx.budgetValueApproval.findFirst({
      where: { budgetId, revokedAt: null },
      select: { id: true },
    });
    if (!vigente) {
      await recordValueApproval(tx, { budgetId, ...opts.approvedFallback });
      return { closed: 0, created: true, log };
    }
  }
  return { closed: 0, created: false, log };
}

/** A aprovação vigente, na forma da leitura (`valueApproval` do detalhe e do portal). */
export async function currentValueApproval(
  client: Tx,
  budgetId: string,
): Promise<{
  at: Date;
  source: string;
  by: { name: string } | null;
  note: string | null;
  total: number | null;
  current: true;
} | null> {
  const row = await client.budgetValueApproval.findFirst({
    where: { budgetId, revokedAt: null },
    orderBy: { decidedAt: 'desc' },
    select: {
      decidedAt: true,
      source: true,
      note: true,
      total: true,
      user: { select: { name: true } },
      responsible: { select: { name: true } },
    },
  });
  if (!row) return null;
  const by = row.responsible?.name ?? row.user?.name ?? null;
  return {
    at: row.decidedAt,
    source: row.source,
    by: by ? { name: by } : null,
    note: row.note,
    total: row.total !== null && row.total !== undefined ? Number(row.total) : null,
    current: true,
  };
}

/**
 * `syncValueApprovalWithStatus` + a trilha, para os escritores de status que não
 * passam pelo `BudgetService.update` (cancelamento pela tarefa e pela O.S., união
 * de orçamentos, reativação, gravação aninhada da tarefa). Na transação deles.
 */
export async function syncValueApprovalAndLog(
  tx: Tx,
  changeLogs: { logChange(params: any): Promise<void> },
  budgetId: string,
  opts: Parameters<typeof syncValueApprovalWithStatus>[2] & { userId?: string | null },
): Promise<void> {
  const sync = await syncValueApprovalWithStatus(tx, budgetId, opts);
  for (const entry of sync.log) {
    await changeLogs.logChange({
      entityType: 'TASK_QUOTE',
      entityId: budgetId,
      action: 'UPDATE',
      field: entry.field,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      reason: entry.reason,
      triggeredBy: 'SYSTEM_GENERATED',
      triggeredById: opts.userId ?? null,
      userId: opts.userId ?? null,
      transaction: tx,
    });
  }
}
