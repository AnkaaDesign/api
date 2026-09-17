import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BILLING_STATUS, BILLING_STATUS_ORDER, TASK_QUOTE_STATUS } from '@constants';
import { isDueDateOverdue, todayInSaoPauloAtNoonUtc } from '@utils/due-date.util';

/**
 * QUEM ESCREVE `Billing.status`. Ninguém mais.
 *
 * Até 16/09/2026 o ciclo do pagamento morava em `TaskQuote.status`, e isso tinha
 * um defeito que nenhuma quantidade de cuidado consertava: **o estado era do
 * ORÇAMENTO, que é um, enquanto as cobranças são N**. Num orçamento de sessenta
 * caminhões faturados um a um, uma fatia paga e outra vencida tinham de caber no
 * mesmo campo — e não cabiam.
 *
 * Há uma guarda inteira do código antigo que existe só por causa disso e que
 * aqui simplesmente não precisa existir. Era esta: "LIQUIDADO exige que TUDO
 * esteja faturado", porque `paidCount === activeInstallments.length` dava
 * verdadeiro quando o caminhão 1 de 60 era pago, já que os outros 59 não tinham
 * parcela nenhuma para contrapor. O orçamento se declarava liquidado com
 * R$ 718.053,60 a faturar. Contando por FATURAMENTO a pergunta se responde
 * sozinha: as parcelas desta cobrança estão pagas, e as das outras são de outras
 * cobranças.
 */
@Injectable()
export class BillingStatusCascadeService {
  private readonly logger = new Logger(BillingStatusCascadeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recalcula UM faturamento. Idempotente: não escreve quando nada muda, para
   * não encher o `updatedAt` de linhas que não se mexeram.
   */
  async recomputeBilling(billingId: string): Promise<BILLING_STATUS | null> {
    const billing = await this.prisma.billing.findUnique({
      where: { id: billingId },
      select: {
        id: true,
        status: true,
        approvedAt: true,
        quote: { select: { status: true } },
        customerConfigs: {
          select: {
            installments: { select: { status: true, dueDate: true, amount: true, paidAmount: true } },
          },
        },
      },
    });
    if (!billing) return null;

    const next = this.resolve(billing);
    if (next === (billing.status as BILLING_STATUS)) return next;

    await this.prisma.billing.update({
      where: { id: billingId },
      data: { status: next as any, statusOrder: BILLING_STATUS_ORDER[next] },
    });
    this.logger.log(`Billing ${billingId}: ${billing.status} → ${next}`);
    return next;
  }

  /** Recalcula TODOS os faturamentos de um orçamento. */
  async recomputeForQuote(quoteId: string): Promise<void> {
    const billings = await this.prisma.billing.findMany({
      where: { quoteId },
      select: { id: true },
    });
    for (const b of billings) {
      try {
        await this.recomputeBilling(b.id);
      } catch (error) {
        // Uma cobrança que falha não pode impedir as outras de serem corrigidas.
        this.logger.error(`Falha ao recalcular Billing ${b.id} do orçamento ${quoteId}:`, error);
      }
    }
  }

  /**
   * Recalcula a partir de um PAGADOR — o caminho que a baixa de parcela e o
   * webhook do Sicredi usam, porque é o `customerConfigId` que eles têm em mão.
   */
  async recomputeForCustomerConfig(customerConfigId: string): Promise<void> {
    const config = await this.prisma.taskQuoteCustomerConfig.findUnique({
      where: { id: customerConfigId },
      select: { billingId: true },
    });
    if (config?.billingId) await this.recomputeBilling(config.billingId);
  }

  /** Todos os faturamentos do orçamento estão liquidados? */
  async isQuoteFullyPaid(quoteId: string): Promise<boolean> {
    const billings = await this.prisma.billing.findMany({
      where: { quoteId },
      select: { status: true },
    });
    if (billings.length === 0) return false;
    return billings.every(b => b.status === BILLING_STATUS.SETTLED);
  }

  /**
   * A REGRA, num lugar só e sem banco — o que a torna testável sem subir nada.
   */
  resolve(billing: {
    status: string;
    approvedAt: Date | null;
    quote: { status: string } | null;
    customerConfigs: Array<{
      installments: Array<{
        status: string;
        dueDate: Date;
        amount?: unknown;
        paidAmount?: unknown;
      }>;
    }>;
  }): BILLING_STATUS {
    // O orçamento cancelado cancela as suas cobranças. É o único estado do
    // orçamento que ainda atravessa a fronteira, e atravessa porque cancelar a
    // proposta cancela o que ela mandava cobrar.
    if (billing.quote?.status === TASK_QUOTE_STATUS.CANCELLED) return BILLING_STATUS.CANCELLED;

    const all = billing.customerConfigs.flatMap(c => c.installments);
    const active = all.filter(i => i.status !== 'CANCELLED');

    // NUNCA teve parcela. Quem responde é a aprovação — MENOS quando a cobrança já
    // está num estado terminal, e aí ela é preservada.
    //
    // ⚠️ Sem essa ressalva a cascata REBAIXA liquidação silenciosamente. Há
    // cobrança liquidada por CONCILIAÇÃO, sem fatura e sem parcela nenhuma: o
    // dinheiro entrou pelo extrato e foi casado à mão. Para esta função ela é
    // indistinguível de uma cobrança que nunca saiu do papel — as duas têm zero
    // parcelas e `approvedAt` nulo —, e a primeira cascata que tocasse o orçamento
    // devolveria um contrato pago para a fila de "a faturar". Cinco linhas do
    // acervo estão exatamente nesse estado (orçamentos 34, 216, 287, 347 e 351).
    //
    // Preservar é a leitura certa pelo mesmo motivo da regra de baixo: o estado
    // gravado carrega uma informação que as parcelas não têm, e um derivador não
    // deve apagar o que não sabe reproduzir.
    if (all.length === 0) {
      if (
        billing.status === BILLING_STATUS.SETTLED ||
        billing.status === BILLING_STATUS.CANCELLED
      ) {
        return billing.status as BILLING_STATUS;
      }
      return billing.approvedAt ? BILLING_STATUS.APPROVED : BILLING_STATUS.PENDING;
    }

    // TINHA parcelas e todas foram canceladas (cancelamento de fatura, troca de
    // instrumento). Aqui a resposta depende de a APROVAÇÃO ter caído junto.
    //
    // Preservar o estado cegamente — que é o que o código antigo fazia — deixa a
    // cobrança lendo "Aprovado" com `approvedAt` nulo depois que a última fatura é
    // cancelada: um faturamento aprovado sem aprovação, que é a contradição que
    // esta entidade existe para não ter. Mas voltar sempre a PENDENTE apagaria um
    // histórico de pagamento que de fato aconteceu, quando só o INSTRUMENTO mudou
    // (o cliente vai pagar por PIX, o boleto é cancelado, a dívida continua).
    //
    // O que separa os dois casos é justamente `approvedAt`: sem carimbo, a
    // cobrança voltou para a fila do financeiro; com carimbo, ela segue viva e o
    // estado anterior é a melhor verdade disponível.
    if (active.length === 0) {
      return billing.approvedAt ? (billing.status as BILLING_STATUS) : BILLING_STATUS.PENDING;
    }

    const today = todayInSaoPauloAtNoonUtc();
    const paid = active.filter(i => i.status === 'PAID').length;
    // Comparação por DIA de calendário em São Paulo: parcela que vence HOJE não
    // está vencida. Comparar instantes crus virava "vencido" às 09:00 do próprio
    // dia do vencimento (a data é gravada ao meio-dia UTC).
    //
    // ⚠️ Boleto CANCELADO não isenta: quando a cobrança é realmente abandonada,
    // `cancelBoleto` cancela a PARCELA, e o filtro de `active` acima já a tirou.
    // Quando só o trilho muda (o cliente vai pagar por PIX), a dívida continua —
    // e foi ignorá-la que deixou o orçamento 273 lendo "a vencer" por 104 dias
    // com R$ 13.850,60 em aberto.
    const overdue = active.filter(
      i => i.status !== 'PAID' && isDueDateOverdue(new Date(i.dueDate), today),
    ).length;

    // ⚠️ LIQUIDADO É SOBRE DINHEIRO RECEBIDO, não sobre linhas restantes.
    //
    // `active` exclui as canceladas, então "todas as ativas pagas" dava verdadeiro
    // com uma parcela CANCELADA e não recebida ao lado. E o caminho para isso é
    // ordinário: `cancelInvoice` cancela EM BLOCO toda parcela não paga, de modo
    // que cancelar a fatura de uma cobrança parcialmente paga a PROMOVIA a
    // liquidada — declarando quitado um contrato do qual faltou dinheiro entrar.
    //
    // Hoje não há nenhum caso assim em produção (conferido), o que torna esta uma
    // correção barata: fecha a porta antes de alguém passar por ela. A cobrança
    // com saldo cancelado em aberto lê PARCIAL, que é o que a própria fatura diz.
    const canceladaEmAberto = all.some(
      i =>
        i.status === 'CANCELLED' &&
        Number(i.amount ?? 0) > Number(i.paidAmount ?? 0),
    );
    if (paid === active.length && !canceladaEmAberto) return BILLING_STATUS.SETTLED;
    if (overdue > 0) return BILLING_STATUS.OVERDUE;
    if (paid > 0) return BILLING_STATUS.PARTIAL;
    return billing.approvedAt ? BILLING_STATUS.APPROVED : BILLING_STATUS.PENDING;
  }
}
