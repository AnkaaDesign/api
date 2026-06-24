/**
 * Discount-aware recomputation of a TaskQuote's monetary totals.
 *
 * A quote's money lives in two places that MUST stay consistent:
 *   - the aggregate `TaskQuote.subtotal` / `TaskQuote.total`
 *   - one `TaskQuoteCustomerConfig.subtotal` / `.total` per invoiced customer
 *     (each carrying its own discount).
 *
 * Several flows add or remove `TaskQuoteService` rows (cascade-delete on SO
 * removal, the SO↔quote bidirectional sync, item-snapshot rollbacks). Each one
 * must recompute the totals the SAME way, otherwise the aggregate drifts from
 * the per-customer configs and/or silently drops the discount — the bug that
 * left approved quotes showing a subtotal on the task detail page that didn't
 * match the edit wizard (quote 0547: 15.375 vs 2.650).
 *
 * This is the single source of truth for that recomputation. Call it inside the
 * same transaction right after mutating a quote's services.
 */
import { PrismaTransaction } from '../modules/common/base/base.repository';

export async function recalcQuoteTotals(
  tx: PrismaTransaction,
  quoteId: string,
): Promise<void> {
  const allItems = await tx.taskQuoteService.findMany({ where: { quoteId } });
  const allConfigs = await tx.taskQuoteCustomerConfig.findMany({ where: { quoteId } });

  // No customer configs: aggregate is just the raw services sum.
  if (allConfigs.length === 0) {
    const sum = allItems.reduce((s, i) => s + Number(i.amount || 0), 0);
    const rounded = Math.round(sum * 100) / 100;
    await tx.taskQuote.update({
      where: { id: quoteId },
      data: { subtotal: rounded, total: rounded },
    });
    return;
  }

  const isSingleConfig = allConfigs.length === 1;
  let aggregateSubtotal = 0;
  let aggregateTotal = 0;

  for (const config of allConfigs) {
    // Single config: every service on the quote is billed to that one customer,
    // regardless of a stale/foreign `invoiceToCustomerId` left over from when the
    // quote briefly had multiple configs. Filtering by customerId there would
    // silently drop those services from the subtotal (the detail≠wizard bug).
    const assignedServices = isSingleConfig
      ? allItems
      : allItems.filter(s => s.invoiceToCustomerId === config.customerId);
    const configSubtotal = assignedServices.reduce((sum, s) => sum + Number(s.amount || 0), 0);
    const discountType = config.discountType || 'NONE';
    const discountValue = config.discountValue ? Number(config.discountValue) : 0;
    let discount = 0;
    if (discountType === 'PERCENTAGE' && discountValue) {
      discount = Math.round(((configSubtotal * discountValue) / 100) * 100) / 100;
    } else if (discountType === 'FIXED_VALUE' && discountValue) {
      discount = Math.min(discountValue, configSubtotal);
    }
    const configTotal = Math.max(0, Math.round((configSubtotal - discount) * 100) / 100);

    await tx.taskQuoteCustomerConfig.update({
      where: { id: config.id },
      data: { subtotal: configSubtotal, total: configTotal },
    });

    aggregateSubtotal += configSubtotal;
    aggregateTotal += configTotal;
  }

  // Multi-config: services not yet assigned to any customer (invoiceToCustomerId
  // null) belong to no config above, so their amounts were dropped from the
  // aggregate. Fold them in at full value (they bear no config discount) so the
  // draft TaskQuote.subtotal/total shown on the task detail page is truthful.
  // The billing-approval guard (task-quote.service unassigned check) still blocks
  // approval until every service is assigned, so this never reaches an invoice.
  if (!isSingleConfig) {
    const unassignedSum = allItems
      .filter(s => !s.invoiceToCustomerId)
      .reduce((sum, s) => sum + Number(s.amount || 0), 0);
    const unassignedRounded = Math.round(unassignedSum * 100) / 100;
    aggregateSubtotal += unassignedRounded;
    aggregateTotal += unassignedRounded;
  }

  await tx.taskQuote.update({
    where: { id: quoteId },
    data: {
      subtotal: Math.round(aggregateSubtotal * 100) / 100,
      total: Math.round(aggregateTotal * 100) / 100,
    },
  });
}
