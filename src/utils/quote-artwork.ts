/**
 * A ARTE DO ORÇAMENTO (PLANO §2A.9) — a única fonte da arte que o documento de
 * assinatura imprime, que o snapshot congela e que a página pública mostra.
 *
 * O orçamento não seleciona mais arte (R1): a arte é do IMPLEMENTO (R2), aprovada
 * pelos responsáveis. "A arte do orçamento" passa a ser a arte APROVADA dos
 * implementos de TODAS as tarefas dele — canceladas inclusive, porque um veículo
 * cancelado depois da assinatura não pode mudar o documento assinado.
 *
 * ⚠️ É ISTO que a régua G11 confere: para todo envelope RUNNING/COMPLETED, o que
 * esta função devolve tem de reproduzir o `layoutFileIds`/`layoutCoverage` que o
 * snapshot congelou quando a arte ainda morava em `Budget.layoutFiles`. A M3
 * (20260930120200) copiou a arte do orçamento para cada implemento com o MESMO
 * `File.id`; o ensaio da migração (`scripts/rehearse-implement-migration.ts`,
 * G11-DADOS) aplica exatamente esta regra sobre o banco — as duas têm de andar
 * juntas.
 *
 * - `fileIds`: `unique(fileIds).sort()` — a ordem de leitura do Prisma não é
 *   garantida, e uma permutação mudaria o hash sem que nada tivesse mudado.
 * - `coverage`: só quando o orçamento é `PER_VEHICLE` OU a arte não é a mesma em
 *   todos os veículos (uma tarefa cancelada sem arte não conta no teste). Em
 *   orçamento uniforme a chave nem existe e o snapshot sai idêntico ao de antes.
 */

import {
  describeVehicleList,
  sortQuoteTasks,
  vehicleLabel,
  type QuoteTaskLike,
} from './quote-tasks';

/** A arte de um implemento como o `include` de `QUOTE_ARTWORK_TASKS_INCLUDE` a traz. */
export interface ArtworkLayoutLike {
  fileId: string;
  status: string;
  file?: unknown;
}

export interface ArtworkTaskLike {
  id: string;
  status?: string | null;
  implement?: { layouts?: ArtworkLayoutLike[] | null } | null;
}

export interface QuoteArtwork<F = unknown> {
  /** Os arquivos da arte, sem repetição, ordenados por id. */
  fileIds: string[];
  /** `[fileId, taskIds ordenados][]` ordenado por fileId — ou `null` (uniforme e não PER_VEHICLE). */
  coverage: Array<[string, string[]]> | null;
  /**
   * Os arquivos (o `file` do include), um por id, na ordem em que aparecem pela
   * primeira vez nos veículos (a ordem canônica das tarefas que o chamador passa)
   * — a ordem da tabela de identificação, para o documento se ler de cima para
   * baixo. Não entra no hash (o hash vê `fileIds`, ordenado).
   */
  files: F[];
  /** Os ids de arquivo de cada tarefa (sem repetição, ordenados). */
  byTask: Map<string, string[]>;
  /** As tarefas de cada arquivo, na ordem das tarefas (a legenda "Veículos 39088, 39089"). */
  tasksByFile: Map<string, string[]>;
}

const uniqSort = (xs: readonly string[]): string[] => [...new Set(xs)].sort();

/**
 * O `include` das tarefas de um orçamento que `quoteArtworkOf` precisa: o
 * implemento com a arte APROVADA (e o arquivo, para o documento).
 */
export const QUOTE_ARTWORK_TASKS_INCLUDE = {
  implement: {
    select: {
      layouts: {
        where: { status: 'APPROVED' as const },
        orderBy: { createdAt: 'asc' as const },
        select: { fileId: true, status: true, file: true },
      },
    },
  },
} as const;

export function quoteArtworkOf<F = unknown>(quote: {
  layoutScope?: string | null;
  tasks?: readonly ArtworkTaskLike[] | null;
}): QuoteArtwork<F> {
  const byTask = new Map<string, string[]>();
  const tasksByFile = new Map<string, string[]>();
  const files = new Map<string, F>(); // ordem de inserção = primeira aparição
  for (const task of quote.tasks ?? []) {
    const approved = (task.implement?.layouts ?? []).filter(l => l.status === 'APPROVED');
    for (const l of approved) {
      if (!files.has(l.fileId)) files.set(l.fileId, l.file as F);
      const taskIds = tasksByFile.get(l.fileId) ?? [];
      if (!taskIds.includes(task.id)) tasksByFile.set(l.fileId, [...taskIds, task.id]);
    }
    byTask.set(task.id, uniqSort(approved.map(l => l.fileId)));
  }
  const fileIds = uniqSort([...byTask.values()].flat());

  const sets = (quote.tasks ?? [])
    .filter(t => !(t.status === 'CANCELLED' && !byTask.get(t.id)?.length))
    .map(t => (byTask.get(t.id) ?? []).join(','));
  const uniform = new Set(sets).size <= 1;

  let coverage: Array<[string, string[]]> | null = null;
  if (quote.layoutScope === 'PER_VEHICLE' || !uniform) {
    const byFile = new Map<string, string[]>();
    for (const [taskId, ids] of byTask) {
      for (const fileId of ids) byFile.set(fileId, [...(byFile.get(fileId) ?? []), taskId]);
    }
    coverage = [...byFile.entries()]
      .map(([fileId, taskIds]) => [fileId, [...taskIds].sort()] as [string, string[]])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }

  return {
    fileIds,
    coverage,
    files: [...files.values()].filter((f): f is F => f !== undefined && f !== null),
    byTask,
    tasksByFile,
  };
}

export interface ArtworkGateFailure {
  missingTaskIds: string[];
  missingLabels: string[];
  message: string;
}

/**
 * O PORTÃO DA ARTE: todo veículo do orçamento tem arte APROVADA no implemento?
 *
 * `null` = passa. A falta é nomeada ("Falta a arte aprovada do veículo 39089.").
 * Veículo CANCELADO não precisa de arte (não vai ser pintado); orçamento sem
 * veículo nenhum não passa — não há de que arte falar, e dizer "passa" a um
 * orçamento sem arte seria pior.
 */
export function artworkGateFailure(
  quote: { tasks?: readonly (ArtworkTaskLike & QuoteTaskLike)[] | null } | null | undefined,
): ArtworkGateFailure | null {
  const tasks = sortQuoteTasks([...(quote?.tasks ?? [])]);
  if (tasks.length === 0) {
    return {
      missingTaskIds: [],
      missingLabels: [],
      message: 'O orçamento não tem veículo: não há arte a aprovar.',
    };
  }
  const missing: Array<{ id: string; label: string }> = [];
  tasks.forEach((t, i) => {
    if (t.status === 'CANCELLED') return;
    const approved = (t.implement?.layouts ?? []).some(l => l.status === 'APPROVED');
    if (!approved) missing.push({ id: t.id, label: vehicleLabel(t, i) });
  });
  if (missing.length === 0) return null;
  const labels = missing.map(m => m.label);
  return {
    missingTaskIds: missing.map(m => m.id),
    missingLabels: labels,
    message: `Falta a arte aprovada ${describeVehicleList(labels)}.`,
  };
}
