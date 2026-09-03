/**
 * Non-destructive reconciliation of a TaskQuote's per-customer billing configs.
 *
 * The historical bug: every quote-write path did
 *   `deleteMany({ quoteId }) + createMany(...)`
 * on `TaskQuoteCustomerConfig`. Because the config row is the `onDelete: Cascade`
 * parent of `Invoice` (@unique) and `Installment`, that destroy-and-recreate:
 *   - silently dropped DB-owned fields the form never resends
 *     (`customerSignatureId`, `orderNumber`, `paymentConfig`);
 *   - could cascade-delete an issued Invoice + its Installments;
 *   - churned the row id every save.
 *
 * This helper reconciles by the natural `@@unique([quoteId, customerId])` key
 * instead: it UPDATES matching rows in place (so children + DB-owned fields
 * survive), CREATES new customers, and DELETES only the customers the payload
 * actually removed. A removed customer that still has live financial obligations
 * (active bank slip / paid installment / authorized NFS-e) blocks the operation;
 * a removed customer with only inactive obligations has its stale invoice
 * cancelled first.
 *
 * SAFE-FIX INVARIANT: absence = preserve. A field is written ONLY when the
 * incoming config carries it (`!== undefined`); an omitted field keeps the
 * existing row's value. Never `x || null` (which would conflate "untouched"
 * with "clear").
 */
import { BadRequestException } from '@nestjs/common';
import { expectedConfigTaskIds } from './quote-money';
import { PrismaTransaction } from '../modules/common/base/base.repository';

export interface IncomingCustomerConfig {
  customerId: string;
  /**
   * A FATIA que esta configuração representa: a tarefa que ela fatura, `null`
   * para "todas as do orçamento", ou AUSENTE para "expanda pelo modo de
   * faturamento".
   *
   * A distinção entre `null` e ausente importa: `null` é uma instrução explícita
   * ("esta é a fatia única"), ausente delega ao servidor — que é o que toda tela
   * faz, para não ter de montar sessenta objetos idênticos.
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
  orderNumber?: string | null;
  responsibleId?: string | null;
  paymentCondition?: string | null;
  paymentConfig?: unknown;
  customerSignatureId?: string | null;
}

/**
 * Build the Prisma write payload for one config, including ONLY the fields the
 * incoming object actually carries. Works for both `create` (omitted fields fall
 * back to the column @default) and `update` (omitted fields are left untouched).
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
  if (config.orderNumber !== undefined) d.orderNumber = config.orderNumber ?? null;
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
 *  belongs to the person who signed) and `orderNumber` (the replaced customer's PO). */
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
  const existing = await tx.taskQuoteCustomerConfig.findMany({ where: { quoteId } });
  const diff: ConfigDiffEntry[] = [];

  // ── AS FATIAS ─────────────────────────────────────────────────────────────
  //
  // A chave natural da configuração era `(quoteId, customerId)`. Passou a ser
  // `(quoteId, customerId, taskId)`, porque com `PER_TASK` o mesmo cliente tem
  // uma configuração por veículo — cada uma com sua fatura, seu plano de
  // parcelas e sua NFS-e.
  //
  // ⚠️ Isto NÃO é detalhe de indexação. Um mapa chaveado só por cliente, como o
  // anterior, colapsaria as sessenta configurações do Marquespan numa e a
  // reconciliação APAGARIA cinquenta e nove — com as faturas, as parcelas e os
  // boletos delas, por cascata. A chave composta é o que impede isso.
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
  const slices = expectedConfigTaskIds(billingSplit, taskIds);

  /** Chave composta estável. Fatia nula (`JOINT`) usa string vazia. */
  const keyOf = (customerId: string, taskId: string | null) => `${customerId}::${taskId ?? ''}`;

  const existingByKey = new Map(existing.map(c => [keyOf(c.customerId, c.taskId ?? null), c]));
  /** Todas as configurações de um cliente, qualquer fatia — a base da herança. */
  const existingByCustomer = new Map<string, typeof existing>();
  for (const c of existing) {
    const list = existingByCustomer.get(c.customerId) ?? [];
    list.push(c);
    existingByCustomer.set(c.customerId, list);
  }

  const incomingCustomerIds = new Set(incomingConfigs.map(c => c.customerId));

  /** O produto (cliente × fatia) que este orçamento deve ter ao fim. */
  const wanted: Array<{ config: IncomingCustomerConfig; taskId: string | null }> = [];
  for (const config of incomingConfigs) {
    // Uma configuração que veio com `taskId` explícito é edição de UMA fatia (a
    // tela mexeu só no caminhão 37) e não se expande.
    if (config.taskId !== undefined && config.taskId !== null) {
      wanted.push({ config, taskId: config.taskId });
      continue;
    }
    for (const taskId of slices) wanted.push({ config, taskId });
  }
  const wantedKeys = new Set(wanted.map(w => keyOf(w.config.customerId, w.taskId)));

  // ── Customer REPLACEMENT detection ────────────────────────────────────────
  // A swap is not modelled by the per-customer upsert below: it decomposes into
  // create(new) + delete(old), and on the CREATE branch every field the payload
  // omits falls through to the column @default — `discountType DEFAULT 'NONE'`.
  // recalcQuoteTotals then raises `total` to `subtotal` and internalApprove freezes
  // that inflated figure into Invoice.totalAmount. That is how agreed discounts were
  // silently dropped (and customers over-billed) on every client: web wizards, the
  // task-detail inline editor, mobile, and batch updates all funnel through here.
  //
  // When exactly one config is removed and exactly one created, the operation is an
  // unambiguous 1:1 replacement, so the displaced row's deal terms carry forward.
  // Multi-config reshuffles are left alone — there is no non-guessing way to map
  // several removals onto several creations.
  //
  // ⚠️ A troca é detectada por CLIENTE, nunca por fatia. Num orçamento
  // `PER_TASK` de sessenta caminhões, substituir o cliente decompõe em sessenta
  // remoções e sessenta criações, e uma heurística que exige exatamente 1+1
  // nunca dispararia — o desconto seria perdido nas sessenta faturas de uma vez,
  // que é a versão em escala do prejuízo que ela existe para evitar.
  const removedConfigs = existing.filter(
    c => !wantedKeys.has(keyOf(c.customerId, c.taskId ?? null)),
  );
  const removedCustomers = [...new Set(removedConfigs.map(c => c.customerId))].filter(
    id => !incomingCustomerIds.has(id),
  );
  const addedCustomers = incomingConfigs
    .map(c => c.customerId)
    .filter(id => !existingByCustomer.has(id));
  const replacedCustomerId =
    removedCustomers.length === 1 && addedCustomers.length === 1 ? removedCustomers[0] : null;

  // ── Upsert de cada (cliente × fatia) ──────────────────────────────────────
  for (const { config, taskId: sliceTaskId } of wanted) {
    const prev = existingByKey.get(keyOf(config.customerId, sliceTaskId));
    const writeData = buildConfigWriteData(config);
    if (prev) {
      // Update in place — preserves id, issued Invoice/Installments, and any
      // DB-owned field the payload didn't carry (signature/orderNumber/...).
      for (const field of [...DISCOUNT_FIELDS, ...DEAL_TERM_FIELDS]) {
        if (!(field in writeData)) continue;
        const before = (prev as any)[field];
        const after = (writeData as any)[field];
        if (String(before ?? '') !== String(after ?? '')) {
          diff.push({
            type: 'updated',
            customerId: config.customerId,
            field,
            oldValue: before,
            newValue: after,
          });
        }
      }
      await tx.taskQuoteCustomerConfig.update({ where: { id: prev.id }, data: writeData });
    } else {
      let inherited = false;
      // ── DE QUEM ESTA FATIA NOVA HERDA AS CONDIÇÕES ──────────────────────
      //
      // Três origens, na ordem em que respondem certo:
      //
      //  1. OUTRA FATIA DO MESMO CLIENTE neste orçamento. É o caso novo e o mais
      //     frequente: trocar `JOINT` por `PER_TASK` remove a fatia única e cria
      //     sessenta; acrescentar um caminhão a um orçamento `PER_TASK` cria a
      //     sexagésima primeira. Sem herança, cada uma dessas nasceria com
      //     `discountType DEFAULT 'NONE'`, `recalcQuoteTotals` levantaria o total
      //     ao subtotal e a aprovação congelaria o valor inflado em
      //     `Invoice.totalAmount` — o desconto combinado sumindo em sessenta
      //     faturas de uma vez.
      //  2. O CLIENTE SUBSTITUÍDO, quando a troca é 1:1 e inequívoca. É a regra
      //     que já existia, agora avaliada por cliente e não por linha.
      //  3. Ninguém — cliente genuinamente novo, condições vêm do payload.
      const donor =
        existingByCustomer.get(config.customerId)?.[0] ??
        (replacedCustomerId && addedCustomers.includes(config.customerId)
          ? (existingByCustomer.get(replacedCustomerId)?.[0] ?? null)
          : null);

      if (donor) {
        // O desconto sobrescreve um 'NONE' EXPLÍCITO de propósito: toda tela
        // manda `discountType: "NONE"` para um cliente recém-adicionado, então
        // uma regra que só preenchesse ausências nunca dispararia justamente nos
        // caminhos que causaram o prejuízo real. Consequência assumida: limpar um
        // desconto e trocar o cliente não cabem na mesma gravação — limpe numa
        // gravação separada.
        if (hasNoEffectiveDiscount(config) && !hasNoEffectiveDiscount(donor)) {
          for (const field of DISCOUNT_FIELDS) (writeData as any)[field] = (donor as any)[field];
          inherited = true;
        }
        // As condições de pagamento seguem a regra documentada "ausência =
        // preserva": só se preenche o que o payload não trouxe de forma alguma.
        for (const field of DEAL_TERM_FIELDS) {
          if (!(field in writeData)) (writeData as any)[field] = (donor as any)[field];
        }
      }
      diff.push({
        type: 'added',
        customerId: config.customerId,
        newValue: {
          discountType: (writeData as any).discountType ?? 'NONE',
          discountValue: (writeData as any).discountValue ?? null,
          discountReference: (writeData as any).discountReference ?? null,
        },
        inherited,
      });
      await tx.taskQuoteCustomerConfig.create({
        data: {
          quoteId,
          customerId: config.customerId,
          ...(sliceTaskId ? { taskId: sliceTaskId } : {}),
          ...writeData,
        },
      });
    }
  }

  // ── Apaga SÓ as fatias que saíram, guardando o que já foi emitido ────────
  //
  // "Saiu" é: o par (cliente, fatia) não está no conjunto desejado. Cobre os
  // três casos — cliente removido, modo de faturamento trocado e veículo
  // retirado do orçamento — com a mesma conta.
  const toRemove = removedConfigs;
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

  return { cancelledInvoices, customerIds: [...incomingCustomerIds], diff };
}
