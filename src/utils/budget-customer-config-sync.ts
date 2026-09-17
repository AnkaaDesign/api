/**
 * Reconciliação não-destrutiva dos FATURAMENTOS de um orçamento.
 *
 * O defeito histórico: todo caminho de gravação fazia
 *   `deleteMany({ quoteId }) + createMany(...)`
 * em `BudgetPayer`. Como a linha é o pai `onDelete: Cascade` de
 * `Invoice` (@unique) e `Installment`, destruir-e-recriar:
 *   - perdia em silêncio campos que o formulário não reenvia
 *     (`customerSignatureId`, `paymentConfig`);
 *   - podia apagar em cascata uma fatura já emitida e suas parcelas;
 *   - trocava o id da linha a cada save.
 *
 * A reconciliação casa as linhas em vez de recriá-las: ATUALIZA no lugar (filhos
 * e campos do banco sobrevivem), CRIA o que é novo e APAGA só o que saiu. Um
 * cliente removido que ainda tenha obrigação financeira viva (boleto ativo,
 * parcela paga, NFS-e autorizada) bloqueia a operação; um com obrigação só
 * inativa tem a fatura velha cancelada antes.
 *
 * INVARIANTE DE SEGURANÇA: ausência = preserva. Um campo é escrito SOMENTE
 * quando o objeto de entrada o traz (`!== undefined`); campo omitido mantém o
 * valor da linha. Nunca `x || null` (que confunde "não mexeram" com "limpe").
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE MUDOU COM A COBERTURA EXPLÍCITA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A chave natural era `(quoteId, customerId)` e passou a `(quoteId, customerId,
 * taskId)` quando `PER_TASK` chegou. Nenhuma das duas sobrevive ao LOTE: o mesmo
 * cliente pode ter K faturamentos no mesmo orçamento, cada um cobrindo um
 * conjunto de veículos, e conjunto não é chave de índice.
 *
 * O casamento passa a ser por IDENTIDADE, em quatro tentativas, nesta ordem:
 *
 *   a) o `id` que a tela mandou — é a resposta exata, e é nova: o schema antigo
 *      APAGAVA o `id` do payload (o objeto não é `.strict()`), então a tela
 *      mandava e ninguém lia;
 *   b) cobertura idêntica — o caso comum de um save que não mexeu no fatiamento;
 *   c) maior sobreposição — é o que mantém a fatura viva quando um lote é
 *      redividido (os vinte viram dez e dez: o faturamento dos vinte segue sendo
 *      o dos dez primeiros em vez de ser apagado e recriado);
 *   d) cria.
 *
 * ⚠️ COBERTURA CONGELADA. Um faturamento JÁ APROVADO (`billingApprovedAt`) ou
 * com fatura viva não muda de cobertura nem é removido, em nenhum modo. A
 * cobertura dele é semeada no plano ANTES de tudo, e os veículos dela saem do
 * bolo que os outros modos repartem. É o que impede "trocar para separado"
 * depois de faturar de mudar, retroativamente, de quais caminhões é uma nota
 * fiscal que já foi autorizada.
 */
import { BadRequestException } from '@nestjs/common';
import { planCoverage } from './quote-money';
import { PrismaTransaction } from '../modules/common/base/base.repository';
import { isBillingFrozen } from '../modules/production/budget/budget.guards';
import { hasLiveInvoice } from './billing-invoice';
import { deleteInstallmentsWithSlips } from './billing-teardown';
import { Logger } from '@nestjs/common';

const logger = new Logger('BillingSync');

export interface IncomingCustomerConfig {
  /**
   * O ID DA FATIA, quando a tela está editando uma que já existe.
   *
   * É a identidade estável do faturamento e a primeira tentativa de casamento.
   * Sem ele, quatro fatias do mesmo cliente chegam indistinguíveis e a
   * reconciliação só pode adivinhar qual é qual — que era exatamente o defeito:
   * o assistente reenviava as quatro sem cobertura, o servidor expandia cada uma
   * sobre TODAS as fatias, e a última gravava por cima das outras três.
   */
  id?: string;
  customerId: string;
  /**
   * A COBERTURA desta fatia — os veículos que ela cobra.
   *
   * Ausente = "decida pelo modo de faturamento", que é o que as telas mandam
   * quando não estão compondo lotes (não precisam montar sessenta objetos
   * idênticos a cada gravação). Presente = a tela está dizendo exatamente quem
   * cobra quem, e o modo não sobrescreve isso.
   */
  taskIds?: readonly string[] | null;
  /**
   * @deprecated Forma anterior à cobertura explícita: uma tarefa só, `null` para
   * "todas". Continua ACEITA e equivale a `taskIds: [taskId]`; `null` equivale a
   * ausência. Não remova do tipo achando que ninguém manda — ver a nota sobre
   * `.strict()` no schema.
   */
  taskId?: string | null;
  subtotal?: number | null;
  total?: number | null;
  discountType?: string | null;
  discountValue?: number | null;
  discountReference?: string | null;
  customPaymentText?: string | null;
  generateInvoice?: boolean;
  generateBankSlip?: boolean;
  /** @deprecated O pedido é do VEÍCULO (`Task.customerOrderNumber`). Aceito e traduzido pelo serviço. */
  orderNumber?: string | null;
  responsibleId?: string | null;
  paymentCondition?: string | null;
  paymentConfig?: unknown;
  customerSignatureId?: string | null;
}

/**
 * Monta o payload Prisma de uma fatia com SOMENTE os campos que o objeto de
 * entrada realmente carrega. Serve para `create` (o que falta cai no @default da
 * coluna) e para `update` (o que falta fica intocado).
 */
function buildConfigWriteData(config: IncomingCustomerConfig): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (config.subtotal !== undefined) d.subtotal = config.subtotal ?? 0;
  if (config.total !== undefined) d.total = config.total ?? 0;
  if (config.discountType !== undefined) d.discountType = config.discountType || 'NONE';
  if (config.discountValue !== undefined) d.discountValue = config.discountValue ?? null;
  if (config.discountReference !== undefined)
    d.discountReference = config.discountReference ?? null;
  if (config.customPaymentText !== undefined)
    d.customPaymentText = config.customPaymentText ?? null;
  if (config.generateInvoice !== undefined) d.generateInvoice = config.generateInvoice;
  if (config.generateBankSlip !== undefined) d.generateBankSlip = config.generateBankSlip;
  // `orderNumber` NÃO é mais campo da fatia: o número do pedido de compra é do
  // VEÍCULO (`Task.customerOrderNumber`), porque um orçamento cobre N caminhões e
  // o pedido é por entrega. O campo continua aceito no payload (o app instalado o
  // manda) e quem o traduz para as tarefas é `BudgetService`.
  if (config.responsibleId !== undefined) d.responsibleId = config.responsibleId ?? null;
  if (config.paymentCondition !== undefined) d.paymentCondition = config.paymentCondition ?? null;
  if (config.paymentConfig !== undefined) d.paymentConfig = (config.paymentConfig ?? null) as any;
  if (config.customerSignatureId !== undefined)
    d.customerSignatureId = config.customerSignatureId ?? null;
  return d;
}

/** One audited change produced by a reconcile pass. `entityId` for the emitted
 *  ChangeLog rows is the QUOTE id (mirroring TASK_QUOTE_SERVICE), so the entries
 *  are reachable from the quote timeline. */
export interface ConfigDiffEntry {
  type: 'added' | 'removed' | 'updated';
  customerId: string;
  /** Set for 'updated' — the column that changed. */
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  /** True when this row's discount terms were inherited from a replaced customer. */
  inherited?: boolean;
}

export interface ReconcileConfigsResult {
  /** True if a removed customer's stale (inactive) invoice was auto-cancelled. */
  cancelledInvoices: boolean;
  /**
   * OS FATURAMENTOS que perderam uma fatura por esta reconciliação.
   *
   * Existe porque o chamador precisava desaprovar EXATAMENTE esses e só tinha o
   * booleano acima — então desaprovava TODOS os faturamentos do orçamento.
   * Num orçamento de sessenta caminhões, remover um pagador do lote 3 levantava
   * o carimbo dos lotes 1 e 2, que estavam faturados, com nota autorizada e
   * boleto registrado.
   */
  cancelledInvoiceBillingIds: string[];
  /** The customerIds present after reconciliation (for orphan-service clearing). */
  customerIds: string[];
  /** Field-level changes, for the caller to write to the ChangeLog. */
  diff: ConfigDiffEntry[];
}

/** Columns whose loss silently changes what the customer is billed. Audited
 *  individually, and inherited across a customer replacement (see below). */
const DISCOUNT_FIELDS = ['discountType', 'discountValue', 'discountReference'] as const;

/** Billing terms that belong to the DEAL, not to the customer's identity, so they
 *  survive a replacement. Deliberately EXCLUDES `customerSignatureId` (the signature
 *  belongs to the person who signed). */
const DEAL_TERM_FIELDS = [
  'paymentCondition',
  'paymentConfig',
  'customPaymentText',
  'generateInvoice',
  'generateBankSlip',
] as const;

/** A config carries no effective discount when it is absent, NONE, or zero-valued. */
function hasNoEffectiveDiscount(c: { discountType?: unknown; discountValue?: unknown }): boolean {
  const t = c.discountType;
  if (t === undefined || t === null || t === 'NONE') return true;
  return Number(c.discountValue ?? 0) === 0;
}

/** A cobertura declarada por um objeto de entrada, ou `null` quando ele delega ao modo. */
function explicitCoverage(config: IncomingCustomerConfig): string[] | null {
  if (Array.isArray(config.taskIds)) return [...config.taskIds];
  if (typeof config.taskId === 'string' && config.taskId) return [config.taskId];
  return null;
}

/** Chave canônica de um conjunto de cobertura — ordem não importa, conteúdo sim. */
function coverageKey(taskIds: readonly string[]): string {
  return [...taskIds].sort().join('|');
}

type ExistingConfig = {
  id: string;
  customerId: string;
  /** O FATURAMENTO a que este pagador pertence. `NOT NULL` no banco. */
  billingId: string;
  /** A aprovação do FATURAMENTO — lida de `billing.approvedAt`, não do pagador. */
  billingApprovedAt: Date | null;
  discountType: string | null;
  discountValue: unknown;
  discountReference: string | null;
  coverage: string[];
  /** A cobertura como está no banco, SEM sanear contra os veículos atuais. */
  rawCoverage: string[];
  frozen: boolean;
};

export async function reconcileQuoteCustomerConfigs(
  tx: PrismaTransaction,
  quoteId: string,
  incomingConfigs: IncomingCustomerConfig[],
  /**
   * COMO FATIAR o faturamento, e sobre quais tarefas.
   *
   * Omitido = lê do banco. O parâmetro existe para o caminho em que a gravação
   * MUDA o modo ou o conjunto de tarefas na mesma transação: ler do banco ali
   * devolveria o estado de antes, e a reconciliação criaria as fatias erradas.
   */
  options?: { billingSplit?: string | null; taskIds?: readonly string[] | null },
): Promise<ReconcileConfigsResult> {
  const diff: ConfigDiffEntry[] = [];

  const billingSplit =
    options?.billingSplit ??
    (await tx.budget.findUnique({ where: { id: quoteId }, select: { billingSplit: true } }))
      ?.billingSplit ??
    'JOINT';

  const taskIds =
    options?.taskIds ??
    (
      await tx.task.findMany({
        where: { quoteId },
        select: { id: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    ).map(t => t.id);

  const storedConfigs = await tx.budgetPayer.findMany({
    where: { quoteId },
    orderBy: { createdAt: 'asc' },
    include: {
      // O FATURAMENTO, não o pagador: é dele a cobertura e é dele o estado.
      billing: {
        select: { id: true, approvedAt: true, status: true, tasks: { select: { taskId: true } } },
      },
      // `invoices` (plural) e SEM filtro: o critério de congelamento precisa ver
      // todas para decidir, e `liveInvoiceOf` escolhe a viva. Antes isto era
      // `invoice` to-one sobre uma relação que o banco sempre deixou ser 1:N — e
      // receber a CANCELADA de um ciclo anterior respondia "não congelada" sobre
      // um faturamento VIVO, liberando a reescrita da cobertura dele.
      invoices: { select: { id: true, status: true } },
    },
  });

  const validTaskIds = new Set(taskIds);
  const existing: ExistingConfig[] = storedConfigs.map(c => ({
    id: c.id,
    customerId: c.customerId,
    billingId: (c as any).billingId as string,
    billingApprovedAt: (c as any).billing?.approvedAt ?? null,
    discountType: c.discountType as any,
    discountValue: c.discountValue,
    discountReference: c.discountReference,
    // Cobertura saneada: um veículo retirado do orçamento nesta mesma gravação
    // ainda tem linha de cobertura (a exclusão em cascata acontece depois), e
    // mantê-lo aqui faria o plano reservá-lo para uma fatia que vai perdê-lo.
    coverage: ((c as any).billing?.tasks ?? [])
      .map((r: { taskId: string }) => r.taskId)
      .filter((id: string) => validTaskIds.has(id)),
    // A COBERTURA COMO ESTÁ GRAVADA, sem sanear. Serve para perceber que um
    // veículo COBERTO por uma fatia congelada foi retirado do orçamento: na
    // saneada ele simplesmente some, a fatia parece descoberta e seria APAGADA
    // junto com a fatura. É o que a guarda `orphanedFrozen` recusa com nome.
    rawCoverage: ((c as any).billing?.tasks ?? []).map((r: { taskId: string }) => r.taskId),
    // CONGELADO: já faturado, ou com fatura viva. Cobertura imutável.
    //
    // `isBillingFrozen` é o MESMO predicado da trava do orçamento — carimbo OU
    // estado pós-aprovação. Aqui só o carimbo era lido, e isso deixava passar a
    // cobrança liquidada por conciliação bancária (sem fatura, sem carimbo, com
    // estado SETTLED): a reconciliação a tratava como recorte livre e podia
    // reescrever a cobertura de um contrato já pago.
    frozen: isBillingFrozen((c as any).billing ?? { approvedAt: null }) || hasLiveInvoice(c as any),
  }));

  const existingByCustomer = new Map<string, ExistingConfig[]>();
  for (const c of existing) {
    const list = existingByCustomer.get(c.customerId) ?? [];
    list.push(c);
    existingByCustomer.set(c.customerId, list);
  }

  const incomingCustomerIds: string[] = [];
  const incomingByCustomer = new Map<string, IncomingCustomerConfig[]>();
  for (const config of incomingConfigs) {
    if (!incomingByCustomer.has(config.customerId)) {
      incomingByCustomer.set(config.customerId, []);
      incomingCustomerIds.push(config.customerId);
    }
    incomingByCustomer.get(config.customerId)!.push(config);
  }

  // ── QUEM SUBSTITUIU QUEM ──────────────────────────────────────────────────
  // Uma troca de cliente não é modelada pelo casamento abaixo: ela se decompõe
  // em criar(novo) + apagar(velho), e no ramo de CRIAÇÃO todo campo que o
  // payload omite cai no @default da coluna — `discountType DEFAULT 'NONE'`.
  // `recalcQuoteTotals` então levanta `total` até `subtotal` e a aprovação
  // congela o número inflado em `Invoice.totalAmount`. Foi assim que descontos
  // combinados sumiram e clientes foram cobrados a mais, em todos os clientes:
  // assistentes web, edição em linha da tarefa, app e edição em lote.
  //
  // ⚠️ A troca é detectada por CLIENTE, nunca por fatia. Num orçamento de
  // sessenta caminhões cobrado veículo a veículo, substituir o cliente decompõe
  // em sessenta remoções e sessenta criações, e uma heurística que exigisse
  // exatamente 1+1 nunca dispararia — o desconto se perderia nas sessenta
  // faturas de uma vez, que é a versão em escala do prejuízo que ela evita.
  const incomingCustomerIdSet = new Set(incomingCustomerIds);
  const removedCustomers = [...existingByCustomer.keys()].filter(
    id => !incomingCustomerIdSet.has(id),
  );
  const addedCustomers = incomingCustomerIds.filter(id => !existingByCustomer.has(id));
  const replacedCustomerId =
    removedCustomers.length === 1 && addedCustomers.length === 1 ? removedCustomers[0] : null;

  const matchedExistingIds = new Set<string>();

  /**
   * O PLANO DE COBERTURA — `configId` → os veículos que ele passará a cobrar.
   *
   * A cobertura deixou de ser escrita aqui, fatia a fatia, e passou a ser
   * ENTREGUE a `reconcileBillingsForQuote`, que a aplica de uma vez com o quadro
   * inteiro na mão. O motivo é a regra nova: `BillingTask.@@unique([taskId])` é
   * GLOBAL — um veículo, um faturamento. Escrevendo fatia a fatia, mover um
   * caminhão de um recorte para outro colide com a própria linha antiga, e a
   * versão anterior precisava de um `deleteMany` defensivo por cliente antes de
   * cada insert só para não ser descartada em silêncio por `skipDuplicates`.
   * Com o plano, a ordem "apaga tudo que muda, depois insere" é possível porque
   * quem escreve conhece o destino de todos os veículos ao mesmo tempo.
   */
  const coveragePlan = new Map<string, string[]>();

  for (const customerId of incomingCustomerIds) {
    const incomingC = incomingByCustomer.get(customerId)!;
    const existingC = existingByCustomer.get(customerId) ?? [];

    // ── 1. O PLANO DE COBERTURA DESTE CLIENTE ───────────────────────────────
    //
    // O que já foi faturado entra primeiro e sai do bolo: os veículos de uma
    // fatia congelada não são repartidos por ninguém, em nenhum modo.
    // ── (d) UM VEÍCULO JÁ FATURADO NÃO SAI DO ORÇAMENTO PELA PORTA DOS FUNDOS ─
    //
    // O teste usa a cobertura CRUA de propósito. Retirar do orçamento o único
    // veículo de uma fatia congelada fazia a cobertura SANEADA dela ficar vazia;
    // com `coverage.length === 0` ela não entrava em `frozenC`, não era casada
    // (as três tentativas exigem `!c.frozen`), caía em `toRemove` — e ali, sem
    // boleto ativo nem nota viva, a fatura era CANCELADA e a fatia APAGADA. Uma
    // fatia com `billingApprovedAt` preenchido, destruída em silêncio.
    const rawFrozen = existingC.filter(c => c.frozen && c.rawCoverage.length > 0);
    const orphanedFrozen = rawFrozen
      .flatMap(c => c.rawCoverage)
      .filter(id => !validTaskIds.has(id));
    if (orphanedFrozen.length > 0) {
      throw new BadRequestException(
        `Não é possível retirar do orçamento ${orphanedFrozen.length === 1 ? 'o veículo' : 'os veículos'} ` +
          'cujo faturamento já foi aprovado ou já tem fatura emitida. ' +
          'Reverta o faturamento dessa fatia antes de mexer na frota.',
      );
    }

    const frozenC = existingC.filter(c => c.frozen && c.coverage.length > 0);
    const frozenTaskIds = new Set(frozenC.flatMap(c => c.coverage));
    const freeTaskIds = taskIds.filter(id => !frozenTaskIds.has(id));

    const declared = incomingC.map(explicitCoverage).filter((g): g is string[] => g !== null);

    // ── (b) RECOMPOSIÇÃO QUE MEXE NUMA FATIA CONGELADA É RECUSADA, NÃO FILTRADA ─
    //
    // A tela pode redividir lotes mandando `customerConfigs[].taskIds` SEM tocar
    // em `billingSplit` — e aí a guarda de troca de modo (que olha só
    // `billingSplit`) nem roda. O que acontecia depois: os lotes declarados eram
    // FILTRADOS contra `frozenTaskIds` logo abaixo, a fatia congelada era pulada,
    // e a gravação terminava com sucesso num arranjo diferente do pedido. Zero
    // erro, zero aviso, resultado errado.
    //
    // Agora, pedir para mover um veículo que uma fatia congelada cobre é um erro
    // com nome. Quem declara exatamente a cobertura que já existe não é afetado —
    // é o caso idempotente que a tela manda a cada save.
    if (declared.length > 0 && frozenTaskIds.size > 0) {
      const declaredFrozenMoved: string[] = [];
      for (const group of declared) {
        const groupSet = new Set(group);
        for (const frozenSlice of frozenC) {
          const covers = frozenSlice.coverage.filter(id => groupSet.has(id));
          if (covers.length === 0) continue;
          // O grupo toca esta fatia congelada: só é legítimo se for EXATAMENTE ela.
          const identical =
            covers.length === frozenSlice.coverage.length && group.length === covers.length;
          if (!identical) declaredFrozenMoved.push(...covers);
        }
      }
      if (declaredFrozenMoved.length > 0) {
        throw new BadRequestException(
          'Não é possível recompor os lotes: a mudança pedida move veículo que já está num ' +
            'faturamento aprovado ou com fatura emitida. Reverta o faturamento dessa fatia antes de refatiar.',
        );
      }
    }

    let freeGroups: string[][];
    if (freeTaskIds.length === 0) {
      freeGroups = [];
    } else if (declared.length > 0) {
      // A tela disse quem cobra quem. `CUSTOM` é o sanitizador certo aqui
      // qualquer que seja o modo declarado: ele respeita os lotes recebidos,
      // descarta o que não é veículo deste orçamento e ISOLA o que sobrou.
      freeGroups = planCoverage(
        'CUSTOM',
        freeTaskIds,
        declared.map(g => g.filter(id => !frozenTaskIds.has(id))),
      );
    } else {
      freeGroups = planCoverage(
        billingSplit,
        freeTaskIds,
        existingC.filter(c => !c.frozen).map(c => c.coverage),
      );
    }

    // Orçamento ainda sem veículo: uma fatia, cobertura vazia. É o registro que
    // nasce antes do vínculo, e apagá-lo levaria junto o desconto combinado.
    const plannedGroups: Array<{ coverage: string[]; frozenId: string | null }> = [
      ...frozenC.map(c => ({ coverage: c.coverage, frozenId: c.id })),
      ...freeGroups.map(coverage => ({ coverage, frozenId: null })),
    ];
    if (plannedGroups.length === 0) plannedGroups.push({ coverage: [], frozenId: null });

    // ── 2. QUEM DITA OS TERMOS DE CADA GRUPO ────────────────────────────────
    //
    // O objeto de entrada cuja cobertura declarada é EXATAMENTE este grupo; na
    // falta dele, o primeiro que não declarou cobertura (a tela que só mandou os
    // termos do cliente); na falta dos dois, o primeiro da lista.
    const byDeclaredKey = new Map<string, IncomingCustomerConfig>();
    const byIncomingId = new Map<string, IncomingCustomerConfig>();
    let defaultIncoming: IncomingCustomerConfig | null = null;
    for (const config of incomingC) {
      if (config.id) byIncomingId.set(config.id, config);
      const cov = explicitCoverage(config);
      if (cov) byDeclaredKey.set(coverageKey(cov), config);
      else if (!defaultIncoming) defaultIncoming = config;
    }
    if (!defaultIncoming) defaultIncoming = incomingC[0];

    const availableExisting = existingC.filter(c => !matchedExistingIds.has(c.id));

    for (const planned of plannedGroups) {
      const key = coverageKey(planned.coverage);
      const source = byDeclaredKey.get(key) ?? defaultIncoming;

      // ── 3. CASAR O GRUPO COM UMA LINHA EXISTENTE ─────────────────────────
      let prev: ExistingConfig | null = null;

      // (0) fatia congelada: a linha é ela mesma, sem negociação.
      if (planned.frozenId) {
        prev = availableExisting.find(c => c.id === planned.frozenId) ?? null;
      }
      // (a) o id que a tela mandou.
      if (!prev) {
        const named = source?.id ? byIncomingId.get(source.id) : null;
        if (named?.id) {
          prev =
            availableExisting.find(
              c => c.id === named.id && !matchedExistingIds.has(c.id) && !c.frozen,
            ) ?? null;
        }
      }
      // (b) cobertura idêntica.
      if (!prev) {
        prev =
          availableExisting.find(
            c => !matchedExistingIds.has(c.id) && !c.frozen && coverageKey(c.coverage) === key,
          ) ?? null;
      }
      // (c) maior sobreposição — mantém a linha (e a fatura) viva quando um lote
      //     é redividido, em vez de apagar e recriar.
      if (!prev) {
        let best: ExistingConfig | null = null;
        let bestOverlap = 0;
        for (const candidate of availableExisting) {
          if (matchedExistingIds.has(candidate.id) || candidate.frozen) continue;
          const overlap = candidate.coverage.filter(id => planned.coverage.includes(id)).length;
          // Cobertura vazia dos dois lados (orçamento sem veículo) casa também:
          // sem isto a fatia do registro recém-nascido seria recriada a cada save.
          if (overlap > bestOverlap || (overlap === 0 && bestOverlap === 0 && !best && key === '')) {
            best = candidate;
            bestOverlap = overlap;
          }
        }
        prev = best;
      }

      const writeData = buildConfigWriteData(source ?? { customerId });

      // ── DINHEIRO DE FATIA CONGELADA NÃO SE NEGOCIA ───────────────────────
      //
      // A cobertura de uma fatia congelada já é preservada acima. O VALOR dela
      // precisa da mesma proteção, e por um motivo que não é óbvio: quando o
      // grupo congelado não tem entrada declarada correspondente — e nunca tem,
      // porque a tela manda só os lotes que está recompondo —, `source` cai no
      // `defaultIncoming`, que é a entrada de OUTRO grupo.
      //
      // Isso seria inócuo se a entrada carregasse só termos. Mas
      // `BudgetService.update` grava nela um `subtotal`/`total` PROVISÓRIO,
      // calculado da cobertura DECLARADA daquele outro grupo, contando que
      // `recalcQuoteTotals` corrija tudo no fim da transação. O provisório de
      // três veículos vinha então parar na fatia congelada de um, e o contrato
      // passava a somar 600 onde devia somar 400.
      //
      // `recalcQuoteTotals` deixou de corrigir a fatia congelada de propósito —
      // é o que impede que uma mudança de preço reescreva o número que já saiu
      // na fatura, no boleto e na NFS-e. Com ela não corrigindo, o provisório
      // ficava de pé. A proteção tem de estar aqui, onde a escrita acontece.
      if (planned.frozenId) {
        delete (writeData as Record<string, unknown>).subtotal;
        delete (writeData as Record<string, unknown>).total;
      }

      if (prev) {
        matchedExistingIds.add(prev.id);
        for (const field of [...DISCOUNT_FIELDS, ...DEAL_TERM_FIELDS]) {
          if (!(field in writeData)) continue;
          const beforeRow = storedConfigs.find(c => c.id === prev!.id) as any;
          const before = beforeRow?.[field];
          const after = (writeData as any)[field];
          if (String(before ?? '') !== String(after ?? '')) {
            diff.push({
              type: 'updated',
              customerId,
              field,
              oldValue: before,
              newValue: after,
            });
          }
        }
        if (Object.keys(writeData).length > 0) {
          await tx.budgetPayer.update({ where: { id: prev.id }, data: writeData });
        }
        // A cobertura de uma fatia CONGELADA nunca é reescrita: ela entra no
        // plano exatamente como está, para que a reconciliação dos faturamentos
        // a reconheça em vez de tratá-la como recorte que acabou.
        if (prev.frozen) {
          coveragePlan.set(prev.id, prev.coverage);
        } else {
          // Reagrupar muda o VALOR da fatura sem tocar em nenhum outro campo —
          // vinte veículos viram dez e o boleto cai pela metade. Sem esta linha,
          // a única prova da mudança seria o total, e o total sozinho não diz
          // quem passou a estar com quem.
          if (coverageKey(prev.coverage) !== key) {
            diff.push({
              type: 'updated',
              customerId,
              field: 'billingCoverage',
              oldValue: `${prev.coverage.length} veículo(s)`,
              newValue: `${planned.coverage.length} veículo(s)`,
            });
          }
          coveragePlan.set(prev.id, planned.coverage);
        }
        continue;
      }

      // ── 4. FATIA NOVA — DE QUEM ELA HERDA AS CONDIÇÕES ───────────────────
      //
      // Três origens, na ordem em que respondem certo:
      //
      //  1. OUTRA FATIA DO MESMO CLIENTE neste orçamento. É o caso mais
      //     frequente: trocar `JOINT` por `PER_TASK` cria sessenta, dividir um
      //     lote cria mais uma, acrescentar um caminhão cria a sexagésima
      //     primeira. Sem herança, cada uma nasceria com
      //     `discountType DEFAULT 'NONE'`, `recalcQuoteTotals` levantaria o total
      //     ao subtotal e a aprovação congelaria o valor inflado em
      //     `Invoice.totalAmount` — o desconto combinado sumindo em sessenta
      //     faturas de uma vez.
      //  2. O CLIENTE SUBSTITUÍDO, quando a troca é 1:1 e inequívoca.
      //  3. Ninguém — cliente genuinamente novo, condições vêm do payload.
      let inherited = false;
      const donorRow =
        (storedConfigs.find(c => c.customerId === customerId) as any) ??
        (replacedCustomerId && addedCustomers.includes(customerId)
          ? (storedConfigs.find(c => c.customerId === replacedCustomerId) as any)
          : null);

      if (donorRow) {
        // O desconto sobrescreve um 'NONE' EXPLÍCITO de propósito: toda tela
        // manda `discountType: "NONE"` para um cliente recém-adicionado, então
        // uma regra que só preenchesse ausências nunca dispararia justamente nos
        // caminhos que causaram o prejuízo real. Consequência assumida: limpar um
        // desconto e trocar o cliente não cabem na mesma gravação — limpe numa
        // gravação separada.
        if (hasNoEffectiveDiscount(source ?? {}) && !hasNoEffectiveDiscount(donorRow)) {
          for (const field of DISCOUNT_FIELDS) (writeData as any)[field] = donorRow[field];
          inherited = true;
        }
        // As condições de pagamento seguem a regra documentada "ausência =
        // preserva": só se preenche o que o payload não trouxe de forma alguma.
        for (const field of DEAL_TERM_FIELDS) {
          if (!(field in writeData)) (writeData as any)[field] = donorRow[field];
        }
      }

      diff.push({
        type: 'added',
        customerId,
        newValue: {
          discountType: (writeData as any).discountType ?? 'NONE',
          discountValue: (writeData as any).discountValue ?? null,
          discountReference: (writeData as any).discountReference ?? null,
        },
        inherited,
      });

      // O FATURAMENTO PRIMEIRO. `billingId` é `NOT NULL`, e é de propósito: um
      // pagador sem faturamento é um registro que não responde "cobrando o quê?".
      // Achar-ou-criar pela COBERTURA é o que faz dois pagadores do mesmo recorte
      // caírem no mesmo `Billing` já na criação, em vez de nascerem em dois e
      // serem fundidos depois.
      const billingId = await ensureBillingForCoverage(tx, quoteId, planned.coverage);
      const created = await tx.budgetPayer.create({
        data: { quoteId, billingId, customerId, ...writeData },
      });
      coveragePlan.set(created.id, planned.coverage);
    }
  }

  // ── 5. Apaga SÓ o que saiu, guardando o que já foi emitido ────────────────
  //
  // "Saiu" é: a linha não foi casada com nenhum grupo planejado. Cobre os quatro
  // casos — cliente removido, modo trocado, lote redividido e veículo retirado do
  // orçamento — com a mesma conta. Fatias congeladas nunca chegam aqui: elas são
  // semeadas no plano antes de qualquer outra coisa.
  const toRemove = existing.filter(c => !matchedExistingIds.has(c.id));
  let cancelledInvoices = false;
  const cancelledInvoiceBillingIds = new Set<string>();
  if (toRemove.length > 0) {
    const removeIds = toRemove.map(c => c.id);

    // ── A OBRIGAÇÃO PAGA NÃO DEPENDE DO STATUS DA FATURA ──────────────────────
    //
    // A guarda abaixo só olhava faturas `status <> 'CANCELLED'`. Uma parcela PAGA
    // pendurada numa fatura CANCELADA — o que sobra de um ciclo revertido — não
    // era vista por ninguém, e o `deleteMany` da fatia a levava junto, com o
    // boleto e o `ReconciliationMatch`. Dinheiro recebido sumia do sistema.
    //
    // (O `onDelete` dessas relações virou `Restrict` na mesma leva, então hoje o
    // banco também recusaria. Esta guarda existe para recusar com uma frase que
    // diga o que fazer, em vez de um erro de integridade referencial.)
    const paidOutsideLiveInvoice = await tx.installment.findFirst({
      where: { customerConfigId: { in: removeIds }, status: 'PAID' },
      select: { id: true, number: true, customerConfigId: true },
    });
    if (paidOutsideLiveInvoice) {
      throw new BadRequestException(
        'Não é possível remover este faturamento: existe parcela PAGA vinculada a ele ' +
          `(parcela ${paidOutsideLiveInvoice.number}), inclusive de ciclos já cancelados. ` +
          'Dinheiro recebido não é apagado por recomposição de cobertura.',
      );
    }

    const blockingInvoices = await tx.invoice.findMany({
      where: { customerConfigId: { in: removeIds }, status: { not: 'CANCELLED' } },
      include: {
        installments: { include: { bankSlip: { select: { status: true } } } },
        nfseDocuments: { select: { status: true } },
      },
    });

    for (const inv of blockingInvoices) {
      const hasActiveBankSlip = (inv.installments || []).some(
        (inst: any) => inst.bankSlip && inst.bankSlip.status !== 'CANCELLED',
      );
      const hasPaidInstallment = (inv.installments || []).some(
        (inst: any) => inst.status === 'PAID',
      );
      // A "live" municipal note is anything past PENDING that isn't fully dead:
      // AUTHORIZED, an in-flight cancel (CANCEL_REQUESTED), a rejected cancel
      // (CANCEL_REJECTED → note still live), or mid-emission (PROCESSING/PENDING).
      // Only CANCELLED / ERROR (never-emitted) are safe to drop. Blocking on just
      // AUTHORIZED let a config be removed out from under an in-flight note.
      const hasActiveNfse = (inv.nfseDocuments || []).some(
        (nfse: any) => nfse.status !== 'CANCELLED' && nfse.status !== 'ERROR',
      );

      if (hasActiveBankSlip || hasPaidInstallment || hasActiveNfse) {
        throw new BadRequestException(
          'Não é possível remover um cliente do faturamento enquanto houver boletos ativos, parcelas pagas ou notas fiscais autorizadas. Cancele-os primeiro.',
        );
      }

      // Inactive obligations: cancel the stale invoice before removing its config.
      await tx.invoice.update({ where: { id: inv.id }, data: { status: 'CANCELLED' } });
      cancelledInvoices = true;
      // O FATURAMENTO de quem perdeu a fatura — nominalmente. É o que permite ao
      // chamador desaprovar só este, em vez de todos os do orçamento.
      const dono = toRemove.find(c => c.id === (inv as any).customerConfigId);
      if (dono?.billingId) cancelledInvoiceBillingIds.add(dono.billingId);
    }

    for (const removed of toRemove) {
      diff.push({
        type: 'removed',
        customerId: removed.customerId,
        oldValue: {
          discountType: removed.discountType,
          discountValue: removed.discountValue,
          discountReference: removed.discountReference,
        },
      });
    }

    // ── DESMONTAGEM EXPLÍCITA ────────────────────────────────────────────────
    //
    // As FKs de `Invoice`/`Installment`/`BankSlip` deixaram de ser `Cascade`: o
    // banco não apaga mais dinheiro por efeito colateral de um `deleteMany` de
    // fatia. Quem remove diz o que acontece com cada peça, nesta ordem, e só
    // chega aqui o que a guarda acima já declarou descartável — nenhuma parcela
    // paga, nenhum boleto ativo, nenhuma nota viva.
    await deleteInstallmentsWithSlips(tx, { customerConfigId: { in: removeIds } });
    // A NOTA FISCAL NÃO É APAGADA. `NfseDocument.invoiceId` é `SetNull` de
    // propósito: nota emitida sobrevive à fatura e continua sendo o histórico
    // fiscal do orçamento. Só as canceladas/ERROR chegam até aqui.
    await tx.invoice.deleteMany({ where: { customerConfigId: { in: removeIds } } });
    await tx.budgetPayer.deleteMany({ where: { id: { in: removeIds } } });
  }

  // ── 6. E OS FATURAMENTOS ──────────────────────────────────────────────────
  //
  // Último passo de propósito: os pagadores já estão certos, e é deles que sai a
  // única pergunta que o `Billing` responde — quais veículos são cobrados juntos.
  // Passar por aqui é o que faz a troca de modo criar e destruir ENTIDADES em vez
  // de mudar um campo. `reconcileQuoteCustomerConfigs` é o funil único de toda
  // recomposição, então nenhum caminho de escrita escapa.
  await reconcileBillingsForQuote(tx, quoteId, coveragePlan);

  return {
    cancelledInvoices,
    cancelledInvoiceBillingIds: [...cancelledInvoiceBillingIds],
    customerIds: [...incomingCustomerIdSet],
    diff,
  };
}

/**
 * REFATIA a cobertura de um orçamento SEM tocar em nenhum termo.
 *
 * Existe porque a cobertura é derivada de duas coisas que mudam por caminhos que
 * não trazem `customerConfigs` no corpo:
 *
 *   · o CONJUNTO DE VEÍCULOS — acrescentar ou retirar um caminhão, criar a
 *     tarefa depois do orçamento (a criação aninhada por `POST /tasks` faz
 *     exatamente isso: o orçamento nasce primeiro, a tarefa depois), mover uma
 *     tarefa de um orçamento para outro;
 *   · o MODO (`billingSplit`), editável sozinho pelo seletor da tela.
 *
 * Sem esta chamada, o primeiro caso deixa a fatura sem o veículo novo (ou com
 * linha de cobertura apontando para um caminhão que saiu) e o segundo deixa o
 * orçamento afirmando um modo que a cobertura contradiz.
 *
 * ⚠️ NÃO PASSA NENHUM TERMO. Os objetos de entrada levam só `customerId`, e
 * `buildConfigWriteData` de um objeto assim devolve `{}` — nenhuma coluna é
 * escrita. É deliberado: um refatiamento que carregasse os termos do PRIMEIRO
 * faturamento de cada cliente os aplicaria a todos os outros, que é exatamente o
 * defeito que o casamento por identidade existe para acabar.
 */
export async function resliceQuoteCoverage(
  tx: PrismaTransaction,
  quoteId: string,
  options?: { billingSplit?: string | null; taskIds?: readonly string[] | null },
): Promise<void> {
  const stored = await tx.budgetPayer.findMany({
    where: { quoteId },
    select: { customerId: true },
    orderBy: { createdAt: 'asc' },
  });
  const customerIds = [...new Set(stored.map(c => c.customerId))];
  if (customerIds.length === 0) return;

  await reconcileQuoteCustomerConfigs(
    tx,
    quoteId,
    customerIds.map(customerId => ({ customerId })),
    options,
  );
}

/**
 * Acha — ou cria — o `Billing` deste orçamento que cobre EXATAMENTE estes veículos.
 *
 * Existe porque um pagador não pode nascer sem faturamento (`billingId` é
 * `NOT NULL`), e a criação do pagador acontece antes de a reconciliação final
 * rodar. Casar por cobertura idêntica é o que garante que dois pagadores do
 * mesmo recorte compartilhem a MESMA entidade desde o primeiro instante.
 *
 * NÃO escreve cobertura — ver o comentário no corpo. Um `Billing` criado aqui é
 * um provisório que a reconciliação final vai confirmar (dando-lhe cobertura) ou
 * descartar. O churn é de uma transação só, e o estado final é o certo.
 */
export async function ensureBillingForCoverage(
  tx: PrismaTransaction,
  quoteId: string,
  coverage: readonly string[],
): Promise<string> {
  const alvo = [...coverage].sort().join('|');
  const existentes = await (tx as any).billing.findMany({
    where: { quoteId },
    select: { id: true, tasks: { select: { taskId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  for (const b of existentes) {
    const k = (b.tasks ?? []).map((t: { taskId: string }) => t.taskId).sort().join('|');
    if (k === alvo) return b.id;
  }
  // NASCE SEM COBERTURA, e é essencial que seja assim.
  //
  // A primeira versão escrevia a cobertura aqui, e com isso ROUBAVA os veículos
  // do faturamento anterior: ao trocar "os quatro juntos" por "um por veículo", o
  // `Billing` dos quatro perdia três e ficava com um — e a reconciliação final,
  // que casa por cobertura idêntica, o reconhecia como "o faturamento do veículo
  // 1" e o preservava. O recorte de quatro tinha acabado e a entidade continuava
  // viva, disfarçada. Que é exatamente o "mudar de forma" que este modelo existe
  // para não fazer.
  //
  // Quem atribui cobertura é `reconcileBillingsForQuote`, uma vez, no fim, com o
  // quadro inteiro na mão. Isto aqui só entrega um `id` para o `NOT NULL`.
  const novo = await (tx as any).billing.create({ data: { quoteId }, select: { id: true } });
  return novo.id;
}

/**
 * RECONCILIA OS FATURAMENTOS DO ORÇAMENTO — as entidades, não a configuração.
 *
 * Roda depois que os pagadores (`BudgetPayer`) já estão certos, e
 * deriva deles a única coisa que o modelo novo afirma: **um grupo de veículos
 * cobrados juntos é um `Billing`**.
 *
 * O QUE ISSO MUDA NA PRÁTICA
 *   Trocar "uma fatura para os quatro" por "uma por veículo" deixa de ser um
 *   campo que muda de valor. O `Billing` que cobria os quatro **é apagado** e
 *   **nascem quatro**, cada um com o seu `id`. Trocar de volta apaga os quatro e
 *   cria um — novo, porque é outra entidade, não a antiga reaproveitada. É
 *   exatamente o que o dono pediu quando disse "realmente múltiplos faturamentos,
 *   cada um com seu uuid, cada um sendo um".
 *
 * DOIS PAGADORES NÃO SÃO DOIS FATURAMENTOS
 *   O grupo é definido pela COBERTURA, não pelo cliente. Dois pagadores que
 *   cobram os mesmos veículos caem no MESMO `Billing`, com dois configs dentro —
 *   e é por isso que `BillingTask.@@unique([taskId])` pode ser mais forte que a
 *   regra antiga sem recusar nada que hoje existe.
 *
 * DERIVADO, E IDEMPOTENTE
 *   Não há estado próprio a preservar ainda, então reconciliar a partir da
 *   cobertura é exato: rodar duas vezes seguidas produz o mesmo conjunto de
 *   `Billing`, com os mesmos ids. Um `Billing` só troca de id quando o recorte
 *   que ele representava deixou de existir — que é quando ele deixou de existir.
 */
export async function reconcileBillingsForQuote(
  tx: PrismaTransaction,
  quoteId: string,
  /**
   * O PLANO: `configId` → os veículos que aquele pagador passará a cobrar.
   *
   * Omitido = "não muda nada, só confira", e a cobertura lida é a que já está
   * gravada. É o modo dos chamadores que tocam OUTRA coisa (mover tarefa, apagar
   * tarefa) e precisam que os faturamentos continuem coerentes depois.
   */
  plan?: ReadonlyMap<string, readonly string[]>,
): Promise<{ created: number; deleted: number; billings: number }> {
  const configs = await (tx as any).budgetPayer.findMany({
    where: { quoteId },
    select: {
      id: true,
      billingId: true,
      billing: { select: { tasks: { select: { taskId: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });

  /** A chave do grupo: a cobertura ORDENADA. Cobertura vazia é um grupo legítimo
   *  — é o orçamento que ainda não tem veículo, e apagá-lo levaria junto o
   *  desconto já combinado com o cliente. */
  const keyOf = (ids: readonly string[]) => [...ids].sort().join('|');

  const grupos = new Map<string, { coverage: string[]; configIds: string[] }>();
  for (const c of configs) {
    const planned = plan?.get(c.id);
    const coverage: string[] = [
      ...(planned ?? (c.billing?.tasks ?? []).map((r: { taskId: string }) => r.taskId)),
    ];
    const k = keyOf(coverage);
    const g = grupos.get(k);
    if (g) g.configIds.push(c.id);
    else grupos.set(k, { coverage, configIds: [c.id] });
  }

  const existentes = await (tx as any).billing.findMany({
    where: { quoteId },
    select: { id: true, tasks: { select: { taskId: true } } },
    orderBy: { createdAt: 'asc' },
  });

  // Casa por COBERTURA IDÊNTICA. Um `Billing` cuja cobertura mudou não é o mesmo
  // faturamento com outro recorte — é um recorte que acabou e outro que começou.
  const porChave = new Map<string, string>();
  const livres: string[] = [];
  for (const b of existentes) {
    const k = keyOf((b.tasks ?? []).map((t: { taskId: string }) => t.taskId));
    if (grupos.has(k) && !porChave.has(k)) porChave.set(k, b.id);
    else livres.push(b.id);
  }

  let created = 0;
  const idPorChave = new Map<string, string>();
  for (const [k, g] of grupos) {
    const jaTem = porChave.get(k);
    if (jaTem) {
      idPorChave.set(k, jaTem);
      continue;
    }
    const novo = await (tx as any).billing.create({ data: { quoteId }, select: { id: true } });
    idPorChave.set(k, novo.id);
    created++;
    logger.log(
      `[Billing] Orçamento ${quoteId}: faturamento ${novo.id} criado cobrindo ${g.coverage.length} veículo(s).`,
    );
  }

  // Cada pagador aponta para o faturamento do seu recorte.
  for (const [k, g] of grupos) {
    const billingId = idPorChave.get(k)!;
    const mudaram = g.configIds.filter(
      id => configs.find((c: any) => c.id === id)?.billingId !== billingId,
    );
    if (mudaram.length > 0) {
      await (tx as any).budgetPayer.updateMany({
        where: { id: { in: mudaram } },
        data: { billingId },
      });
    }
  }

  // A COBERTURA. Apagar antes de inserir não é zelo: `BillingTask.@@unique([taskId])`
  // é global, e um veículo que muda de faturamento colidiria com a própria linha
  // antiga se as duas existissem por um instante.
  const todosTaskIds = [...grupos.values()].flatMap(g => g.coverage);
  if (todosTaskIds.length > 0) {
    await (tx as any).billingTask.deleteMany({ where: { taskId: { in: todosTaskIds } } });
  }
  for (const [k, g] of grupos) {
    if (g.coverage.length === 0) continue;
    await (tx as any).billingTask.createMany({
      data: g.coverage.map(taskId => ({ billingId: idPorChave.get(k)!, taskId })),
      skipDuplicates: true,
    });
  }

  // Os que sobraram representavam recortes que deixaram de existir.
  let deleted = 0;
  if (livres.length > 0) {
    const res = await (tx as any).billing.deleteMany({ where: { id: { in: livres } } });
    deleted = res.count;
    logger.log(`[Billing] Orçamento ${quoteId}: ${deleted} faturamento(s) apagado(s) — o recorte acabou.`);
  }

  return { created, deleted, billings: grupos.size };
}
