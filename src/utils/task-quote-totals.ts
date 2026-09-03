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
import { computeQuoteMoney, round2 } from './quote-money';

export async function recalcQuoteTotals(tx: PrismaTransaction, quoteId: string): Promise<void> {
  const allItems = await tx.taskQuoteService.findMany({ where: { quoteId } });
  const allConfigs = await tx.taskQuoteCustomerConfig.findMany({ where: { quoteId } });

  // QUANTOS VEÍCULOS o orçamento cobre — o "× N" do documento e o multiplicador
  // de todo total. `TaskQuoteService.amount` é o preço de UM veículo; ignorar a
  // contagem aqui faria o orçamento do Marquespan gravar R$ 12.170,40 num
  // contrato de R$ 730.224,00.
  const vehicleCount = Math.max(1, await tx.task.count({ where: { quoteId } }));
  const quoteRow = await tx.taskQuote.findUnique({
    where: { id: quoteId },
    select: { billingSplit: true },
  });
  const billingSplit = (quoteRow as any)?.billingSplit ?? 'JOINT';

  // No customer configs: aggregate is just the raw services sum — vezes os
  // veículos, porque o serviço é prestado em cada um.
  if (allConfigs.length === 0) {
    const sum = allItems.reduce((s, i) => s + Number(i.amount || 0), 0);
    const rounded = round2(round2(sum) * vehicleCount);
    await tx.taskQuote.update({
      where: { id: quoteId },
      data: { subtotal: rounded, total: rounded },
    });
    return;
  }

  // "Configuração única" é por CLIENTE, não por linha: em `PER_TASK` há uma
  // configuração por veículo e todas são do mesmo cliente, e filtrar por
  // `invoiceToCustomerId` ali derrubaria todo serviço marcado para outro cliente
  // de quando o orçamento teve dois — o mesmo defeito que a versão anterior
  // evitava contando as linhas.
  const distinctCustomers = new Set(allConfigs.map(c => c.customerId));
  const isSingleConfig = distinctCustomers.size === 1;
  let aggregateSubtotal = 0;
  let aggregateTotal = 0;

  for (const config of allConfigs) {
    const assignedServices = isSingleConfig
      ? allItems
      : allItems.filter(s => s.invoiceToCustomerId === config.customerId);
    // A MESMA fórmula do documento e da criação. Ver `computeQuoteMoney`: é o
    // único lugar onde a aritmética do orçamento existe.
    const money = computeQuoteMoney({
      serviceAmounts: assignedServices.map(sv => Number(sv.amount || 0)),
      discountType: config.discountType || 'NONE',
      discountValue: config.discountValue ? Number(config.discountValue) : null,
      taskCount: vehicleCount,
      billingSplit,
    });

    await tx.taskQuoteCustomerConfig.update({
      where: { id: config.id },
      data: { subtotal: money.configSubtotal, total: money.configTotal },
    });

    // Somar as configurações dá o total do CONTRATO nos dois modos: em `JOINT`
    // cada configuração carrega o total geral e há uma por cliente; em
    // `PER_TASK` cada uma carrega o de um veículo e há uma por veículo.
    aggregateSubtotal += money.configSubtotal;
    aggregateTotal += money.configTotal;
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
    // Vezes os veículos: é serviço prestado em cada um. A guarda de aprovação
    // de faturamento continua barrando enquanto houver serviço sem cliente, então
    // isto nunca chega a uma fatura — é só para o rascunho não mentir na tela.
    const unassignedRounded = round2(round2(unassignedSum) * vehicleCount);
    aggregateSubtotal += unassignedRounded;
    aggregateTotal += unassignedRounded;
  }

  await tx.taskQuote.update({
    where: { id: quoteId },
    data: {
      subtotal: round2(aggregateSubtotal),
      total: round2(aggregateTotal),
    },
  });
}
