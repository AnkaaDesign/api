import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type PrismaContext = Prisma.TransactionClient | { taskQuote: any; layout: any; task: any };

const logger = new Logger('QuoteTaskLayoutSync');

/** Image identity: same picture regardless of File id (a private clone keeps the
 * source's originalName + byte size, so two records of the same image match). */
const imageKey = (f: { originalName?: string | null; filename?: string | null; size?: number | null }): string =>
  `${(f.originalName || f.filename || '').trim().toLowerCase()}::${f.size ?? 0}`;

/**
 * Materialize a quote's approved layout files (`TaskQuote.layoutFiles`, the
 * QUOTE_LAYOUT relation) as APPROVED task layouts (`Layout` rows on
 * `Task.layouts`).
 *
 * Rationale: the current workflow chooses a quote's approved layout FROM the
 * task's existing layouts (budget editor). But several surfaces still ADD a
 * layout straight onto the quote (batch "Layout do Orçamento", billing editor,
 * Flutter quote-detail, and every private copy that `cloneFileForQuoteLayout`
 * produces so sibling quotes can't steal each other's file). Those files would
 * otherwise live only on the quote and never appear in the task's layout gallery.
 * This reconciler guarantees the invariant "a quote's approved layout is always
 * an APPROVED task layout" no matter which client wrote it.
 *
 * IMAGE-AWARE: a quote's approved layout is usually a PRIVATE COPY of a task
 * layout (different File id, same picture — see resolveLayoutFileIdsForQuote). So
 * matching only by File id would create a SECOND, duplicate tile in the task
 * gallery. Instead we match by image (originalName + size): if the task already
 * has a layout of the same picture, we just APPROVE that one; only a genuinely
 * new image (e.g. a fresh batch upload with no task-layout twin) creates a new
 * Layout row.
 *
 * Behavior (idempotent, add-only):
 *   - Quote layout whose image already matches a task layout → promote that task
 *     layout to APPROVED (DRAFT→APPROVED); never duplicates the tile.
 *   - Quote layout with no image twin on the task → create a Layout as APPROVED
 *     ("approved directly") and connect it to the task.
 * Never removes or downgrades: dropping a file from the quote does NOT delete or
 * unapprove the task layout — mirroring the budget picker (deselecting a task art
 * leaves the task layout intact). REPROVED is left as a deliberate rejection.
 *
 * Best-effort: any failure is logged and swallowed so it never breaks the
 * caller's transaction-committing flow. Pass the surrounding `tx` so the layout
 * writes commit atomically with the quote write.
 */
export async function syncTaskLayoutsFromQuote(
  prisma: PrismaContext,
  quoteId: string,
  _userId?: string | null,
): Promise<void> {
  try {
    const quote = await (prisma as any).taskQuote.findUnique({
      where: { id: quoteId },
      select: {
        task: {
          select: {
            id: true,
            layouts: {
              select: {
                id: true,
                fileId: true,
                status: true,
                file: { select: { originalName: true, filename: true, size: true } },
              },
            },
          },
        },
        layoutFiles: {
          select: { id: true, originalName: true, filename: true, size: true },
        },
      },
    });

    // No task linked yet (e.g. a freshly-cloned quote before its task.update) —
    // the caller must invoke this only after the task↔quote link exists.
    if (!quote?.task) return;

    const taskId: string = quote.task.id;
    const quoteFiles: any[] = quote.layoutFiles || [];
    if (quoteFiles.length === 0) return; // nothing added — removal is not our concern

    const taskLayouts: any[] = quote.task.layouts || [];
    // Existing task layouts indexed by File id AND by image identity.
    const taskLayoutByFileId = new Map<string, { id: string; status: string }>();
    const taskLayoutByImage = new Map<string, { id: string; status: string }>();
    for (const l of taskLayouts) {
      taskLayoutByFileId.set(l.fileId, { id: l.id, status: l.status });
      taskLayoutByImage.set(imageKey(l.file || {}), { id: l.id, status: l.status });
    }

    const layoutIdsToConnect: string[] = [];

    for (const qf of quoteFiles) {
      // Resolve the task layout that represents this quote file: exact File id
      // first, then same image (the private-copy case).
      const match =
        taskLayoutByFileId.get(qf.id) || taskLayoutByImage.get(imageKey(qf));

      if (match) {
        // Already a task layout on THIS task (it came from task.layouts, so it is
        // connected). Promote a DRAFT so the quote's approved layout is never a
        // DRAFT task layout.
        if (match.status === 'DRAFT') {
          await (prisma as any).layout.update({
            where: { id: match.id },
            data: { status: 'APPROVED' },
          });
        }
        continue;
      }

      // No image twin on the task. Reuse a Layout for this exact File if one
      // exists anywhere (fileId is @unique), else create it approved-directly.
      const existing = await (prisma as any).layout.findUnique({
        where: { fileId: qf.id },
        select: { id: true, status: true },
      });
      if (!existing) {
        const created = await (prisma as any).layout.create({
          data: { fileId: qf.id, status: 'APPROVED' },
          select: { id: true },
        });
        layoutIdsToConnect.push(created.id);
      } else {
        if (existing.status === 'DRAFT') {
          await (prisma as any).layout.update({
            where: { id: existing.id },
            data: { status: 'APPROVED' },
          });
        }
        layoutIdsToConnect.push(existing.id);
      }
    }

    if (layoutIdsToConnect.length > 0) {
      await (prisma as any).task.update({
        where: { id: taskId },
        data: { layouts: { connect: layoutIdsToConnect.map((id) => ({ id })) } },
      });
    }

    logger.log(
      `[Quote→Task Layout Sync] Quote ${quoteId} / Task ${taskId}: ${quoteFiles.length} quote layout(s), ${layoutIdsToConnect.length} newly linked as task layouts.`,
    );
  } catch (error) {
    logger.error(
      `[Quote→Task Layout Sync] Error reconciling quote ${quoteId}: ${(error as Error).message}`,
    );
    // Swallow — best-effort sync; must never break the caller's flow.
  }
}
