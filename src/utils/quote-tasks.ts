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
 *   implementos cobrar por um.
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
  /** A série é do implemento (DD1; a tarefa não tem mais a coluna). */
  implement?: { serialNumber?: string | null; plate?: string | null } | null;
  /**
   * SÓ em grafo CONGELADO: envelopes, dossiês e trilhas gravados em JSONB antes
   * de a série ir para o implemento guardam a série no topo da tarefa. É
   * registro (não se reescreve); dado vivo nunca traz este campo.
   */
  serialNumber?: string | null;
  name?: string | null;
}

/**
 * A série de uma tarefa. Viva: `implement.serialNumber`. Grafo congelado antigo
 * (ver `QuoteTaskLike.serialNumber`): o campo do topo, como foi gravado.
 */
export function taskSerialOf(
  t: { implement?: { serialNumber?: string | null } | null; serialNumber?: string | null } | null | undefined,
): string | null {
  return t?.implement?.serialNumber ?? t?.serialNumber ?? null;
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
 * qualquer coisa: o chassi do implemento 3 seria carimbado no espaço reservado do
 * implemento 1, porque as duas lacunas teriam a mesma chave e a última escrita
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

/** Os campos que ganham lacuna. Categoria e implemento não: são
 *  classificação, não identidade, e já estão preenchidos na emissão.
 *
 *  `orderNumber` estava de fora — o documento reservava a lacuna do pedido
 *  (`ad2e5c47`) mas este mapa nunca a respondia, e o pdf selado saía com "a
 *  registrar" mesmo com o número já na tarefa. */
export const LATE_SLOT_FIELDS = ['serialNumber', 'plate', 'chassis', 'orderNumber'] as const;
export type LateSlotField = (typeof LATE_SLOT_FIELDS)[number];

export interface LateSlotVehicle {
  taskId: string;
  serialNumber?: string | null;
  plate?: string | null;
  chassis?: string | null;
  orderNumber?: string | null;
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

/**
 * O valor de UM VEÍCULO a partir do total do orçamento.
 *
 * `Budget.total` é o valor do CONTRATO: `preço por veículo × N`. Toda leitura
 * feita pelo lado da TAREFA — a linha da lista, o cartão da Preparação, a
 * receita do painel, a coluna de valor do Histórico — quer o valor DAQUELE
 * veículo, e lia o total dos sessenta. O painel, que soma linha a linha, chegava
 * a sessenta vezes o contrato.
 *
 * Dividir e não somar-por-orçamento-distinto: a soma das N fatias reconstrói o
 * contrato (`12.170,40 × 60 = 730.224,00`), então todo agregado existente
 * continua correto sem saber que existe multitarefa — e o valor de cada linha
 * passa a ser verdade. O piso em 1 protege o orçamento sem tarefa vinculada
 * (o registro nasce antes do vínculo).
 */
export function perVehicleAmount(
  total: unknown,
  vehicleCount?: number | null,
): number {
  const grand = Number(total ?? 0);
  if (!Number.isFinite(grand)) return 0;
  const count = Math.max(1, Math.trunc(Number(vehicleCount ?? 1)) || 1);
  return Math.round((grand / count) * 100) / 100;
}

// ═══════════════════════════════════════════════════════════════════════════
// A COBERTURA DE UM FATURAMENTO — quais veículos ele cobra
//
// TRÊS GERAÇÕES, e vale saber por que houve três:
//
//   1. `BudgetPayer.taskId`, com NULO querendo dizer "todos". A
//      resposta era uma REGRA avaliada na leitura: uma fatura já emitida passava
//      a cobrir um implemento acrescentado depois, sem deixar rastro.
//   2. `QuoteBillingTask(configId, taskId, customerId)` — gravada, mas pendurada
//      no PAGADOR. Dois pagadores do mesmo recorte guardavam a lista DUAS VEZES,
//      e "quantos faturamentos tem este orçamento?" se respondia contando
//      pagadores — o que dava quatro num orçamento de quatro veículos com um
//      cliente só, e dois num de um veículo com dois clientes.
//   3. `BillingTask(billingId, taskId)` — a cobertura é do FATURAMENTO, que é uma
//      ENTIDADE com id próprio. Um veículo, um faturamento, e o banco garante.
//
// ⚠️ QUEM CONSULTA PRECISA PEDIR. A cobertura é relação, e relação que ninguém
// pede não vem: os helpers abaixo responderiam "cobre zero veículos", o que em
// dinheiro é R$ 0,00 numa fatura que tem valor. Não escreva o include à mão —
// `withCoverageInclude` o injeta em todo caminho que devolve `customerConfigs`.
//
// ESPELHADO em `web/src/utils/quote-tasks.ts`.
// ═══════════════════════════════════════════════════════════════════════════

/** A cobertura, como as consultas a devolvem. */
export interface BillingCoverageLike<T extends QuoteTaskLike = QuoteTaskLike> {
  tasks?: ReadonlyArray<{ taskId: string; task?: T | null }> | null;
}

/**
 * Um FATURAMENTO, ou um PAGADOR que aponta para um.
 *
 * Aceita os dois porque a cobertura é uma só: o pagador não tem cobertura
 * própria, ele herda a do faturamento a que pertence. Perguntar com qualquer um
 * dos dois dá a mesma resposta — a alternativa seria cada chamador lembrar de
 * destrinchar `config.billing` antes, e esquecer disso é silencioso.
 */
export interface BillingConfigLike<T extends QuoteTaskLike = QuoteTaskLike>
  extends BillingCoverageLike<T> {
  billing?: (BillingCoverageLike<T> & { id?: string; approvedAt?: Date | null }) | null;
  quote?: { tasks?: readonly T[] | null } | null;
}

/** As linhas de cobertura, venham do faturamento ou do pagador que aponta para ele. */
function coverageRows<T extends QuoteTaskLike>(
  config: BillingConfigLike<T> | null | undefined,
): ReadonlyArray<{ taskId: string; task?: T | null }> {
  const own = config?.tasks;
  if (Array.isArray(own)) return own;
  const viaBilling = config?.billing?.tasks;
  if (Array.isArray(viaBilling)) return viaBilling;
  return [];
}

/**
 * ESTE FATURAMENTO ESTÁ APROVADO? — pergunte ao faturamento, não ao pagador.
 *
 * Era `BudgetPayer.billingApprovedAt`, uma coluna por pagador. Dois
 * pagadores do mesmo recorte tinham duas datas para um evento só, sempre
 * escritas juntas — duas colunas afirmando o mesmo fato.
 */
export function billingApprovedAtOf(
  config: BillingConfigLike | null | undefined,
): Date | null {
  const own = (config as { approvedAt?: Date | null } | null | undefined)?.approvedAt;
  if (own !== undefined) return own ?? null;
  return config?.billing?.approvedAt ?? null;
}

/** Atalho legível: este faturamento já foi aprovado? */
export function isBillingApproved(config: BillingConfigLike | null | undefined): boolean {
  return billingApprovedAtOf(config) !== null;
}

/**
 * Os ids dos veículos que este faturamento cobra, na ordem canônica do
 * orçamento quando ela é conhecida.
 *
 * A ordem importa porque a âncora (`sliceTask`) é o primeiro desta lista, e ela
 * batiza arquivo, link de notificação e rótulo de trilha: uma âncora que muda
 * entre duas leituras faz o mesmo faturamento apontar para implementos diferentes.
 */
export function coveredTaskIds(config: BillingConfigLike | null | undefined): string[] {
  const rows = coverageRows(config);
  if (rows.length === 0) return [];
  const ids = new Set(rows.map(r => r.taskId));
  const ordered = quoteTasks(config?.quote as any)
    .map(t => t.id)
    .filter(id => ids.has(id));
  // Tarefas que a consulta não trouxe entram pelo fim, sem ordem melhor
  // disponível — melhor uma âncora estável e incompleta do que nenhuma.
  for (const id of ids) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
}

/** Quantos veículos este faturamento cobra. É o multiplicador do valor da fatura. */
export function coveredTaskCount(config: BillingConfigLike | null | undefined): number {
  return coveredTaskIds(config).length;
}

/** Este faturamento cobra ESTE veículo? */
export function coversTask(
  config: BillingConfigLike | null | undefined,
  taskId: string | null | undefined,
): boolean {
  if (!taskId) return false;
  return coverageRows(config).some(r => r.taskId === taskId);
}

/**
 * A TAREFA ÂNCORA de uma fatia de faturamento — a primeira que ela cobre.
 *
 * Use onde uma tarefa qualquer da fatia serve e a escolha não muda o
 * significado: o `taskId` de um link, o rótulo de uma trilha, o nome de um
 * arquivo, o cabeçalho de uma parcela.
 *
 * NÃO use para dinheiro nem para a discriminação de uma NFS-e: ali a resposta é
 * a cobertura inteira, e a âncora seria uma afirmação falsa sobre os outros
 * veículos da mesma fatura. Para esses, `coveredTaskIds`.
 *
 * Cai para o primeiro veículo do orçamento quando a cobertura não veio na
 * consulta — é o que o código fazia antes desta feature, e continua sendo a
 * única resposta possível sem a relação.
 */
export function sliceTask<T extends QuoteTaskLike>(
  config: BillingConfigLike<T> | null | undefined,
): T | null {
  const tasks = quoteTasks(config?.quote as any) as T[];
  const covered = coveredTaskIds(config);
  if (covered.length > 0) {
    const own = tasks.find(t => t.id === covered[0]);
    if (own) return own;
    const embedded = coverageRows(config).find(r => r.taskId === covered[0])?.task;
    if (embedded) return embedded as T;
  }
  return tasks[0] ?? null;
}

/**
 * O `Invoice.taskId` / `NfseDocument.taskId` de uma fatia: o veículo quando a
 * fatura é de UM, nulo quando cobre vários.
 *
 * Nulo é a resposta honesta para a fatura de sessenta implementos — apontá-la para
 * um faria as telas de "faturas desta tarefa" mostrarem a cobrança inteira num
 * veículo e nada nos outros cinquenta e nove.
 *
 * ⚠️ E é por isso que a conta é sobre a COBERTURA e não sobre o modo. Num
 * orçamento de UMA tarefa — o acervo inteiro — `JOINT` cobre exatamente um
 * veículo, então o campo continua preenchido como sempre foi. A versão anterior
 * decidia por `billingSplit` e gravava NULO ali, deixando sem fatura as três
 * telas que perguntam por `Invoice.taskId`.
 */
/**
 * COMO NOMEAR, numa frase, os veículos que um faturamento cobre.
 *
 * Existe para a CLÁUSULA DE PAGAMENTO do documento: um cliente que paga em lotes
 * tem K faturamentos no mesmo orçamento, cada um com o seu total e o seu plano
 * de parcelas, e uma frase por lote só é legível se disser de quais implementos
 * ela fala. Série quando existe, senão placa, senão o nome da tarefa, senão o
 * começo do id — nessa ordem porque é assim que quem opera identifica um
 * implemento.
 *
 * `total` é quantos veículos o ORÇAMENTO tem. Cobrir todos não vira lista: em
 * sessenta implementos, "Todos os 60 veículos" é a informação, e imprimir as
 * sessenta séries é ruído que ninguém lê.
 *
 * ESPELHADO em `web/src/utils/quote-tasks.ts` (`coverageLabels`/`coverageSummary`).
 */
export function coverageLabels<T extends QuoteTaskLike & { implement?: { plate?: string | null } | null }>(
  config: BillingConfigLike<T> | null | undefined,
  tasks?: readonly T[] | null,
): string[] {
  const byId = new Map((tasks ?? quoteTasks(config?.quote as any) ?? []).map(t => [t.id, t]));
  return coverageRows(config).map(row => {
    const t = (row.task ?? byId.get(row.taskId) ?? null) as T | null;
    return (
      (taskSerialOf(t) || undefined) ??
      (t?.implement?.plate || undefined) ??
      (t?.name || undefined) ??
      row.taskId.slice(0, 8)
    );
  });
}

/** O rótulo de UM faturamento, em uma linha. Ver `coverageLabels`. */
export function coverageSummary<T extends QuoteTaskLike & { implement?: { plate?: string | null } | null }>(
  config: BillingConfigLike<T> | null | undefined,
  total: number,
  tasks?: readonly T[] | null,
): string {
  const labels = coverageLabels(config, tasks);
  if (labels.length === 0) return total > 1 ? `Todos os ${total} veículos` : 'Veículo único';
  if (total > 1 && labels.length === total) return `Todos os ${total} veículos`;
  if (labels.length === 1) return `Veículo ${labels[0]}`;
  return `Veículos ${labels.join(', ')}`;
}

export function sliceAnchorTaskId(
  config: BillingConfigLike | null | undefined,
): string | null {
  const covered = coveredTaskIds(config);
  return covered.length === 1 ? covered[0] : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUANTOS CLIENTES — e por que NUNCA se conta `customerConfigs.length`
//
// Antes do orçamento multitarefa havia exatamente UMA configuração por cliente,
// e `length === 1` / `length >= 2` eram formas corretas — por acidente — de
// perguntar quantos CLIENTES o orçamento tem.
//
// Com `billingSplit = PER_TASK` existe uma fatia POR VEÍCULO. Quatro implementos
// de UM cliente são QUATRO configurações, e as duas leituras passaram a mentir:
//
//   • `isSingleConfig` (create e update) decide se TODO serviço pertence à
//     configuração ou se ele é filtrado por `invoiceToCustomerId`. Num orçamento
//     de um cliente só nenhum serviço carrega esse campo — nem precisa —, então
//     contar fatias fazia as quatro fatias receberem uma lista VAZIA de
//     serviços, e `configTotal` era computado sobre nada.
//   • A guarda "todos os serviços devem ter cliente atribuído" recusava o
//     orçamento `PER_TASK` inteiro, com um erro impossível de obedecer: o
//     seletor "Faturar Para" só existe com mais de um cliente.
//
// A pergunta certa é sobre CLIENTES DISTINTOS — a mesma correção que
// `reconcileQuoteCustomerConfigs` já faz ao detectar troca de cliente.
//
// ESPELHADO em `web/src/utils/quote-tasks.ts`.
// ═══════════════════════════════════════════════════════════════════════════

interface ConfigWithCustomer {
  customerId?: string | null;
}

/** Os clientes distintos cobertos pelas fatias, na ordem em que aparecem. */
export function distinctCustomerIds(
  configs: readonly ConfigWithCustomer[] | null | undefined,
): string[] {
  const seen = new Set<string>();
  for (const config of configs ?? []) {
    // Fatia sem cliente é registro pela metade; contá-la como "outro cliente"
    // é o mesmo erro de contar fatias, por outro caminho.
    if (config.customerId) seen.add(config.customerId);
  }
  return [...seen];
}

/** Quantos CLIENTES distintos este orçamento fatura. */
export function customerCount(
  configs: readonly ConfigWithCustomer[] | null | undefined,
): number {
  return distinctCustomerIds(configs).length;
}

/**
 * O orçamento é faturado para mais de um cliente?
 *
 * ⚠️ Use SEMPRE isto no lugar de `customerConfigs.length >= 2`.
 */
export function hasMultipleCustomers(
  configs: readonly ConfigWithCustomer[] | null | undefined,
): boolean {
  return customerCount(configs) >= 2;
}

/**
 * O orçamento é de um cliente só? (Inclui o `PER_TASK` com N fatias dele.)
 *
 * É a pergunta que decide se um serviço sem `invoiceToCustomerId` pertence à
 * configuração — e a resposta certa, com um cliente só, é sempre SIM.
 */
export function isSingleCustomerQuote(
  configs: readonly ConfigWithCustomer[] | null | undefined,
): boolean {
  return customerCount(configs) <= 1;
}

/**
 * O QUE DEU ERRADO, em uma frase que chega à TELA.
 *
 * `catch (e) { throw new InternalServerErrorException('Erro ao criar orçamento.') }`
 * é o padrão mais comum desta base — e é o que faz um defeito real chegar ao
 * operador como três palavras sem conteúdo, com a causa presa no terminal da
 * API. Quando a criação de um orçamento falha, a tela precisa dizer ao menos a
 * CLASSE do problema, ou a recuperação vira adivinhação (e, num orçamento de N
 * veículos, a instrução errada — "crie o orçamento por uma das tarefas" — recria
 * o problema que a feature existe para resolver).
 *
 * Traduz o que é traduzível e devolve `null` para o resto, para quem chama
 * manter a mensagem genérica quando não há nada honesto a dizer.
 */
export function describePrismaFailure(error: unknown): string | null {
  const err = error as { code?: string; message?: string; meta?: Record<string, unknown> };
  const code = err?.code;
  const target = Array.isArray(err?.meta?.target)
    ? (err!.meta!.target as string[]).join(', ')
    : typeof err?.meta?.target === 'string'
      ? (err!.meta!.target as string)
      : null;

  switch (code) {
    case 'P2002':
      return `Já existe um registro com o mesmo valor único${target ? ` (${target})` : ''}.`;
    case 'P2003':
      return 'Um registro relacionado não existe mais (chave estrangeira). Recarregue a tela e tente de novo.';
    case 'P2025':
      return 'Um registro necessário não foi encontrado — ele pode ter sido excluído por outra pessoa.';
    case 'P2028':
      return 'A transação expirou antes de terminar. Tente novamente.';
    default:
      break;
  }

  // Erro de VALIDAÇÃO do Prisma (campo/argumento desconhecido). É o que aparece
  // quando o código e o banco estão em versões diferentes — a migração não foi
  // aplicada, ou o processo está rodando com um client gerado antes dela. Dizer
  // isso poupa uma tarde: o sintoma é indistinguível de um defeito de regra.
  const message = String(err?.message ?? '');
  const unknownArg = message.match(/Unknown argument `([^`]+)`/);
  if (unknownArg) {
    return `O servidor está fora de sincronia com o banco (campo "${unknownArg[1]}"). Aplique as migrações pendentes e reinicie a API.`;
  }
  if (/does not exist in the current database|column .* does not exist/i.test(message)) {
    return 'O banco de dados está sem uma migração que este servidor espera. Aplique as migrações pendentes.';
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// O NÚMERO DO PEDIDO DE COMPRA DO CLIENTE
//
// Mora em `Task.customerOrderNumber` — por VEÍCULO — desde que um orçamento
// passou a cobrir N implementos. Antes era um campo da configuração de
// faturamento, por CLIENTE, e os sessenta veículos do mesmo orçamento eram
// obrigados a citar o mesmo pedido na nota e no boleto.
//
// Quem imprime (nota, boleto, documento) cobre uma FATURA, e uma fatura pode
// cobrir um veículo (`PER_TASK`) ou todos (`JOINT`). Daí as duas funções abaixo:
// a lista do que existe, e a linha que a representa.
// ═══════════════════════════════════════════════════════════════════════════

/** Os números de pedido dos veículos indicados, sem brancos e sem repetição. */
export function orderNumbersOfTasks(
  tasks: ReadonlyArray<{ customerOrderNumber?: string | null }> | null | undefined,
): string[] {
  const seen = new Set<string>();
  for (const t of tasks ?? []) {
    const value = (t.customerOrderNumber ?? '').trim();
    if (value) seen.add(value);
  }
  return [...seen];
}

/**
 * UMA LINHA para a nota, o boleto e o documento.
 *
 * Um número quando é um só — o caso comum, inclusive num orçamento de sessenta
 * implementos comprados no mesmo pedido. Vários, separados por vírgula, quando
 * diferem: a nota conjunta cobre todos e omitir os outros faria o cliente
 * receber uma nota que não bate com nenhum pedido dele.
 *
 * `maxLength` apara pelo limite do campo de destino (a discriminação da NFS-e
 * tem tamanho fixo) sem cortar um número ao meio.
 */
export function orderNumberLabel(
  tasks: ReadonlyArray<{ customerOrderNumber?: string | null }> | null | undefined,
  maxLength?: number,
): string | null {
  const numbers = orderNumbersOfTasks(tasks);
  if (numbers.length === 0) return null;
  const full = numbers.join(', ');
  if (!maxLength || full.length <= maxLength) return full;

  const kept: string[] = [];
  for (const n of numbers) {
    const candidate = [...kept, n].join(', ');
    // `+ 4` reserva o " (+N)" que fecha a linha.
    if (candidate.length + 5 > maxLength) break;
    kept.push(n);
  }
  if (kept.length === 0) return numbers[0].slice(0, maxLength);
  const rest = numbers.length - kept.length;
  return rest > 0 ? `${kept.join(', ')} (+${rest})` : kept.join(', ');
}

// ═══════════════════════════════════════════════════════════════════════════
// O FATURAMENTO VIAJA SEMPRE
//
// A cobertura é relação, e relação que ninguém pede não vem. O modo de falha é
// silencioso e caro: a tela recebe uma fatura com cobertura VAZIA, mostra
// "nenhum veículo" numa fatura de vinte, e qualquer conta feita a partir dela dá
// R$ 0,00. Pior, é o tipo de defeito que só aparece na tela que esqueceu de
// pedir — não no `tsc`, não nos testes das outras.
//
// Por isso nenhum repositório escreve o include à mão: todo caminho que devolve
// `customerConfigs` passa por `withCoverageInclude`, que pendura o FATURAMENTO
// no que o chamador pediu, seja `true`, `include` ou `select`.
//
// Foi também o que tornou barata a troca de `QuoteBillingTask` por `Billing`:
// dezenove clientes (web, dois apps, relatórios) continuaram pedindo o mesmo
// `customerConfigs` e passaram a receber a cobertura do lugar novo, porque a
// forma do include é decidida AQUI e não em cada consulta.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A cobertura como as telas precisam dela: o id da tarefa e o suficiente para
 * NOMEAR o veículo (série, nome, placa) sem uma segunda consulta.
 *
 * Ordenada pela MESMA regra de `QUOTE_TASKS_ORDER_BY`: a ordem da cobertura
 * decide a âncora (`sliceTask`), e âncora que muda entre duas leituras faz o
 * mesmo faturamento apontar para implementos diferentes.
 */
export const QUOTE_COVERAGE_INCLUDE: {
  select: Record<string, unknown>;
  orderBy: Array<Record<string, unknown>>;
} = {
  select: {
    taskId: true,
    task: {
      select: {
        id: true,
        name: true,
        createdAt: true,
        customerOrderNumber: true,
        implement: { select: { serialNumber: true, plate: true } },
      },
    },
  },
  orderBy: [{ task: { createdAt: 'asc' } }, { taskId: 'asc' }],
};

/**
 * O FATURAMENTO como todo leitor de pagador precisa dele: o id (que agora é
 * ENDEREÇO — a tela de cobrança é `/faturamento/:billingId`), o estado próprio e
 * a cobertura.
 */
export const QUOTE_BILLING_INCLUDE: { select: Record<string, unknown> } = {
  select: {
    id: true,
    quoteId: true,
    approvedAt: true,
    // ⚠️ O ESTADO E A ORDEM TÊM DE ESTAR AQUI.
    //
    // O comentário acima prometia "o estado próprio" desde que o `Billing`
    // nasceu, e o `select` não o trazia — porque na época o estado ainda morava
    // no orçamento. Com o ciclo do pagamento nesta entidade, faltar estas duas
    // chaves é o bastante para NENHUM cliente receber o estado do faturamento: a
    // tela, a lista e o app leem daqui, e um `select` sem a chave não é erro, é
    // silêncio. Foi a auditoria do app que pegou.
    status: true,
    statusOrder: true,
    createdAt: true,
    tasks: QUOTE_COVERAGE_INCLUDE,
  },
};

/**
 * Pendura o faturamento no nó de include/select de `customerConfigs`, qualquer
 * que seja a forma que o chamador usou.
 *
 * `true` e ausente viram `{ include: { billing } }`. Um nó com `select` recebe a
 * chave dentro do `select` (pôr num `include` ao lado de um `select` é erro do
 * Prisma); um nó com `include`, ou sem nenhum dos dois, recebe dentro do
 * `include`.
 *
 * Um chamador que JÁ pediu `billing` à mão é respeitado — quem pediu um recorte
 * específico sabe o que quer, e sobrescrevê-lo apagaria campos que ele espera.
 */
export function withCoverageInclude(node: unknown): unknown {
  if (node === undefined || node === null || node === true) {
    return { include: { billing: QUOTE_BILLING_INCLUDE } };
  }
  if (node === false || typeof node !== 'object') return node;

  const next = { ...(node as Record<string, unknown>) };
  const select = next.select as Record<string, unknown> | undefined;
  if (select && typeof select === 'object') {
    const cleanedSelect = withoutRetiredCoverageKeys(select);
    next.select =
      'billing' in cleanedSelect
        ? cleanedSelect
        : { ...cleanedSelect, billing: QUOTE_BILLING_INCLUDE };
    return next;
  }
  const include = (next.include as Record<string, unknown> | undefined) ?? {};
  const cleaned = withoutRetiredCoverageKeys(include);
  next.include = 'billing' in cleaned ? cleaned : { ...cleaned, billing: QUOTE_BILLING_INCLUDE };
  return next;
}

/**
 * AS CHAVES APOSENTADAS DO PAGADOR — retiradas do pedido em vez de derrubá-lo.
 *
 * `coveredTasks` e `billingApprovedAt` saíram de `BudgetPayer` quando
 * a cobertura e o estado passaram para o `Billing`. Um cliente que ainda as peça
 * não recebe uma coluna a menos: recebe **500**, porque o Prisma recusa a consulta
 * inteira com "Unknown field ... for select statement". E foi o que aconteceu —
 * um `select` esquecido numa lista derrubou a TELA INTEIRA de faturamento.
 *
 * Clientes velhos existem e não somem no deploy: um bundle em cache, uma aba
 * aberta desde ontem, o app da loja, um favorito. Nenhum deles merece uma tela
 * morta por pedir um campo que mudou de lugar — ainda mais quando o valor que
 * eles queriam está vindo na mesma resposta, um nível abaixo, em `billing`.
 *
 * Silencioso de propósito: não é erro de quem chama, é a forma antiga da mesma
 * pergunta. Quem consome usa `coveredTaskIds()` / `billingApprovedAtOf()`, que
 * leem do lugar novo.
 */
// `orderNumber` está aqui pela MESMA razão das outras duas: a coluna foi dropada
// em `20260909170000` e o número do pedido virou `Task.customerOrderNumber`. Um
// `select: { orderNumber: true }` de bundle em cache derruba a lista inteira com
// "Unknown field 'orderNumber' for select statement" — que é literalmente o
// acidente que este helper existe para impedir, e ele não cobria o campo que mais
// recentemente mudou de lugar.
const RETIRED_CONFIG_KEYS = ['coveredTasks', 'billingApprovedAt', 'orderNumber'] as const;

function withoutRetiredCoverageKeys(
  node: Record<string, unknown>,
): Record<string, unknown> {
  if (!RETIRED_CONFIG_KEYS.some(k => k in node)) return node;
  const next = { ...node };
  for (const k of RETIRED_CONFIG_KEYS) delete next[k];
  return next;
}
