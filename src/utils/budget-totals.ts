/**
 * Discount-aware recomputation of a Budget's monetary totals.
 *
 * Grava também `vehicleCount` — a contagem de tarefas que multiplica os totais.
 * É o divisor que as telas por TAREFA usam para voltar do valor do contrato ao
 * valor de um veículo, e sai da mesma contagem, na mesma escrita.
 *
 * A quote's money lives in two places that MUST stay consistent:
 *   - the aggregate `Budget.subtotal` / `Budget.total`
 *   - one `BudgetPayer.subtotal` / `.total` per invoiced customer
 *     (each carrying its own discount).
 *
 * Several flows add or remove `BudgetItem` rows (cascade-delete on SO
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
import { isBillingFrozen } from '../modules/production/budget/budget.guards';
import { computeQuoteMoney, round2 } from './quote-money';

export async function recalcQuoteTotals(tx: PrismaTransaction, quoteId: string): Promise<void> {
  const allItems = await tx.budgetItem.findMany({ where: { quoteId } });
  // A COBERTURA VEM JUNTO. É ela que multiplica o valor de cada fatura
  // (`por veículo × cobertos`); uma consulta sem ela devolveria cobertura vazia,
  // e cobertura vazia numa conta de dinheiro é R$ 0,00 numa fatura que tem valor.
  const allConfigs = await tx.budgetPayer.findMany({
    where: { quoteId },
    include: {
      billing: {
        select: { id: true, approvedAt: true, status: true, tasks: { select: { taskId: true } } },
      },
    },
  });

  // QUANTOS VEÍCULOS o orçamento cobre — o "× N" do documento e o multiplicador
  // de todo total. `BudgetItem.amount` é o preço de UM veículo; ignorar a
  // contagem aqui faria o orçamento do Marquespan gravar R$ 12.170,40 num
  // contrato de R$ 730.224,00.
  const vehicleCount = Math.max(1, await tx.task.count({ where: { quoteId } }));

  // No customer configs: aggregate is just the raw services sum — vezes os
  // veículos, porque o serviço é prestado em cada um.
  if (allConfigs.length === 0) {
    const sum = allItems.reduce((s, i) => s + Number(i.amount || 0), 0);
    const rounded = round2(round2(sum) * vehicleCount);
    await tx.budget.update({
      where: { id: quoteId },
      data: { subtotal: rounded, total: rounded, vehicleCount },
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
    // ── O PAGADOR JÁ FATURADO NÃO É RECALCULADO ──────────────────────────────
    //
    // `approvedAt` estava na consulta e não era usado por ninguém — a função
    // reescrevia `subtotal`/`total` de TODA fatia, inclusive as que sustentam
    // `Invoice.totalAmount`, parcelas geradas, boleto registrado no Sicredi e
    // NFS-e autorizada na prefeitura. E ela roda em caminhos que não passam por
    // guarda nenhuma: apagar um dos sessenta caminhões ou mover uma tarefa de
    // orçamento chama-a direto do repositório de tarefas.
    //
    // O número de uma cobrança congelada é o número que saiu no documento. Ele
    // entra no agregado COMO ESTÁ — somar o recalculado no lugar faria o total do
    // contrato divergir da soma das faturas emitidas, que é justamente a
    // invariante que o agregado existe para afirmar.
    if (isBillingFrozen((config as any).billing ?? { approvedAt: null })) {
      aggregateSubtotal += Number(config.subtotal || 0);
      aggregateTotal += Number(config.total || 0);
      continue;
    }

    const assignedServices = isSingleConfig
      ? allItems
      : allItems.filter(s => s.invoiceToCustomerId === config.customerId);
    // A MESMA fórmula do documento e da criação. Ver `computeQuoteMoney`: é o
    // único lugar onde a aritmética do orçamento existe.
    // QUANTOS VEÍCULOS ESTA FATURA COBRA. Substituiu o `billingSplit` da conta:
    // `JOINT` cobre N, `PER_TASK` cobre 1, um lote cobre k — e a fórmula é a
    // mesma nos três. A cobertura vazia (orçamento ainda sem veículo vinculado)
    // cai no padrão de `computeQuoteMoney`, que é cobrir o orçamento inteiro.
    const coveredCount = ((config as any).billing?.tasks ?? []).length || undefined;
    const money = computeQuoteMoney({
      serviceAmounts: assignedServices.map(sv => Number(sv.amount || 0)),
      discountType: config.discountType || 'NONE',
      discountValue: config.discountValue ? Number(config.discountValue) : null,
      taskCount: vehicleCount,
      coveredTaskCount: coveredCount,
    });

    await tx.budgetPayer.update({
      where: { id: config.id },
      data: { subtotal: money.configSubtotal, total: money.configTotal },
    });

    // Somar as fatias dá o total do CONTRATO nos três modos, porque as coberturas
    // PARTICIONAM os veículos: em `JOINT` uma fatia cobre os N; em `PER_TASK` são
    // N fatias de um; num lote, K fatias que somam N. É `BillingTask.@@unique([taskId])`
    // — um veículo, UM faturamento, sem escopo de cliente — que sustenta essa
    // soma; sem ele, uma sobreposição faria o total do orçamento passar do
    // contrato sem nada acusar. (O índice antigo era `(taskId, customerId)`, e
    // foi substituído por este, mais forte, na migração do faturamento-entidade.)
    aggregateSubtotal += money.configSubtotal;
    aggregateTotal += money.configTotal;
  }

  // Multi-config: services not yet assigned to any customer (invoiceToCustomerId
  // null) belong to no config above, so their amounts were dropped from the
  // aggregate. Fold them in at full value (they bear no config discount) so the
  // draft Budget.subtotal/total shown on the task detail page is truthful.
  // The billing-approval guard (budget.service unassigned check) still blocks
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

  await tx.budget.update({
    where: { id: quoteId },
    data: {
      subtotal: round2(aggregateSubtotal),
      total: round2(aggregateTotal),
      // A CONTAGEM vai junto do total, sempre, porque é o divisor dele. `total`
      // é o valor do contrato (`por veículo × N`) e toda tela que mostra uma
      // linha por veículo precisa do N para dividir; gravá-los em pontos
      // diferentes é o que permitiria a um ficar velho enquanto o outro anda.
      vehicleCount,
    },
  });
}
