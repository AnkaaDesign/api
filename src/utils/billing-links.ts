import { QUOTE_TASKS_ORDER_BY } from './quote-tasks';

/**
 * O LINK PARA O FATURAMENTO DE UMA FATURA — e por que `invoice.taskId` não serve.
 *
 * A tela de faturamento é endereçada por TAREFA, e três avisos diferentes montavam
 * a URL com `invoice.taskId` direto. Só que `Invoice.taskId` é preenchido por
 * `sliceAnchorTaskId`, que devolve a tarefa **apenas quando a cobertura tem
 * exatamente um veículo**. Numa fatura conjunta de quatro implementos, ou num lote,
 * ele é `null` — e o aviso de "boleto pago" mandava o financeiro para
 * `/financeiro/faturamento/detalhes/null`, uma tela morta, no exato momento em que
 * ele tinha dinheiro para conferir.
 *
 * A fatura sempre sabe quais veículos cobre; o que faltava era perguntar. A ordem
 * de resolução vai do mais específico ao mais genérico e NUNCA devolve `null`:
 *
 *   1. `Invoice.taskId` — a fatia de um veículo só.
 *   2. a âncora da COBERTURA — o primeiro veículo coberto, na ordem canônica.
 *   3. a âncora do ORÇAMENTO — o primeiro veículo do orçamento.
 *   4. a LISTA de faturamento — melhor uma lista que uma tela morta.
 */
export async function billingDeepLinkForInvoice(
  prisma: { invoice: any; task: any },
  invoiceId: string,
): Promise<{ web: string; mobile: string; taskId: string | null }> {
  let taskId: string | null = null;
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        taskId: true,
        customerConfig: {
          select: { quoteId: true, billing: { select: { id: true, approvedAt: true, tasks: { select: { taskId: true } } } } },
        },
      },
    });

    taskId = invoice?.taskId ?? null;

    if (!taskId) {
      const coveredIds: string[] = (invoice?.customerConfig?.billing?.tasks ?? []).map(
        (c: { taskId: string }) => c.taskId,
      );
      if (coveredIds.length > 0) {
        // A âncora da cobertura precisa ser ESTÁVEL entre duas leituras — o mesmo
        // lote tem de apontar sempre para o mesmo implemento.
        const anchor = await prisma.task.findFirst({
          where: { id: { in: coveredIds } },
          select: { id: true },
          orderBy: QUOTE_TASKS_ORDER_BY,
        });
        taskId = anchor?.id ?? null;
      }
    }

    if (!taskId && invoice?.customerConfig?.quoteId) {
      const anchor = await prisma.task.findFirst({
        where: { quoteId: invoice.customerConfig.quoteId },
        select: { id: true },
        orderBy: QUOTE_TASKS_ORDER_BY,
      });
      taskId = anchor?.id ?? null;
    }
  } catch {
    // Link é acessório de notificação: nunca derruba o aviso.
  }

  if (!taskId) {
    return { web: '/financeiro/faturamento', mobile: '/(tabs)/financeiro/faturamento', taskId: null };
  }
  return {
    web: `/financeiro/faturamento/detalhes/${taskId}`,
    mobile: `/(tabs)/financeiro/faturamento/detalhes/${taskId}`,
    taskId,
  };
}
