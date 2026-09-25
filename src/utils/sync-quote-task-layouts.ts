import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { layoutImageKey, layoutSelectionByTask } from './quote-layout-coverage';

type PrismaContext = Prisma.TransactionClient | { budget: any; layout: any; task: any };

const logger = new Logger('QuoteTaskLayoutSync');

/** Image identity: same picture regardless of File id (a private clone keeps the
 * source's originalName + byte size, so two records of the same image match). */
const imageKey = layoutImageKey;

/**
 * O grafo que os três reconciliadores leem: as tarefas com as suas galerias, e
 * as artes do orçamento com a cobertura de cada uma.
 *
 * `layoutScope` e `quoteLayoutTasks` entraram quando o layout aprovado passou a
 * poder ser POR VEÍCULO (ver `utils/quote-layout-coverage.ts`): a seleção de
 * cada tarefa deixou de ser a lista do orçamento e passou a ser a lista DELA.
 */
const QUOTE_LAYOUT_SYNC_SELECT = {
  layoutScope: true,
  tasks: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      createdAt: true,
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
    select: {
      id: true,
      originalName: true,
      filename: true,
      size: true,
      quoteLayoutTasks: { select: { taskId: true } },
    },
  },
};

/**
 * A SELEÇÃO de cada veículo, como arquivos: em `SHARED`, todas as artes do
 * orçamento para todos (o comportamento de sempre, byte a byte); em
 * `PER_VEHICLE`, as artes com linha para aquela tarefa.
 */
function selectedFilesByTask(quote: any): Map<string, any[]> {
  const byId = new Map<string, any>((quote?.layoutFiles || []).map((f: any) => [f.id, f]));
  const out = new Map<string, any[]>();
  for (const [taskId, fileIds] of layoutSelectionByTask(quote || {})) {
    out.set(taskId, fileIds.map(id => byId.get(id)).filter(Boolean));
  }
  return out;
}

/** As imagens selecionadas por tarefa — a mesma seleção, na identidade que a galeria usa. */
function selectedImageKeysByTask(quote: any): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [taskId, files] of selectedFilesByTask(quote)) {
    out.set(taskId, new Set(files.map((f: any) => imageKey(f))));
  }
  return out;
}

/**
 * A GUARDA DA LINHA COMPARTILHADA, dentro do PRÓPRIO orçamento.
 *
 * `Layout.fileId` é `@unique`: a linha `Layout` de uma imagem é UMA, e as N
 * tarefas que a exibem a compartilham pelo m2m `Task.layouts`. O status é da
 * LINHA, não da tarefa. Então, num orçamento por veículo em que a arte A é do
 * implemento 1 e está ligada também à galeria do implemento 2 (o `SHARED` de antes a
 * materializou nos dois), reprovar A "no implemento 2" reprovaria A no implemento 1 —
 * exatamente o defeito da Carlotti, por outra porta.
 *
 * Por isso a linha só é reprovada quando NENHUMA tarefa deste orçamento ligada a
 * ela seleciona a imagem. Em `SHARED` a seleção é a mesma para todas as tarefas,
 * logo a imagem não selecionada numa não está selecionada em nenhuma: a guarda
 * nunca dispara e o resultado é o de sempre.
 */
function selectedByAnotherTaskOfThisQuote(
  layoutRowTasks: any[],
  quoteId: string,
  key: string,
  selectedKeysByTask: Map<string, Set<string>>,
): boolean {
  return layoutRowTasks.some(
    (t: any) => t.quote?.id === quoteId && !!selectedKeysByTask.get(t.id)?.has(key),
  );
}

/** A consulta da linha `Layout` para as duas guardas (deste orçamento e dos outros). */
const LAYOUT_ROW_GUARD_SELECT = {
  tasks: {
    select: {
      id: true,
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
};

/**
 * Materialize a quote's approved layout files (`Budget.layoutFiles`, the
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
  reapproveReprovedSelection = false,
): Promise<void> {
  try {
    const quote = await (prisma as any).budget.findUnique({
      where: { id: quoteId },
      select: QUOTE_LAYOUT_SYNC_SELECT,
    });

    // No task linked yet (e.g. a freshly-cloned quote before its task.update) —
    // the caller must invoke this only after the task↔quote link exists.
    const tasks: any[] = quote?.tasks || [];
    if (tasks.length === 0) return;

    const quoteFiles: any[] = quote.layoutFiles || [];
    if (quoteFiles.length === 0) return; // nothing added — removal is not our concern

    // UMA VEZ POR VEÍCULO, e cada um com a SUA seleção. Em `SHARED` a seleção
    // de todo veículo é a lista inteira do orçamento — o implemento 37 precisa da
    // arte aprovada na SUA galeria tanto quanto o primeiro, e materializar só na
    // âncora deixaria 59 veículos sem layout. Em `PER_VEHICLE` cada veículo
    // recebe só as artes dele: materializar a arte do implemento 1 na galeria do
    // implemento 2 é o que fazia a pintura de um aparecer aprovada no outro.
    const selection = selectedFilesByTask(quote);
    let linkedTotal = 0;
    for (const task of tasks) {
      const own = selection.get(task.id) ?? [];
      if (own.length === 0) continue;
      linkedTotal += await syncOneTaskFromQuoteFiles(
        prisma,
        task,
        own,
        reapproveReprovedSelection,
      );
    }

    logger.log(
      `[Quote→Task Layout Sync] Quote ${quoteId} / ${tasks.length} tarefa(s): ${quoteFiles.length} quote layout(s), ${linkedTotal} newly linked as task layouts.`,
    );
  } catch (error) {
    logger.error(
      `[Quote→Task Layout Sync] Error reconciling quote ${quoteId}: ${(error as Error).message}`,
    );
    // Swallow — best-effort sync; must never break the caller's flow.
  }
}

/**
 * O corpo do reconciliador, para UMA tarefa. Devolve quantos layouts novos
 * ligou a ela.
 *
 * Extraído porque o laço por veículo precisa dele N vezes e porque cada tarefa
 * tem a SUA galeria: os mapas por File id e por imagem são reconstruídos a cada
 * volta. Compartilhá-los entre veículos faria o segundo implemento em diante achar
 * que a arte já estava na galeria dele quando estava na do primeiro — e ele
 * terminaria sem layout.
 *
 * `Layout.fileId` é `@unique`, então a linha `Layout` de um mesmo arquivo é UMA
 * e as N tarefas a compartilham pelo m2m `Task.layouts`. A primeira volta cria,
 * as seguintes encontram e apenas conectam.
 */
async function syncOneTaskFromQuoteFiles(
  prisma: PrismaContext,
  task: { id: string; layouts?: any[] | null },
  quoteFiles: any[],
  reapproveReprovedSelection: boolean,
): Promise<number> {
  const taskId: string = task.id;
  const taskLayouts: any[] = task.layouts || [];
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
    const match = taskLayoutByFileId.get(qf.id) || taskLayoutByImage.get(imageKey(qf));

    if (match) {
      // Already a task layout on THIS task (it came from task.layouts, so it is
      // connected). Promote a DRAFT so the quote's approved layout is never a
      // DRAFT task layout. On the authoritative quote-selection path also
      // re-approve a previously-REPROVED layout that has been re-selected
      // (selection is authoritative: selected ⇒ APPROVED).
      const shouldPromote =
        match.status === 'DRAFT' || (reapproveReprovedSelection && match.status === 'REPROVED');
      if (shouldPromote) {
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
      const shouldPromote =
        existing.status === 'DRAFT' ||
        (reapproveReprovedSelection && existing.status === 'REPROVED');
      if (shouldPromote) {
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
      data: { layouts: { connect: layoutIdsToConnect.map(id => ({ id })) } },
    });
  }

  return layoutIdsToConnect.length;
}

/**
 * Subtractive counterpart to {@link syncTaskLayoutsFromQuote}: when a quote
 * reference (`Budget.layoutFiles`) is UNSELECTED — dropped from the quote —
 * mark the corresponding task `Layout` REPROVED. This flows an unselect in the
 * budget editor / "Layout do Orçamento" modal through to the task layout gallery
 * (the commercial rule: "unselect the reference → the task layout is reproved").
 *
 * `previousLayoutFiles` MUST be captured BEFORE the quote write, because the
 * `set:` replacement disconnects the dropped clones. Each quote file is a private
 * clone of a task layout, so it is image-matched (originalName + size), not by
 * File id.
 *
 * POR VEÍCULO. "Saiu" é uma conta de CADA tarefa: a seleção anterior dela
 * (`coveredTaskIds` de cada arquivo anterior; ausente/nulo = valia para todos,
 * que é o `SHARED`) contra a seleção atual dela. Em `SHARED` → `SHARED` as duas
 * contas são as do orçamento inteiro, e o resultado é o de sempre.
 *
 * Guards so this can never corrupt a still-in-use reference:
 *   - Skip if the same image is STILL selected for THIS task (reorder / no-op).
 *   - Skip if another task of THIS quote linked to the same `Layout` row still
 *     selects the image (the row is shared; its status is not per task).
 *   - Skip if ANY OTHER quote still references the same image (a sibling quote is
 *     actively displaying it — reproving would silently break its reference).
 *   - Only ever downgrades APPROVED → REPROVED; never touches DRAFT or an
 *     already-REPROVED layout.
 * Best-effort + tx-atomic, mirroring syncTaskLayoutsFromQuote. Returns the ids of
 * the task layouts it reproved, so the caller can fire downstream reconciliation
 * (e.g. artwork.reproved events).
 */
export async function reproveDroppedTaskLayoutsFromQuote(
  prisma: PrismaContext,
  quoteId: string,
  previousLayoutFiles: Array<{
    id: string;
    originalName?: string | null;
    filename?: string | null;
    size?: number | null;
    /** Os veículos que a arte cobria ANTES. Ausente/nulo = todos (`SHARED`). */
    coveredTaskIds?: string[] | null;
  }>,
  _userId?: string | null,
): Promise<string[]> {
  const reprovedLayoutIds: string[] = [];
  try {
    if (!previousLayoutFiles || previousLayoutFiles.length === 0) {
      return reprovedLayoutIds;
    }

    const quote = await (prisma as any).budget.findUnique({
      where: { id: quoteId },
      select: QUOTE_LAYOUT_SYNC_SELECT,
    });
    const tasks: any[] = quote?.tasks || [];
    if (tasks.length === 0) return reprovedLayoutIds;

    // Imagens que cada veículo AINDA seleciona depois da gravação.
    const currentKeysByTask = selectedImageKeysByTask(quote);

    const alreadyReproved = new Set<string>();
    for (const task of tasks) {
      // O que ESTE veículo tinha antes e não tem mais.
      const currentKeys = currentKeysByTask.get(task.id) ?? new Set<string>();
      const droppedKeys = new Set<string>();
      for (const pf of previousLayoutFiles) {
        const coveredBefore =
          !Array.isArray(pf.coveredTaskIds) || pf.coveredTaskIds.includes(task.id);
        if (!coveredBefore) continue;
        const k = imageKey(pf);
        if (!currentKeys.has(k)) droppedKeys.add(k);
      }
      if (droppedKeys.size === 0) continue;

      // Task layouts of THIS task, indexed by image identity.
      const taskLayoutByImage = new Map<string, { id: string; status: string }>();
      for (const l of task.layouts || []) {
        taskLayoutByImage.set(imageKey(l.file || {}), { id: l.id, status: l.status });
      }

      for (const k of droppedKeys) {
        const match = taskLayoutByImage.get(k);
        // Only reprove an APPROVED task layout for this exact image on this task.
        if (!match || match.status !== 'APPROVED') continue;
        // A MESMA linha `Layout` costuma estar ligada a vários veículos deste
        // orçamento (`fileId` é `@unique`). Sem esta guarda ela seria reprovada
        // sessenta vezes e entraria sessenta vezes no resultado, disparando a
        // reconciliação a jusante uma vez por veículo.
        if (alreadyReproved.has(match.id)) continue;

        const layoutRow = await (prisma as any).layout.findUnique({
          where: { id: match.id },
          select: LAYOUT_ROW_GUARD_SELECT,
        });
        const rowTasks: any[] = layoutRow?.tasks || [];
        // Outro veículo DESTE orçamento, ligado à mesma linha, ainda a seleciona.
        if (selectedByAnotherTaskOfThisQuote(rowTasks, quoteId, k, currentKeysByTask)) continue;
        // Guard against corrupting a still-in-use reference of ANOTHER quote.
        // (Scoping to the Layout row, not the image, means a sibling task with its
        // OWN separate row for the same picture does NOT block the reprove, while
        // a genuinely shared row is protected until every quote on it has dropped
        // the image — e.g. the last task in a bulk apply.)
        const referencedElsewhere = rowTasks.some(
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
        alreadyReproved.add(match.id);
        reprovedLayoutIds.push(match.id);
      }
    }

    if (reprovedLayoutIds.length > 0) {
      logger.log(
        `[Quote→Task Layout Reprove] Quote ${quoteId} / ${tasks.length} tarefa(s): reproved ${reprovedLayoutIds.length} dropped reference layout(s).`,
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

/**
 * AUTHORITATIVE reconciler — the stronger counterpart to
 * {@link reproveDroppedTaskLayoutsFromQuote}. When a quote's approved-layout
 * selection is set, the SELECTION IS AUTHORITATIVE: every APPROVED task layout
 * whose image is NOT in the current selection is REPROVED — not just the ones
 * that were previously selected and dropped. (Commercial rule: "whatever is
 * picked in Step 2 stays approved; all non-selected task layouts are reproved.")
 *
 * POR VEÍCULO. A seleção que manda em cada galeria é a DAQUELE veículo: em
 * `SHARED`, a lista inteira do orçamento (o de sempre); em `PER_VEHICLE`, as
 * artes com linha para ele. Escolher a arte B para o implemento 39089 não diz
 * nada sobre a galeria do 39088 — e reprovar a arte A lá era o defeito da
 * Carlotti (orçamento nº 990).
 *
 * Pair with {@link syncTaskLayoutsFromQuote} (called first, with
 * `reapproveReprovedSelection = true`) so the SELECTED images are promoted to
 * APPROVED before this reproves the rest — net result: selected ⇒ APPROVED,
 * everything else ⇒ REPROVED.
 *
 * Guards:
 *   - Never reprove against an EMPTY selection — not the quote's (nothing
 *     authoritative to enforce) and not a vehicle's (a vehicle still waiting for
 *     its art in a `PER_VEHICLE` quote keeps its gallery as is).
 *   - Only ever downgrades APPROVED → REPROVED; never touches DRAFT or an
 *     already-REPROVED layout.
 *   - Shared `Layout` row inside THIS quote: reprove only when NO task of this
 *     quote linked to the row selects the image (see
 *     `selectedByAnotherTaskOfThisQuote`).
 *   - Layout-ROW-scoped guard across quotes: skip a Layout row still referenced
 *     by ANOTHER quote's current selection (a sibling quote actively displaying it).
 * Best-effort + tx-atomic. Returns the reproved task-layout ids for downstream
 * reconciliation (artwork.reproved).
 */
export async function reproveNonSelectedTaskLayoutsFromQuote(
  prisma: PrismaContext,
  quoteId: string,
  _userId?: string | null,
): Promise<string[]> {
  const reprovedLayoutIds: string[] = [];
  try {
    const quote = await (prisma as any).budget.findUnique({
      where: { id: quoteId },
      select: QUOTE_LAYOUT_SYNC_SELECT,
    });
    const tasks: any[] = quote?.tasks || [];
    if (tasks.length === 0) return reprovedLayoutIds;

    const selected: any[] = quote.layoutFiles || [];
    // Authoritative only when there IS a selection — never mass-reprove empty.
    if (selected.length === 0) return reprovedLayoutIds;

    const selectedKeysByTask = selectedImageKeysByTask(quote);

    const alreadyReproved = new Set<string>();
    for (const task of tasks) {
      const selectedImageKeys = selectedKeysByTask.get(task.id) ?? new Set<string>();
      // Veículo sem arte nenhuma: nada autoritativo a impor NA GALERIA DELE.
      if (selectedImageKeys.size === 0) continue;
      for (const l of task.layouts || []) {
        if (l.status !== 'APPROVED') continue; // only downgrade APPROVED
        const k = imageKey(l.file || {});
        if (selectedImageKeys.has(k)) continue; // this layout IS this vehicle's selection
        // Linha `Layout` compartilhada entre os veículos deste mesmo orçamento —
        // reprovar uma vez basta. Ver a mesma guarda em reproveDropped.
        if (alreadyReproved.has(l.id)) continue;

        const layoutRow = await (prisma as any).layout.findUnique({
          where: { id: l.id },
          select: LAYOUT_ROW_GUARD_SELECT,
        });
        const rowTasks: any[] = layoutRow?.tasks || [];
        // A mesma linha é a arte aprovada de OUTRO veículo deste orçamento.
        if (selectedByAnotherTaskOfThisQuote(rowTasks, quoteId, k, selectedKeysByTask)) continue;
        // Shared m2m row guard: skip if ANOTHER quote still selects this image.
        const referencedElsewhere = rowTasks.some(
          (t: any) =>
            t.quote &&
            t.quote.id !== quoteId &&
            (t.quote.layoutFiles || []).some((f: any) => imageKey(f) === k),
        );
        if (referencedElsewhere) continue;

        await (prisma as any).layout.update({
          where: { id: l.id },
          data: { status: 'REPROVED' },
        });
        alreadyReproved.add(l.id);
        reprovedLayoutIds.push(l.id);
      }
    }

    if (reprovedLayoutIds.length > 0) {
      logger.log(
        `[Quote→Task Layout Reprove] Quote ${quoteId} / ${tasks.length} tarefa(s): reproved ${reprovedLayoutIds.length} non-selected task layout(s).`,
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
