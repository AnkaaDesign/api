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
import { PrismaTransaction } from '../modules/common/base/base.repository';

export interface IncomingCustomerConfig {
  customerId: string;
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
  if (config.discountReference !== undefined) d.discountReference = config.discountReference ?? null;
  if (config.customPaymentText !== undefined) d.customPaymentText = config.customPaymentText ?? null;
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
): Promise<ReconcileConfigsResult> {
  const existing = await tx.taskQuoteCustomerConfig.findMany({ where: { quoteId } });
  const existingByCustomer = new Map(existing.map(c => [c.customerId, c]));
  const incomingCustomerIds = new Set(incomingConfigs.map(c => c.customerId));
  const diff: ConfigDiffEntry[] = [];

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
  const removedConfigs = existing.filter(c => !incomingCustomerIds.has(c.customerId));
  const addedConfigs = incomingConfigs.filter(c => !existingByCustomer.has(c.customerId));
  const replacedBy =
    removedConfigs.length === 1 && addedConfigs.length === 1 ? removedConfigs[0] : null;

  // ── Upsert each incoming config by (quoteId, customerId) ──────────────────
  for (const config of incomingConfigs) {
    const prev = existingByCustomer.get(config.customerId);
    const writeData = buildConfigWriteData(config);
    if (prev) {
      // Update in place — preserves id, issued Invoice/Installments, and any
      // DB-owned field the payload didn't carry (signature/orderNumber/...).
      for (const field of [...DISCOUNT_FIELDS, ...DEAL_TERM_FIELDS]) {
        if (!(field in writeData)) continue;
        const before = (prev as any)[field];
        const after = (writeData as any)[field];
        if (String(before ?? '') !== String(after ?? '')) {
          diff.push({ type: 'updated', customerId: config.customerId, field, oldValue: before, newValue: after });
        }
      }
      await tx.taskQuoteCustomerConfig.update({ where: { id: prev.id }, data: writeData });
    } else {
      let inherited = false;
      if (replacedBy && config.customerId === addedConfigs[0].customerId) {
        // Deal terms carry over unless the payload explicitly sets a DIFFERENT one.
        // For the discount this must override an explicit 'NONE': every web wizard
        // unconditionally sends `discountType: "NONE"` for a newly added customer,
        // so an absence-only rule would never fire for the paths that caused the
        // real losses. Consequence, by design: clearing a discount and swapping the
        // customer cannot happen in a single save — clear it in a separate save.
        if (hasNoEffectiveDiscount(config) && !hasNoEffectiveDiscount(replacedBy)) {
          for (const field of DISCOUNT_FIELDS) (writeData as any)[field] = (replacedBy as any)[field];
          inherited = true;
        }
        // Payment terms follow the documented "absence = preserve" rule: only fill
        // what the payload did not carry at all.
        for (const field of DEAL_TERM_FIELDS) {
          if (!(field in writeData)) (writeData as any)[field] = (replacedBy as any)[field];
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
        data: { quoteId, customerId: config.customerId, ...writeData },
      });
    }
  }

  // ── Delete ONLY removed customers, guarding issued financial records ──────
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
