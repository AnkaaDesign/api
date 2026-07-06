import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_TYPE,
  TASK_QUOTE_STATUS,
} from '../constants/enums';
import { SERVICE_ORDER_STATUS_ORDER } from '../constants/sortOrders';
import { calculateWorkingSeconds } from './working-hours';

type PrismaContext = Prisma.TransactionClient | { layout: any; serviceOrder: any; task: any };

const logger = new Logger('EmNegociacaoSync');

/**
 * Event emitter registered once at bootstrap (ServiceOrderService constructor).
 * This util is a plain function called from many layers (task-quote, invoice,
 * layout listeners, …) that mostly lack an EventEmitter2 — registering the
 * shared instance here lets every auto-transition emit the same
 * 'service_order.status.changed' event the manual SO update path emits, so
 * service_order.waiting_layout/completed/pending notifications actually fire.
 */
type EmitterLike = { emit: (event: string, payload: unknown) => unknown };
let registeredEventEmitter: EmitterLike | null = null;

export function registerEmNegociacaoEventEmitter(emitter: EmitterLike): void {
  registeredEventEmitter = emitter;
}

const EM_NEGOCIACAO_DESC = 'em negociação';

const STATUSES_AT_OR_ABOVE_BUDGET_APPROVED: TASK_QUOTE_STATUS[] = [
  TASK_QUOTE_STATUS.BUDGET_APPROVED,
  TASK_QUOTE_STATUS.BILLING_APPROVED,
  TASK_QUOTE_STATUS.UPCOMING,
  TASK_QUOTE_STATUS.DUE,
  TASK_QUOTE_STATUS.PARTIAL,
  TASK_QUOTE_STATUS.SETTLED,
];

/**
 * Reconcile the "Em Negociação" COMMERCIAL ServiceOrder for a task to match
 * the current quote/layout state. Idempotent and safe to call from any
 * status-changing flow (budget/commercial approval, layout create/approve/
 * reprove/delete, quote revert, …).
 *
 * Target state derivation (only applied when current SO status is IN_PROGRESS,
 * WAITING_ARTWORK, or COMPLETED — manual PAUSED/CANCELLED are respected):
 *
 *   ┌───────────────────────────────┬─────────────────────────────────────────┐
 *   │ Quote / task state            │ Target Em Negociação status             │
 *   ├───────────────────────────────┼─────────────────────────────────────────┤
 *   │ < BUDGET_APPROVED             │ IN_PROGRESS                             │
 *   │ ≥ BUDGET_APPROVED + has any   │ COMPLETED  (commercial handed off       │
 *   │   Layout record (any status) │             — layout team owns it now) │
 *   │ ≥ BUDGET_APPROVED + no        │ WAITING_ARTWORK                         │
 *   │   Layout record +            │                                         │
 *   │   any ARTWORK-type SO         │                                         │
 *   │ ≥ BUDGET_APPROVED +           │ COMPLETED  (service-only — no layout   │
 *   │   no ARTWORK-type SO          │             ever needed)                │
 *   └───────────────────────────────┴─────────────────────────────────────────┘
 *
 * Why "any Layout record" instead of "APPROVED only": commercial's job ends
 * when the layout team has something to work on. The layout's own approval
 * cycle is tracked by the ARTWORK-type SOs (Elaborar Layout etc.), not here.
 *
 * "Em Negociação" is matched by description (case-insensitive trim) on the
 * COMMERCIAL-type SO. Tasks may have additional COMMERCIAL SOs (follow-ups,
 * after-sales, etc.) — those are never touched here.
 */
export async function syncEmNegociacaoForTask(
  prisma: PrismaContext,
  taskId: string,
  userId?: string | null,
): Promise<void> {
  try {
    const task = await (prisma as any).task.findUnique({
      where: { id: taskId },
      include: {
        // A quote layout file also counts as an "artwork" for handoff purposes —
        // it's the rendered layout uploaded via the budget editor.
        quote: {
          select: { status: true, layoutFiles: { select: { id: true }, take: 1 } },
        },
        serviceOrders: {
          select: {
            id: true,
            description: true,
            status: true,
            type: true,
            startedAt: true,
            lastStartedAt: true,
            totalActiveTimeSeconds: true,
          },
        },
        layouts: { select: { id: true, status: true } },
      },
    });

    if (!task) return;

    const allServiceOrders = task.serviceOrders || [];
    const emNegociacao = allServiceOrders.find(
      (so: any) =>
        so.type === SERVICE_ORDER_TYPE.COMMERCIAL &&
        (so.description ?? '').toLowerCase().trim() === EM_NEGOCIACAO_DESC,
    ) as any;
    if (!emNegociacao) return; // task without the default SO — nothing to sync

    // Respect manual control states
    const RESPECT_MANUAL: SERVICE_ORDER_STATUS[] = [
      SERVICE_ORDER_STATUS.PAUSED,
      SERVICE_ORDER_STATUS.CANCELLED,
    ];
    if (RESPECT_MANUAL.includes(emNegociacao.status as SERVICE_ORDER_STATUS)) {
      return;
    }

    const quoteStatus = task.quote?.status as TASK_QUOTE_STATUS | undefined;
    // A cancelled quote/task is terminal: never reopen or re-drive the Em
    // Negociação SO. Without this, a direct task cancellation (which sets the
    // quote to CANCELLED but does not cancel the commercial SO) would fall
    // through to the !quoteAtOrAbove branch and reactivate a COMPLETED SO to
    // IN_PROGRESS, emitting a bogus "started.commercial" notification on a
    // cancelled task. The auto-cancel path already cancels the SO (handled by
    // the RESPECT_MANUAL guard above), so this only affects direct cancels.
    if (quoteStatus === TASK_QUOTE_STATUS.CANCELLED) return;
    const quoteAtOrAbove =
      !!quoteStatus &&
      STATUSES_AT_OR_ABOVE_BUDGET_APPROVED.includes(quoteStatus);

    const layouts = task.layouts || [];
    // Any layout on the task (DRAFT/APPROVED/REPROVED) counts — commercial's
    // job is to get something uploaded; approval is a separate workflow.
    // The quote's layoutFile (rendered via the budget editor) also counts —
    // from the operator's perspective, uploading a layout = layout delivered.
    const hasAnyLayout = layouts.length > 0 || (task.quote?.layoutFiles?.length ?? 0) > 0;
    // "Needs layout" is determined by the presence of ARTWORK-type service orders.
    // A task with no Arte SOs at all is service-only and doesn't wait for layout.
    const needsLayout = allServiceOrders.some(
      (so: any) => so.type === SERVICE_ORDER_TYPE.ARTWORK,
    );

    let target: SERVICE_ORDER_STATUS;
    if (!quoteAtOrAbove) {
      target = SERVICE_ORDER_STATUS.IN_PROGRESS;
    } else if (hasAnyLayout || !needsLayout) {
      target = SERVICE_ORDER_STATUS.COMPLETED;
    } else {
      target = SERVICE_ORDER_STATUS.WAITING_ARTWORK;
    }

    if (emNegociacao.status === target) return; // idempotent

    // Once "Em Negociação" is COMPLETED (manually via the OS form or automatically),
    // never auto-downgrade it back to WAITING_ARTWORK just because no layout has
    // been uploaded yet — completion is a deliberate commercial hand-off and must
    // stick (otherwise a bulk "Concluir" is silently reverted on the next sync).
    // A genuine quote un-approval still reopens it (→ IN_PROGRESS) via the branch below.
    if (
      emNegociacao.status === SERVICE_ORDER_STATUS.COMPLETED &&
      target === SERVICE_ORDER_STATUS.WAITING_ARTWORK
    ) {
      return;
    }

    const now = new Date();
    const patch: any = {
      status: target,
      statusOrder: SERVICE_ORDER_STATUS_ORDER[target] ?? 1,
    };

    if (target === SERVICE_ORDER_STATUS.COMPLETED) {
      patch.finishedAt = now;
      if (userId) patch.completedById = userId;
      // Accumulate working time if the SO was actively running before auto-completion
      if (
        emNegociacao.status === SERVICE_ORDER_STATUS.IN_PROGRESS ||
        emNegociacao.status === SERVICE_ORDER_STATUS.WAITING_ARTWORK
      ) {
        const sessionStart = emNegociacao.lastStartedAt ?? emNegociacao.startedAt;
        if (sessionStart) {
          const worked = calculateWorkingSeconds(sessionStart, now);
          patch.totalActiveTimeSeconds = (emNegociacao.totalActiveTimeSeconds ?? 0) + worked;
        }
      }
    } else if (target === SERVICE_ORDER_STATUS.WAITING_ARTWORK) {
      // Commercial work done — accumulate time like a pause
      if (emNegociacao.status === SERVICE_ORDER_STATUS.IN_PROGRESS) {
        const sessionStart = emNegociacao.lastStartedAt ?? emNegociacao.startedAt;
        if (sessionStart) {
          const worked = calculateWorkingSeconds(sessionStart, now);
          patch.totalActiveTimeSeconds = (emNegociacao.totalActiveTimeSeconds ?? 0) + worked;
        }
      }
    } else if (target === SERVICE_ORDER_STATUS.IN_PROGRESS) {
      // Reverting from COMPLETED/WAITING_ARTWORK: clear the completed marker and restart timer
      patch.finishedAt = null;
      patch.completedById = null;
      patch.lastStartedAt = now;
    }

    const updatedServiceOrder = await (prisma as any).serviceOrder.update({
      where: { id: emNegociacao.id },
      data: patch,
    });

    logger.log(
      `[Em Negociação Sync] Task ${taskId} — SO ${emNegociacao.id}: ${emNegociacao.status} → ${target} (quote=${quoteStatus}, hasAnyLayout=${hasAnyLayout}, needsLayout=${needsLayout})`,
    );

    // Emit the same status-change event the manual SO update path emits
    // (service-order.service.ts) so the ServiceOrderListener dispatches
    // service_order.waiting_layout/completed/started .commercial notifications
    // for these automatic transitions. Best-effort.
    if (registeredEventEmitter) {
      try {
        registeredEventEmitter.emit('service_order.status.changed', {
          serviceOrder: updatedServiceOrder,
          oldStatus: emNegociacao.status,
          newStatus: target,
          userId: userId ?? null,
        });
      } catch (emitError) {
        logger.error(
          `[Em Negociação Sync] Failed to emit service_order.status.changed for SO ${emNegociacao.id}: ${(emitError as Error).message}`,
        );
      }
    }
  } catch (error) {
    logger.error(
      `[Em Negociação Sync] Error reconciling task ${taskId}: ${(error as Error).message}`,
    );
    // Swallow — this is a best-effort sync; should never break the caller's flow.
  }
}
