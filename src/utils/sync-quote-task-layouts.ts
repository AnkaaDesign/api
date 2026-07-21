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

/**
 * Subtractive counterpart to {@link syncTaskLayoutsFromQuote}: when a quote
 * reference (`TaskQuote.layoutFiles`) is UNSELECTED — dropped from the quote —
 * mark the corresponding task `Layout` REPROVED. This flows an unselect in the
 * budget editor / "Layout do Orçamento" modal through to the task layout gallery
 * (the commercial rule: "unselect the reference → the task layout is reproved").
 *
 * `previousLayoutFiles` MUST be captured BEFORE the quote write, because the
 * `set:` replacement disconnects the dropped clones. Each quote file is a private
 * clone of a task layout, so it is image-matched (originalName + size), not by
 * File id.
 *
 * Guards so this can never corrupt a still-in-use reference:
 *   - Skip if the same image is STILL referenced by THIS quote (reorder / no-op).
 *   - Skip if ANY OTHER quote still references the same image (a sibling quote is
 *     actively displaying it — reproving would silently break its reference).
 *   - Only ever downgrades APPROVED → REPROVED; never touches DRAFT or an
 *     already-REPROVED layout.
 * Best-effort + tx-atomic, mirroring syncTaskLayoutsFromQuote. Returns the ids of
 * the task layouts it reproved, so the caller can fire downstream reconciliation
 * (e.g. Em Negociação service-order sync / artwork.reproved events).
 */
export async function reproveDroppedTaskLayoutsFromQuote(
  prisma: PrismaContext,
  quoteId: string,
  previousLayoutFiles: Array<{
    id: string;
    originalName?: string | null;
    filename?: string | null;
    size?: number | null;
  }>,
  _userId?: string | null,
): Promise<string[]> {
  const reprovedLayoutIds: string[] = [];
  try {
    if (!previousLayoutFiles || previousLayoutFiles.length === 0) {
      return reprovedLayoutIds;
    }

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
    if (!quote?.task) return reprovedLayoutIds;

    // Images the quote STILL references after the write — never reprove these.
    const currentImageKeys = new Set<string>(
      (quote.layoutFiles || []).map((f: any) => imageKey(f)),
    );

    // Task layouts of THIS task, indexed by image identity.
    const taskLayoutByImage = new Map<string, { id: string; status: string }>();
    for (const l of quote.task.layouts || []) {
      taskLayoutByImage.set(imageKey(l.file || {}), { id: l.id, status: l.status });
    }

    // The genuinely-dropped images (de-duped, still-referenced removed).
    const droppedKeys = new Set<string>();
    for (const pf of previousLayoutFiles) {
      const k = imageKey(pf);
      if (!currentImageKeys.has(k)) droppedKeys.add(k);
    }
    if (droppedKeys.size === 0) return reprovedLayoutIds;

    for (const k of droppedKeys) {
      const match = taskLayoutByImage.get(k);
      // Only reprove an APPROVED task layout for this exact image on this task.
      if (!match || match.status !== 'APPROVED') continue;

      // Guard against corrupting a still-in-use reference. This Layout row can be
      // shared (m2m) across sibling tasks; reprove it only if NO OTHER quote —
      // among the tasks connected to THIS Layout row — still references the same
      // image. (Scoping to the Layout row, not the image, means a sibling task
      // with its OWN separate row for the same picture does NOT block the
      // reprove, while a genuinely shared row is protected until every quote on
      // it has dropped the image — e.g. the last task in a bulk apply.)
      const layoutRow = await (prisma as any).layout.findUnique({
        where: { id: match.id },
        select: {
          tasks: {
            select: {
              quote: {
                select: {
                  id: true,
                  layoutFiles: {
                    select: { originalName: true, filename: true, size: true },
                  },
                },
              },
            },
          },
        },
      });
      const referencedElsewhere = (layoutRow?.tasks || []).some(
        (t: any) =>
          t.quote &&
          t.quote.id !== quoteId &&
          (t.quote.layoutFiles || []).some((f: any) => imageKey(f) === k),
      );
      if (referencedElsewhere) continue;

      await (prisma as any).layout.update({
        where: { id: match.id },
        data: { status: 'REPROVED' },
      });
      reprovedLayoutIds.push(match.id);
    }

    if (reprovedLayoutIds.length > 0) {
      logger.log(
        `[Quote→Task Layout Reprove] Quote ${quoteId} / Task ${quote.task.id}: reproved ${reprovedLayoutIds.length} dropped reference layout(s).`,
      );
    }
  } catch (error) {
    logger.error(
      `[Quote→Task Layout Reprove] Error reconciling quote ${quoteId}: ${(error as Error).message}`,
    );
    // Swallow — best-effort; must never break the caller's flow.
  }
  return reprovedLayoutIds;
}
