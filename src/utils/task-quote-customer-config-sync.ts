/**
 * Reconciliação não-destrutiva dos FATURAMENTOS de um orçamento.
 *
 * O defeito histórico: todo caminho de gravação fazia
 *   `deleteMany({ quoteId }) + createMany(...)`
 * em `TaskQuoteCustomerConfig`. Como a linha é o pai `onDelete: Cascade` de
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
  // manda) e quem o traduz para as tarefas é `TaskQuoteService`.
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
  billingApprovedAt: Date | null;
  discountType: string | null;
  discountValue: unknown;
  discountReference: string | null;
  coverage: string[];
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
    (await tx.taskQuote.findUnique({ where: { id: quoteId }, select: { billingSplit: true } }))
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

  const storedConfigs = await tx.taskQuoteCustomerConfig.findMany({
    where: { quoteId },
    orderBy: { createdAt: 'asc' },
    include: {
      coveredTasks: { select: { taskId: true } },
      invoice: { select: { id: true, status: true } },
    },
  });

  const validTaskIds = new Set(taskIds);
  const existing: ExistingConfig[] = storedConfigs.map(c => ({
    id: c.id,
    customerId: c.customerId,
    billingApprovedAt: (c as any).billingApprovedAt ?? null,
    discountType: c.discountType as any,
    discountValue: c.discountValue,
    discountReference: c.discountReference,
    // Cobertura saneada: um veículo retirado do orçamento nesta mesma gravação
    // ainda tem linha de cobertura (a exclusão em cascata acontece depois), e
    // mantê-lo aqui faria o plano reservá-lo para uma fatia que vai perdê-lo.
    coverage: ((c as any).coveredTasks ?? [])
      .map((r: { taskId: string }) => r.taskId)
      .filter((id: string) => validTaskIds.has(id)),
    // CONGELADO: já faturado, ou com fatura viva. Cobertura imutável.
    frozen:
      !!(c as any).billingApprovedAt ||
      (!!(c as any).invoice && (c as any).invoice.status !== 'CANCELLED'),
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

  for (const customerId of incomingCustomerIds) {
    const incomingC = incomingByCustomer.get(customerId)!;
    const existingC = existingByCustomer.get(customerId) ?? [];

    // ── 1. O PLANO DE COBERTURA DESTE CLIENTE ───────────────────────────────
    //
    // O que já foi faturado entra primeiro e sai do bolo: os veículos de uma
    // fatia congelada não são repartidos por ninguém, em nenhum modo.
    const frozenC = existingC.filter(c => c.frozen && c.coverage.length > 0);
    const frozenTaskIds = new Set(frozenC.flatMap(c => c.coverage));
    const freeTaskIds = taskIds.filter(id => !frozenTaskIds.has(id));

    const declared = incomingC.map(explicitCoverage).filter((g): g is string[] => g !== null);

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
          await tx.taskQuoteCustomerConfig.update({ where: { id: prev.id }, data: writeData });
        }
        // A cobertura de uma fatia congelada NUNCA é reescrita.
        if (!prev.frozen) {
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
          await syncCoverage(tx, prev.id, customerId, prev.coverage, planned.coverage);
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

      const created = await tx.taskQuoteCustomerConfig.create({
        data: { quoteId, customerId, ...writeData },
      });
      await syncCoverage(tx, created.id, customerId, [], planned.coverage);
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
  if (toRemove.length > 0) {
    const removeIds = toRemove.map(c => c.id);
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

    await tx.taskQuoteCustomerConfig.deleteMany({ where: { id: { in: removeIds } } });
  }

  return { cancelledInvoices, customerIds: [...incomingCustomerIdSet], diff };
}

/**
 * Escreve a cobertura de uma fatia — só o delta.
 *
 * Apagar tudo e recriar funcionaria e seria mais curto, mas `QuoteBillingTask`
 * carrega `createdAt`, e é por ele que a ordem de um lote se mantém estável
 * entre duas leituras. Um lote que muda de ordem a cada save muda a âncora, e a
 * âncora batiza arquivo e link.
 */
async function syncCoverage(
  tx: PrismaTransaction,
  configId: string,
  customerId: string,
  before: readonly string[],
  after: readonly string[],
): Promise<void> {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);

  const toDelete = before.filter(id => !afterSet.has(id));
  if (toDelete.length > 0) {
    await tx.quoteBillingTask.deleteMany({ where: { configId, taskId: { in: toDelete } } });
  }

  const toCreate = after.filter(id => !beforeSet.has(id));
  if (toCreate.length > 0) {
    // ── O VEÍCULO SAI DA OUTRA FATIA ANTES DE ENTRAR NESTA ──────────────────
    //
    // Um veículo é cobrado por UMA fatia daquele cliente — índice único
    // `(taskId, customerId)`. Quando o plano MOVE um caminhão de uma fatia para
    // outra (compor um lote a partir do faturamento por veículo, redividir um
    // lote, remover uma fatia), a linha antiga ainda está de pé neste ponto: as
    // fatias que saíram só são apagadas no fim da reconciliação, e a que perdeu
    // o veículo pode ser processada DEPOIS desta.
    //
    // O insert então esbarrava no índice e `skipDuplicates` o descartava EM
    // SILÊNCIO — o veículo terminava a transação em fatura NENHUMA. Era assim
    // que compor "dois no pedido 8842, dois no 9013" a partir de quatro fatias
    // por veículo devolvia quatro fatias por veículo de novo, sem erro nenhum.
    //
    // Escopo: o mesmo cliente, e nunca esta fatia. Uma fatia CONGELADA não perde
    // veículo aqui porque o plano jamais entrega a outro grupo um veículo que
    // ela cobre — a cobertura dela é semeada antes de tudo e sai do bolo.
    await tx.quoteBillingTask.deleteMany({
      where: { customerId, taskId: { in: toCreate }, configId: { not: configId } },
    });
    // `skipDuplicates` cobre a corrida entre duas gravações do mesmo orçamento;
    // o índice único continua sendo quem garante que o veículo não acaba em duas
    // faturas do mesmo cliente — aqui ele só não derruba a transação por uma
    // repetição idêntica.
    await tx.quoteBillingTask.createMany({
      data: toCreate.map(taskId => ({ configId, taskId, customerId })),
      skipDuplicates: true,
    });
  }
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
  const stored = await tx.taskQuoteCustomerConfig.findMany({
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
