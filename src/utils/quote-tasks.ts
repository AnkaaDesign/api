/**
 * As TAREFAS de um orçamento — a fonte única sobre ordem, contagem e âncora.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *   `Task.quoteId` era `@unique`: um orçamento, uma tarefa. Mas a tela de criação
 *   já produzia N tarefas (produto cartesiano de placas × números de série) e
 *   emitia um orçamento para CADA uma. O Marquespan de 02/09 saiu como os
 *   orçamentos 642 a 701: sessenta números, sessenta PDFs, sessenta cerimônias de
 *   assinatura, todos com a mesma lista de serviços e o mesmo valor.
 *
 *   Agora o orçamento cobre os sessenta. E `quote.task` — que aparecia em 47
 *   consultas Prisma — deixou de existir. Cada um desses lugares precisa
 *   responder a UMA de três perguntas diferentes, e confundi-las é como se
 *   introduz um erro silencioso:
 *
 *     1. "Qual é a lista de veículos?"     → `quoteTasks(quote)`
 *     2. "Qual tarefa ancora este link?"   → `primaryTask(quote)`
 *     3. "Quantos veículos são?"           → `taskCount(quote)`
 *
 *   A (2) é a perigosa. Um deep link de notificação, um rótulo de trilha ou um
 *   nome de arquivo precisa de UMA tarefa e qualquer uma serve. Um total, uma
 *   nota fiscal ou o corpo do documento assinado precisa de TODAS, e responder
 *   com a primeira ali é exatamente o defeito que faz um orçamento de sessenta
 *   caminhões cobrar por um.
 */

/** A ordem canônica das tarefas de um orçamento, para uso em `orderBy` do Prisma.
 *
 * `createdAt` e não `serialNumber`: as tarefas nascem na ordem em que o operador
 * digitou as placas e as séries, e é essa a ordem em que ele espera relê-las na
 * tabela de veículos do documento. Ordenar por número de série pareceria
 * equivalente — as séries costumam ser sequenciais — e deixaria de ser assim no
 * primeiro orçamento que misturasse um veículo já cadastrado com dois novos.
 * `id` como desempate para que a ordem seja TOTAL: duas tarefas criadas no mesmo
 * milissegundo não podem trocar de lugar entre duas renderizações, senão o
 * documento muda sem que nada tenha mudado — e o hash do snapshot muda junto.
 */
export const QUOTE_TASKS_ORDER_BY = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

/** Forma mínima de tarefa que este módulo precisa enxergar. */
export interface QuoteTaskLike {
  id: string;
  createdAt?: Date | string | null;
  serialNumber?: string | null;
  name?: string | null;
}

/**
 * Um orçamento como qualquer consulta o devolve.
 *
 * `task` (singular) continua declarado porque envelopes, dossiês e trilhas
 * gravados ANTES desta feature carregam o grafo antigo em JSONB, e relê-los é
 * rotina — o portal de verificação abre coleta de meses atrás. Ler os dois
 * formatos num lugar só é o que evita espalhar `?? quote.task` por quarenta
 * arquivos.
 */
export interface QuoteWithTasks {
  tasks?: QuoteTaskLike[] | null;
  /** @deprecated Forma anterior ao orçamento multitarefa. Só para grafos antigos. */
  task?: QuoteTaskLike | null;
}

/**
 * As tarefas do orçamento, na ordem canônica, sempre como lista.
 *
 * Nunca devolve `null`: um orçamento sem tarefa nenhuma existe (o registro é
 * criado antes do vínculo) e a resposta certa ali é a lista vazia, não a
 * ausência — quem itera não deveria precisar saber a diferença.
 */
export function quoteTasks<T extends QuoteTaskLike>(
  quote: { tasks?: T[] | null; task?: T | null } | null | undefined,
): T[] {
  if (!quote) return [];
  if (Array.isArray(quote.tasks)) return sortQuoteTasks(quote.tasks);
  return quote.task ? [quote.task] : [];
}

/**
 * Reordena em memória pela MESMA regra do `orderBy`.
 *
 * Necessário porque nem toda consulta pede `orderBy` (um `include: { tasks: true }`
 * simples devolve na ordem do plano do Postgres, que não é garantida), e a ordem
 * dos veículos entra no documento assinado e no hash do snapshot. Deixar isso
 * para o banco em uns lugares e não em outros é como o mesmo orçamento passa a
 * renderizar diferente entre duas leituras.
 */
export function sortQuoteTasks<T extends QuoteTaskLike>(tasks: readonly T[]): T[] {
  return [...tasks].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

/**
 * A tarefa ÂNCORA — a primeira na ordem canônica.
 *
 * Use somente onde uma tarefa qualquer serve e a escolha não muda o significado:
 * o `taskId` de um link profundo de notificação, o rótulo humano de uma trilha,
 * o nome da pasta de um arquivo, o cliente exibido num cabeçalho.
 *
 * NÃO use para dinheiro, para o corpo do documento assinado, para a
 * discriminação de uma NFS-e nem para decidir o que faturar. Nesses lugares a
 * resposta é a lista inteira, e a âncora seria uma afirmação falsa sobre as
 * outras cinquenta e nove.
 */
export function primaryTask<T extends QuoteTaskLike>(
  quote: { tasks?: T[] | null; task?: T | null } | null | undefined,
): T | null {
  return quoteTasks(quote)[0] ?? null;
}

/** Quantos veículos o orçamento cobre. É o "×N" do documento. */
export function taskCount(quote: QuoteWithTasks | null | undefined): number {
  return quoteTasks(quote).length;
}

/** `true` quando o orçamento cobre mais de um veículo — o caso que muda o documento. */
export function isMultiTask(quote: QuoteWithTasks | null | undefined): boolean {
  return taskCount(quote) > 1;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LACUNAS DE CADASTRO TARDIO, POR VEÍCULO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A chave de uma lacuna "a registrar" no documento congelado.
 *
 * Era o nome do campo (`plate`). Com N veículos isso deixou de identificar
 * qualquer coisa: o chassi do caminhão 3 seria carimbado no espaço reservado do
 * caminhão 1, porque as duas lacunas teriam a mesma chave e a última escrita
 * ganharia. A chave passa a levar a tarefa junto.
 *
 * ⚠️ COMPATIBILIDADE: envelopes congelados ANTES desta feature têm as chaves
 * CRUAS (`plate`, sem `#`), e não podem ser reescritos — os bytes são o que o
 * signatário assinou. Quem CONSOME uma chave precisa aceitar as duas formas
 * (ver `parseLateSlotKey`), e quem PRODUZ o mapa de valores precisa emitir as
 * duas (ver `buildLateValueMap`).
 */
export function lateSlotKey(field: string, taskId: string): string {
  return `${field}#${taskId}`;
}

/** Desmonta a chave nas duas formas. `taskId` nulo = envelope anterior à feature. */
export function parseLateSlotKey(key: string): { field: string; taskId: string | null } {
  const hash = key.indexOf('#');
  if (hash < 0) return { field: key, taskId: null };
  return { field: key.slice(0, hash), taskId: key.slice(hash + 1) };
}

/** Os três campos que ganham lacuna. Categoria e implemento não: são
 *  classificação, não identidade, e já estão preenchidos na emissão. */
export const LATE_SLOT_FIELDS = ['serialNumber', 'plate', 'chassis'] as const;
export type LateSlotField = (typeof LATE_SLOT_FIELDS)[number];

export interface LateSlotVehicle {
  taskId: string;
  serialNumber?: string | null;
  plate?: string | null;
  chassis?: string | null;
}

/**
 * O mapa `chave → valor atual` que carimba as lacunas do documento congelado.
 *
 * Emite as DUAS formas de chave de propósito:
 *   · `plate#<taskId>` para todo veículo — o que os envelopes novos reservaram;
 *   · `plate` cru apontando para o PRIMEIRO veículo — o que os envelopes antigos
 *     reservaram, e que continuaria sem resposta se só emitíssemos a forma nova.
 *
 * Um envelope antigo tem exatamente uma tarefa, então a forma crua nunca é
 * ambígua ali. Um envelope novo nunca lê a forma crua, porque não reservou
 * nenhuma. As duas convivem sem se sobrepor.
 */
export function buildLateValueMap(
  vehicles: readonly LateSlotVehicle[],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  vehicles.forEach((v, index) => {
    for (const field of LATE_SLOT_FIELDS) {
      const value = (v[field] ?? null) as string | null;
      out[lateSlotKey(field, v.taskId)] = value;
      // A forma crua só existe para envelopes de UMA tarefa; o primeiro veículo
      // é aquela tarefa. Não sobrescrever depois: com N veículos o valor do
      // segundo apagaria o do primeiro numa chave que só o primeiro reservou.
      if (index === 0) out[field] = value;
    }
  });
  return out;
}
