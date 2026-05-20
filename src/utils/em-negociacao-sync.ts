import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_TYPE,
  TASK_QUOTE_STATUS,
} from '../constants/enums';
import { SERVICE_ORDER_STATUS_ORDER } from '../constants/sortOrders';

type PrismaContext = Prisma.TransactionClient | { artwork: any; serviceOrder: any; task: any };

const logger = new Logger('EmNegociacaoSync');

const EM_NEGOCIACAO_DESC = 'em negociação';

const STATUSES_AT_OR_ABOVE_BUDGET_APPROVED: TASK_QUOTE_STATUS[] = [
  TASK_QUOTE_STATUS.BUDGET_APPROVED,
  TASK_QUOTE_STATUS.COMMERCIAL_APPROVED,
  TASK_QUOTE_STATUS.BILLING_APPROVED,
  TASK_QUOTE_STATUS.UPCOMING,
  TASK_QUOTE_STATUS.DUE,
  TASK_QUOTE_STATUS.PARTIAL,
  TASK_QUOTE_STATUS.SETTLED,
];

/**
 * Reconcile the "Em Negociação" COMMERCIAL ServiceOrder for a task to match
 * the current quote/artwork state. Idempotent and safe to call from any
 * status-changing flow (budget/commercial approval, artwork create/approve/
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
 *   │   Artwork record (any status) │             — artwork team owns it now) │
 *   │ ≥ BUDGET_APPROVED + no        │ WAITING_ARTWORK                         │
 *   │   Artwork record +            │                                         │
 *   │   any ARTWORK-type SO         │                                         │
 *   │ ≥ BUDGET_APPROVED +           │ COMPLETED  (service-only — no artwork   │
 *   │   no ARTWORK-type SO          │             ever needed)                │
 *   └───────────────────────────────┴─────────────────────────────────────────┘
 *
 * Why "any Artwork record" instead of "APPROVED only": commercial's job ends
 * when the artwork team has something to work on. The artwork's own approval
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
        // layoutFileId on the quote also counts as an "artwork" for handoff
        // purposes — it's the rendered layout uploaded via the budget editor.
        quote: { select: { status: true, layoutFileId: true } },
        serviceOrders: {
          select: { id: true, description: true, status: true, type: true },
        },
        artworks: { select: { id: true, status: true } },
      },
    });

    if (!task) return;

    const allServiceOrders = task.serviceOrders || [];
    const emNegociacao = allServiceOrders.find(
      (so: any) =>
        so.type === SERVICE_ORDER_TYPE.COMMERCIAL &&
        (so.description ?? '').toLowerCase().trim() === EM_NEGOCIACAO_DESC,
    );
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
    const quoteAtOrAbove =
      !!quoteStatus &&
      STATUSES_AT_OR_ABOVE_BUDGET_APPROVED.includes(quoteStatus);

    const artworks = task.artworks || [];
    // Any artwork on the task (DRAFT/APPROVED/REPROVED) counts — commercial's
    // job is to get something uploaded; approval is a separate workflow.
    // The quote's layoutFile (rendered via the budget editor) also counts —
    // from the operator's perspective, uploading a layout = artwork delivered.
    const hasAnyArtwork = artworks.length > 0 || !!task.quote?.layoutFileId;
    // "Needs artwork" is determined by the presence of ARTWORK-type service orders.
    // A task with no Arte SOs at all is service-only and doesn't wait for artwork.
    const needsArtwork = allServiceOrders.some(
      (so: any) => so.type === SERVICE_ORDER_TYPE.ARTWORK,
    );

    let target: SERVICE_ORDER_STATUS;
    if (!quoteAtOrAbove) {
      target = SERVICE_ORDER_STATUS.IN_PROGRESS;
    } else if (hasAnyArtwork || !needsArtwork) {
      target = SERVICE_ORDER_STATUS.COMPLETED;
    } else {
      target = SERVICE_ORDER_STATUS.WAITING_ARTWORK;
    }

    if (emNegociacao.status === target) return; // idempotent

    const now = new Date();
    const patch: any = {
      status: target,
      statusOrder: SERVICE_ORDER_STATUS_ORDER[target] ?? 1,
    };
    if (target === SERVICE_ORDER_STATUS.COMPLETED) {
      patch.finishedAt = now;
      if (userId) patch.completedById = userId;
    } else if (target === SERVICE_ORDER_STATUS.IN_PROGRESS) {
      // Reverting from COMPLETED/WAITING_ARTWORK: clear the completed marker.
      patch.finishedAt = null;
      patch.completedById = null;
    }

    await (prisma as any).serviceOrder.update({
      where: { id: emNegociacao.id },
      data: patch,
    });

    logger.log(
      `[Em Negociação Sync] Task ${taskId} — SO ${emNegociacao.id}: ${emNegociacao.status} → ${target} (quote=${quoteStatus}, hasAnyArtwork=${hasAnyArtwork}, needsArtwork=${needsArtwork})`,
    );
  } catch (error) {
    logger.error(
      `[Em Negociação Sync] Error reconciling task ${taskId}: ${(error as Error).message}`,
    );
    // Swallow — this is a best-effort sync; should never break the caller's flow.
  }
}
