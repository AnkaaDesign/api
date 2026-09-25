/**
 * O LAYOUT APROVADO DE CADA VEÍCULO — a fonte única sobre "que arte vale para
 * que implemento".
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *   O layout aprovado era do ORÇAMENTO (`Budget.layoutFiles`, no máximo dois) e
 *   valia para todos os veículos dele. O orçamento nº 990 (Carlotti, 22/09/2026)
 *   tem dois implementos com o mesmo preço e pinturas diferentes: escolher a arte
 *   do segundo reprovava a do primeiro na galeria dele, escolher as duas deixava
 *   as duas aprovadas nos dois, e três veículos com três artes não cabiam.
 *
 *   `Budget.layoutScope` diz como ler a lista:
 *     SHARED       toda arte vale para todo veículo (o de sempre; sem linhas);
 *     PER_VEHICLE  as linhas de `BudgetLayoutTask` são a verdade.
 *
 * AS TRÊS PERGUNTAS, e onde cada uma é respondida
 *   1. "Que artes valem para ESTE veículo?"  → `layoutSelectionByTask`
 *   2. "Que veículos ESTA arte cobre?"       → `layoutFileCoverage`
 *   3. "Algum veículo ficou sem layout?"     → `layoutGateFailure`
 *
 *   Toda tela, portão, sincronizador e documento pergunta por aqui. Responder
 *   à mão — `quote.layoutFiles.length > 0` — é exatamente o teste que deixava um
 *   orçamento de dois implementos seguir para a assinatura com a arte de um só.
 *
 * A LINHA SÓ VALE QUANDO A ARTE E O VEÍCULO SÃO DO MESMO ORÇAMENTO
 *   `BudgetLayoutTask` não guarda o orçamento: quem diz de qual orçamento a arte
 *   é é `File.quoteLayoutId`, e de qual orçamento o veículo é, `Task.quoteId`.
 *   Por isso toda leitura parte da ARTE (`layoutFiles[].quoteLayoutTasks`) e
 *   cruza com as TAREFAS do orçamento — uma linha esquecida por um caminho que
 *   tirou o veículo do orçamento sem podar a cobertura nunca vira cobertura
 *   implícita. A poda (`pruneQuoteLayoutCoverage`) existe para o banco não
 *   acumular lixo, não para a leitura ficar certa.
 */
import { BadRequestException } from '@nestjs/common';
import { sortQuoteTasks, type QuoteTaskLike } from './quote-tasks';

export type QuoteLayoutScopeValue = 'SHARED' | 'PER_VEHICLE';

/** Teto de artes por veículo num orçamento `PER_VEHICLE` — o mesmo `max(2)` de sempre, agora por implemento. */
export const LAYOUT_MAX_PER_VEHICLE = 2;
/** Teto de artes DISTINTAS num orçamento `PER_VEHICLE`. Sessenta implementos com sessenta pinturas não é um orçamento, é um catálogo. */
export const LAYOUT_MAX_DISTINCT_PER_QUOTE = 20;
/** Teto do `SHARED` — o de sempre. */
export const LAYOUT_MAX_SHARED = 2;

/**
 * A recusa das portas LEGADAS (`layoutFileIds`) num orçamento `PER_VEHICLE`.
 *
 * O app instalado, o modal "Layout do Orçamento" da Agenda e a tela de
 * faturamento mandam a lista CRUA de ids — sem dizer de qual veículo cada arte
 * é. Aceitar uma lista diferente ali obrigaria a INVENTAR a cobertura
 * (todas para todos? só as novas para todos?), e qualquer palpite desfaz o que
 * o comercial atribuiu veículo a veículo. Mesmo conjunto passa intacto — é o
 * eco que essas telas mandam em toda gravação.
 */
export const PER_VEHICLE_LEGACY_WRITE_MESSAGE =
  'Este orçamento tem layout por veículo. Altere o layout aprovado pela tela do orçamento, no passo Informações.';

/**
 * A IDENTIDADE DE UMA IMAGEM, independente do registro `File`: o clone privado
 * que o orçamento guarda tem o mesmo `originalName` e o mesmo tamanho da arte da
 * galeria de onde saiu. É a mesma regra com que a galeria de cada tarefa casa a
 * arte do orçamento (`utils/sync-quote-task-layouts.ts`).
 */
export const layoutImageKey = (f: {
  originalName?: string | null;
  filename?: string | null;
  size?: number | null;
}): string => `${(f.originalName || f.filename || '').trim().toLowerCase()}::${f.size ?? 0}`;

/** As linhas de cobertura, na forma em que toda leitura as pede. */
export const QUOTE_LAYOUT_TASKS_SELECT = { select: { taskId: true } } as const;

/**
 * O include de `layoutFiles` que toda leitura PARA TELA usa: a ordem de sempre
 * (`createdAt`) e a cobertura de cada arte.
 */
export const QUOTE_LAYOUT_FILES_INCLUDE = {
  orderBy: { createdAt: 'asc' as const },
  include: { quoteLayoutTasks: QUOTE_LAYOUT_TASKS_SELECT },
};

/**
 * Pendura a cobertura (`quoteLayoutTasks`) num nó de include/select de
 * `layoutFiles`, qualquer que seja a forma que o chamador usou.
 *
 * ⚠️ É o GOTCHA desta base: `select` explícito e include montado à mão
 * descartam chave nova EM SILÊNCIO — já aconteceu com `QUOTE_BILLING_INCLUDE`,
 * que prometia o estado do faturamento e não o mandava. Um único ponto de
 * injeção por repositório, no fim do mapeamento do include, para que nenhuma
 * tela futura possa esquecer.
 *
 * `true` vira o include canônico (com a ordem por `createdAt`, que é a ordem em
 * que as artes são exibidas). Um nó com `select` recebe a chave dentro do
 * `select`; com `include`, ou sem nenhum dos dois, dentro do `include`. Quem já
 * pediu `quoteLayoutTasks` à mão é respeitado.
 */
export function withLayoutCoverageInclude(node: unknown): unknown {
  if (node === true) return { ...QUOTE_LAYOUT_FILES_INCLUDE };
  if (node === undefined || node === null || node === false || typeof node !== 'object') {
    return node;
  }
  const next = { ...(node as Record<string, unknown>) };
  const select = next.select as Record<string, unknown> | undefined;
  if (select && typeof select === 'object') {
    if (!('quoteLayoutTasks' in select)) {
      next.select = { ...select, quoteLayoutTasks: QUOTE_LAYOUT_TASKS_SELECT };
    }
    return next;
  }
  const include = (next.include as Record<string, unknown> | undefined) ?? {};
  if (!('quoteLayoutTasks' in include)) {
    next.include = { ...include, quoteLayoutTasks: QUOTE_LAYOUT_TASKS_SELECT };
  }
  return next;
}

// ═══════════════════════════════════════════════════════════════════════════
// LEITURA
// ═══════════════════════════════════════════════════════════════════════════

export interface LayoutFileLike {
  id: string;
  createdAt?: Date | string | null;
  quoteLayoutTasks?: Array<{ taskId: string }> | null;
}

export interface VehicleTaskLike extends QuoteTaskLike {
  implement?: { plate?: string | null } | null;
}

export interface QuoteLayoutLike<T extends VehicleTaskLike = VehicleTaskLike> {
  layoutScope?: string | null;
  layoutFiles?: LayoutFileLike[] | null;
  tasks?: T[] | null;
}

export function isPerVehicleLayout(
  quote: { layoutScope?: string | null } | null | undefined,
): boolean {
  return quote?.layoutScope === 'PER_VEHICLE';
}

/**
 * Para cada arte do orçamento, os veículos que ela cobre — na ORDEM CANÔNICA
 * dos veículos (`sortQuoteTasks`).
 *
 * `SHARED`: todos. `PER_VEHICLE`: as linhas da arte, cruzadas com as tarefas do
 * orçamento (ver o cabeçalho: linha de veículo que já saiu não conta).
 */
export function layoutFileCoverage<T extends VehicleTaskLike>(
  quote: QuoteLayoutLike<T>,
): Map<string, string[]> {
  const tasks = sortQuoteTasks(quote.tasks ?? []);
  const allIds = tasks.map(t => t.id);
  const out = new Map<string, string[]>();
  const perVehicle = isPerVehicleLayout(quote);
  for (const f of quote.layoutFiles ?? []) {
    if (!perVehicle) {
      out.set(f.id, [...allIds]);
      continue;
    }
    const rows = new Set((f.quoteLayoutTasks ?? []).map(r => r.taskId));
    out.set(
      f.id,
      allIds.filter(id => rows.has(id)),
    );
  }
  return out;
}

/**
 * Para cada veículo do orçamento, as artes DELE — na ordem de `layoutFiles`.
 *
 * Todo veículo do orçamento tem entrada, inclusive o que não tem arte nenhuma
 * (lista vazia): é essa entrada vazia que os portões procuram.
 */
export function layoutSelectionByTask<T extends VehicleTaskLike>(
  quote: QuoteLayoutLike<T>,
): Map<string, string[]> {
  const coverage = layoutFileCoverage(quote);
  const out = new Map<string, string[]>();
  for (const t of sortQuoteTasks(quote.tasks ?? [])) out.set(t.id, []);
  for (const f of quote.layoutFiles ?? []) {
    for (const taskId of coverage.get(f.id) ?? []) {
      out.get(taskId)?.push(f.id);
    }
  }
  return out;
}

/**
 * O nome humano de um veículo: número de série, senão placa, senão "N" — a
 * posição dele no orçamento, contada de 1.
 *
 * Sem o nome da tarefa de propósito: nos orçamentos multiveículo as N tarefas
 * costumam ter o MESMO nome (o do cliente), e "Falta o layout do veículo
 * Carlotti" não diz qual dos dois.
 */
export function vehicleLabel(task: VehicleTaskLike | null | undefined, index: number): string {
  const serial = (task?.serialNumber ?? '').trim();
  if (serial) return serial;
  const plate = (task?.implement?.plate ?? '').trim();
  if (plate) return plate;
  return String(index + 1);
}

/** "do veículo 39089" / "dos veículos 39088, 39089" — com teto, para sessenta implementos não virarem um parágrafo. */
export function describeVehicleList(labels: readonly string[], max = 10): string {
  if (labels.length === 1) return `do veículo ${labels[0]}`;
  const shown = labels.slice(0, max).join(', ');
  const rest = labels.length - Math.min(labels.length, max);
  return `dos veículos ${shown}${rest > 0 ? ` e mais ${rest}` : ''}`;
}

/** Os veículos sem nenhuma arte, na ordem canônica. */
export function tasksWithoutLayout<T extends VehicleTaskLike>(quote: QuoteLayoutLike<T>): T[] {
  const selection = layoutSelectionByTask(quote);
  return sortQuoteTasks(quote.tasks ?? []).filter(t => (selection.get(t.id) ?? []).length === 0);
}

export type LayoutGateFailure =
  | { scope: 'SHARED' }
  | { scope: 'PER_VEHICLE'; missingTaskIds: string[]; missingLabels: string[]; message: string };

/**
 * O PORTÃO DE LAYOUT: todo veículo tem layout aprovado?
 *
 * `null` = passa. Em `SHARED` a pergunta é a de sempre, e a resposta também:
 * "o orçamento tem alguma arte" (cada ponto de chamada mantém a SUA frase de
 * sempre para esse caso — elas variam por tela e nenhuma pode mudar). Em
 * `PER_VEHICLE` a falta é nomeada: "Falta o layout aprovado do veículo 39089."
 *
 * ⚠️ Orçamento `PER_VEHICLE` sem veículo nenhum (o registro existe antes do
 * vínculo em alguns implementos de criação) cai na regra do `SHARED`: não há de
 * quem dizer que falta, e dizer "passa" a um orçamento sem arte seria pior.
 */
export function layoutGateFailure<T extends VehicleTaskLike>(
  quote: QuoteLayoutLike<T> | null | undefined,
): LayoutGateFailure | null {
  if (!quote) return { scope: 'SHARED' };
  const files = quote.layoutFiles ?? [];
  const tasks = sortQuoteTasks(quote.tasks ?? []);
  if (!isPerVehicleLayout(quote) || tasks.length === 0) {
    return files.length > 0 ? null : { scope: 'SHARED' };
  }
  const selection = layoutSelectionByTask(quote);
  const missing: Array<{ id: string; label: string }> = [];
  tasks.forEach((t, i) => {
    if ((selection.get(t.id) ?? []).length === 0) {
      missing.push({ id: t.id, label: vehicleLabel(t, i) });
    }
  });
  if (missing.length === 0) return null;
  const labels = missing.map(m => m.label);
  return {
    scope: 'PER_VEHICLE',
    missingTaskIds: missing.map(m => m.id),
    missingLabels: labels,
    message: `Falta o layout aprovado ${describeVehicleList(labels)}.`,
  };
}

/**
 * A cobertura como ela entra no snapshot e no hash material: `[fileId,
 * taskIds ordenados]`, ordenado por `fileId`. `null` em `SHARED` — e é esse
 * `null` que faz a projeção de um `SHARED` sair byte a byte igual à de antes
 * desta feature.
 */
export function canonicalLayoutCoverage<T extends VehicleTaskLike>(
  quote: QuoteLayoutLike<T>,
): Array<[string, string[]]> | null {
  if (!isPerVehicleLayout(quote)) return null;
  const coverage = layoutFileCoverage(quote);
  return [...coverage.entries()]
    .map(([fileId, taskIds]) => [fileId, [...taskIds].sort()] as [string, string[]])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

// ═══════════════════════════════════════════════════════════════════════════
// ESCRITA — o pedido `layouts` normalizado
// ═══════════════════════════════════════════════════════════════════════════

export interface LayoutCoverageEntry {
  fileId: string;
  /** Ausente/nulo = "vale para todos os veículos". */
  taskIds?: string[] | null;
}

export interface LayoutCoveragePlan {
  scope: QuoteLayoutScopeValue;
  /**
   * Na ordem do pedido. `taskIds` sai VAZIO em `SHARED` (não há linha a
   * gravar) e explícito em `PER_VEHICLE` — inclusive para a arte que o pedido
   * mandou "para todos", que ganha uma linha por veículo ATUAL. É o que faz o
   * veículo acrescentado depois não herdar arte nenhuma.
   */
  files: Array<{ fileId: string; taskIds: string[] }>;
}

/**
 * Normaliza o pedido `layouts` contra os veículos ATUAIS do orçamento.
 *
 * - `fileId` repetido: as coberturas se juntam (nulo em qualquer uma = todos).
 * - `taskIds` fora do orçamento: 400, dizendo quantos — nunca descartar em
 *   silêncio, porque o comercial acharia que atribuiu.
 * - Arte com cobertura vazia (`[]`) não cobre ninguém e sai da lista: uma arte
 *   em `layoutFiles` sem veículo nenhum seria um layout aprovado de ninguém.
 * - Se TODAS as artes cobrem TODOS os veículos, o orçamento é `SHARED` — mesmo
 *   que o pedido tenha vindo veículo a veículo. Duas leituras diferentes para o
 *   mesmo arranjo fariam o mesmo documento hashear diferente.
 * - Limites: `SHARED` no máximo 2 artes (o de sempre); `PER_VEHICLE` no máximo
 *   2 por veículo e 20 distintas.
 */
export function planLayoutCoverage<T extends VehicleTaskLike>(
  entries: readonly LayoutCoverageEntry[] | null | undefined,
  quoteTasksList: readonly T[],
  options?: {
    /**
     * Veículos que estão SAINDO do orçamento nesta mesma gravação. A tela
     * reenvia o formulário inteiro, e a cobertura que ela manda ainda pode citar
     * o implemento que o mesmo corpo retira — recusar seria punir o eco. Eles são
     * descartados em silêncio: quem sai perde a cobertura, que é a regra.
     */
    leavingTaskIds?: readonly string[] | null;
  },
): LayoutCoveragePlan {
  const tasks = sortQuoteTasks(quoteTasksList);
  const allIds = tasks.map(t => t.id);
  const known = new Set(allIds);
  const leaving = new Set(options?.leavingTaskIds ?? []);

  // Junta repetidos preservando a ordem da primeira aparição.
  const merged = new Map<string, Set<string> | null>();
  const unknown = new Set<string>();
  for (const entry of entries ?? []) {
    if (!entry?.fileId) continue;
    const declared = entry.taskIds;
    if (Array.isArray(declared)) {
      for (const id of declared) if (!known.has(id) && !leaving.has(id)) unknown.add(id);
    }
    const prev = merged.get(entry.fileId);
    if (!merged.has(entry.fileId)) {
      merged.set(entry.fileId, Array.isArray(declared) ? new Set(declared) : null);
    } else if (prev !== null) {
      if (!Array.isArray(declared)) merged.set(entry.fileId, null);
      else for (const id of declared) prev!.add(id);
    }
  }

  if (unknown.size > 0) {
    throw new BadRequestException(
      unknown.size === 1
        ? 'Um dos veículos informados para o layout não pertence a este orçamento. Recarregue a tela e atribua de novo.'
        : `${unknown.size} veículos informados para o layout não pertencem a este orçamento. Recarregue a tela e atribua de novo.`,
    );
  }

  // Cobertura explícita por arte, na ordem canônica dos veículos; vazia sai.
  const files: Array<{ fileId: string; taskIds: string[]; all: boolean }> = [];
  for (const [fileId, set] of merged) {
    if (set === null) {
      files.push({ fileId, taskIds: [...allIds], all: true });
      continue;
    }
    const ordered = allIds.filter(id => set.has(id));
    if (ordered.length === 0) continue;
    files.push({ fileId, taskIds: ordered, all: ordered.length === allIds.length });
  }

  const everyFileCoversAll = files.every(f => f.all);
  if (everyFileCoversAll) {
    if (files.length > LAYOUT_MAX_SHARED) {
      throw new BadRequestException(
        `No máximo ${LAYOUT_MAX_SHARED} layouts aprovados valem para todos os veículos. ` +
          'Para mais artes, atribua cada uma aos veículos dela.',
      );
    }
    return { scope: 'SHARED', files: files.map(f => ({ fileId: f.fileId, taskIds: [] })) };
  }

  if (files.length > LAYOUT_MAX_DISTINCT_PER_QUOTE) {
    throw new BadRequestException(
      `No máximo ${LAYOUT_MAX_DISTINCT_PER_QUOTE} layouts aprovados distintos por orçamento.`,
    );
  }
  const perTask = new Map<string, number>();
  for (const f of files) for (const id of f.taskIds) perTask.set(id, (perTask.get(id) ?? 0) + 1);
  const overLimit = tasks
    .map((t, i) => ({ t, i, n: perTask.get(t.id) ?? 0 }))
    .filter(x => x.n > LAYOUT_MAX_PER_VEHICLE);
  if (overLimit.length > 0) {
    const labels = overLimit.map(x => vehicleLabel(x.t, x.i));
    throw new BadRequestException(
      `No máximo ${LAYOUT_MAX_PER_VEHICLE} layouts aprovados por veículo — ` +
        `passou ${describeVehicleList(labels)}.`,
    );
  }
  return {
    scope: 'PER_VEHICLE',
    files: files.map(f => ({ fileId: f.fileId, taskIds: f.taskIds })),
  };
}

/** O conjunto de ids, canônico — para comparar a porta legada com o que está gravado. */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = [...new Set(a)].sort();
  const sb = [...new Set(b)].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

/**
 * A chave canônica de um arranjo (escopo + cobertura) — o que a detecção de
 * mudança material compara. Artes em `SHARED` são um conjunto; em
 * `PER_VEHICLE`, pares arte → veículos.
 */
export function layoutArrangementKey(
  scope: QuoteLayoutScopeValue,
  files: ReadonlyArray<{ fileId: string; taskIds: readonly string[] }>,
): string {
  if (scope === 'SHARED') {
    return `SHARED|${[...new Set(files.map(f => f.fileId))].sort().join(',')}`;
  }
  return `PER_VEHICLE|${files
    .map(f => `${f.fileId}:${[...f.taskIds].sort().join(',')}`)
    .sort()
    .join(';')}`;
}

/** A chave do arranjo GRAVADO, a partir de um orçamento lido com `quoteLayoutTasks`. */
export function storedLayoutArrangementKey<T extends VehicleTaskLike>(
  quote: QuoteLayoutLike<T>,
): string {
  const scope: QuoteLayoutScopeValue = isPerVehicleLayout(quote) ? 'PER_VEHICLE' : 'SHARED';
  const coverage = layoutFileCoverage(quote);
  return layoutArrangementKey(
    scope,
    (quote.layoutFiles ?? []).map(f => ({
      fileId: f.id,
      taskIds: scope === 'SHARED' ? [] : (coverage.get(f.id) ?? []),
    })),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ESCRITA — no banco
// ═══════════════════════════════════════════════════════════════════════════

type Tx = any;

/**
 * Grava a cobertura de um orçamento, SUBSTITUINDO a anterior.
 *
 * Chamado depois de `layoutFiles` já apontar para as artes certas (as ids aqui
 * são as RESOLVIDAS — o clone, quando a arte veio da galeria de uma tarefa ou de
 * outro orçamento). Apaga toda linha das artes deste orçamento e dos veículos
 * dele e recria as do plano; em `SHARED` não recria nenhuma.
 *
 * `previousFileIds` são as artes que o orçamento tinha ANTES da gravação. Sem
 * elas, a arte que a própria gravação acabou de tirar de `layoutFiles` (já sem
 * dono, `quoteLayoutId` nulo) e o veículo que a mesma gravação tirou do
 * orçamento (já sem `quoteId`) escapavam dos dois critérios acima — e a linha
 * "arte C → veículo 39089" sobrevivia órfã, pronta para reaparecer.
 */
export async function writeLayoutCoverageRows(
  tx: Tx,
  quoteId: string,
  scope: QuoteLayoutScopeValue,
  files: ReadonlyArray<{ fileId: string; taskIds: readonly string[] }>,
  previousFileIds: readonly string[] = [],
): Promise<void> {
  const touchedFileIds = [...new Set([...files.map(f => f.fileId), ...previousFileIds])];
  await tx.budgetLayoutTask.deleteMany({
    where: {
      OR: [
        { file: { quoteLayoutId: quoteId } },
        { task: { quoteId } },
        ...(touchedFileIds.length ? [{ fileId: { in: touchedFileIds } }] : []),
      ],
    },
  });
  if (scope !== 'PER_VEHICLE') return;
  const rows = files.flatMap(f => f.taskIds.map(taskId => ({ fileId: f.fileId, taskId })));
  if (rows.length) await tx.budgetLayoutTask.createMany({ data: rows, skipDuplicates: true });
}

export interface LayoutCoveragePruneResult {
  /** Linhas apagadas por apontarem para veículo (ou arte) que não é mais deste orçamento. */
  removedRows: Array<{ fileId: string; taskId: string }>;
  /** Artes que ficaram sem veículo nenhum e saíram de `layoutFiles`. */
  disconnectedFileIds: string[];
  /** O orçamento ficou sem arte nenhuma e voltou a `SHARED`. */
  resetToShared: boolean;
}

/**
 * A PODA — rodada em todo caminho que muda o vínculo tarefa ↔ orçamento (os
 * mesmos em que `resliceQuoteCoverage` roda), nos DOIS orçamentos.
 *
 * 1. Apaga as linhas cuja arte OU cujo veículo não é mais deste orçamento — o
 *    veículo que saiu perde a cobertura, e o que chegou de outro orçamento
 *    perde a que trazia de lá.
 * 2. Em `PER_VEHICLE`, a arte que ficou sem veículo nenhum sai de
 *    `layoutFiles`: uma arte aprovada de ninguém seria contada pelos portões e
 *    impressa no documento.
 * 3. Sem arte nenhuma, o orçamento volta a `SHARED`: não há mais cobertura a
 *    proteger, e continuar `PER_VEHICLE` só faria as portas legadas recusarem a
 *    primeira arte que alguém tentasse pôr nele.
 *
 * NUNCA dá cobertura a ninguém: o veículo que chega a um orçamento
 * `PER_VEHICLE` fica descoberto até alguém atribuir — e o portão acusa.
 */
export async function pruneQuoteLayoutCoverage(
  tx: Tx,
  quoteId: string | null | undefined,
): Promise<LayoutCoveragePruneResult> {
  const result: LayoutCoveragePruneResult = {
    removedRows: [],
    disconnectedFileIds: [],
    resetToShared: false,
  };
  if (!quoteId) return result;
  const quote = await tx.budget.findUnique({
    where: { id: quoteId },
    select: { id: true, layoutScope: true },
  });

  const rows: Array<{
    fileId: string;
    taskId: string;
    file: { quoteLayoutId: string | null };
    task: { quoteId: string | null };
  }> = await tx.budgetLayoutTask.findMany({
    where: { OR: [{ file: { quoteLayoutId: quoteId } }, { task: { quoteId } }] },
    select: {
      fileId: true,
      taskId: true,
      file: { select: { quoteLayoutId: true } },
      task: { select: { quoteId: true } },
    },
  });
  // Num orçamento apagado (ou `SHARED`) nenhuma linha dele é válida.
  const valid = (r: (typeof rows)[number]) =>
    !!quote &&
    quote.layoutScope === 'PER_VEHICLE' &&
    r.file.quoteLayoutId === quoteId &&
    r.task.quoteId === quoteId;
  const stale = rows.filter(r => !valid(r));
  for (const r of stale) {
    await tx.budgetLayoutTask.deleteMany({ where: { fileId: r.fileId, taskId: r.taskId } });
    result.removedRows.push({ fileId: r.fileId, taskId: r.taskId });
  }
  if (!quote || quote.layoutScope !== 'PER_VEHICLE') return result;

  const files: Array<{ id: string; _count: { quoteLayoutTasks: number } }> = await tx.file.findMany(
    {
      where: { quoteLayoutId: quoteId },
      select: { id: true, _count: { select: { quoteLayoutTasks: true } } },
    },
  );
  const orphans = files.filter(f => f._count.quoteLayoutTasks === 0).map(f => f.id);
  if (orphans.length > 0) {
    await tx.file.updateMany({
      where: { id: { in: orphans }, quoteLayoutId: quoteId },
      data: { quoteLayoutId: null },
    });
    result.disconnectedFileIds = orphans;
  }
  if (files.length - orphans.length === 0) {
    await tx.budget.update({ where: { id: quoteId }, data: { layoutScope: 'SHARED' } });
    result.resetToShared = true;
  }
  return result;
}

/**
 * A cobertura como a trilha a registra: "39088: A; 39089: B" — com o NOME de
 * cada arte (`originalName`) e o rótulo de cada veículo. `SHARED` com artes vira
 * "Todos os veículos: A, B"; sem arte, "Sem layout".
 */
export function describeLayoutArrangement<T extends VehicleTaskLike>(
  quote: QuoteLayoutLike<T> & {
    layoutFiles?: Array<LayoutFileLike & { originalName?: string | null }> | null;
  },
): string {
  const files = quote.layoutFiles ?? [];
  if (files.length === 0) return 'Sem layout';
  const name = (f: { id: string; originalName?: string | null }) =>
    (f.originalName ?? '').trim() || f.id.slice(0, 8);
  if (!isPerVehicleLayout(quote)) {
    return `Todos os veículos: ${files.map(name).join(', ')}`;
  }
  const tasks = sortQuoteTasks(quote.tasks ?? []);
  const selection = layoutSelectionByTask(quote);
  const byId = new Map(files.map(f => [f.id, f]));
  return tasks
    .map((t, i) => {
      const own = (selection.get(t.id) ?? []).map(id => name(byId.get(id)!));
      return `${vehicleLabel(t, i)}: ${own.length ? own.join(', ') : 'sem layout'}`;
    })
    .join('; ');
}
