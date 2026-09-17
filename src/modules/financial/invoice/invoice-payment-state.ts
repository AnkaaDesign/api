import { Decimal } from '@prisma/client/runtime/library';
import { INSTALLMENT_STATUS, INVOICE_STATUS } from '@constants';

/**
 * A REGRA — UMA — DE COMO UMA FATURA SE PAGA.
 *
 * Existiam CINCO cópias desta derivação (webhook do Sicredi, conciliação por
 * recebível, conciliação por tarefa, o agendador de boletos e o
 * `InvoiceService`), e elas discordavam no ponto que mais importa: **três delas
 * decidiam o estado comparando DINHEIRO com `Invoice.totalAmount`**
 * (`Σ pago >= totalAmount ? PAID : ...`), e não perguntando se as parcelas foram
 * pagas.
 *
 * `Invoice.totalAmount` é um RETRATO CONGELADO de `config.total` no instante da
 * emissão — ele não acompanha renegociação, desconto na baixa, parcela cancelada
 * nem parcela editada. Assim que a soma das parcelas deixa de bater com esse
 * retrato (o que é rotina, não exceção), a fatura NUNCA MAIS chega a `PAID`:
 * fica em `PARTIALLY_PAID` com todas as parcelas quitadas, para sempre.
 *
 * Foi exatamente isso que aconteceu, em produção, com as faturas de cabeçalho
 * velho encontradas em 17/09: o orçamento 47 tem R$ 10.000,00 pagos contra um
 * `totalAmount` de R$ 12.594,80 (três parcelas foram removidas na renegociação),
 * e o 70 tem R$ 16.187,50 contra R$ 16.500,00 (desconto no fechamento). As duas
 * estão com TODAS as parcelas `PAID` e liam `PARTIALLY_PAID`.
 *
 * A pergunta certa é sobre ESTADO DE PARCELA, que é o que a cobrança de fato
 * acompanha:
 *
 *   PAID            — toda parcela ATIVA está `PAID`
 *   PARTIALLY_PAID  — há dinheiro registrado, mas ainda falta parcela
 *   ACTIVE          — nada registrado
 *
 * E `paidAmount` soma só as parcelas ATIVAS: o dinheiro de uma parcela cancelada
 * não é receita desta fatura (as cópias por dinheiro somavam as canceladas
 * junto).
 *
 * ⚠️ Fatura CANCELADA não passa por aqui — quem manda naquele estado terminal é
 * `cancelInvoice`. Todo chamador confere isso antes.
 */
export type InvoicePaymentStateInput = {
  status: string;
  paidAmount: Decimal | number | null;
};

export type InvoicePaymentState = {
  /** Σ `paidAmount` das parcelas NÃO canceladas. */
  paidAmount: Decimal;
  /** `PAID` | `PARTIALLY_PAID` | `ACTIVE` — nunca `CANCELLED`. */
  status: INVOICE_STATUS.PAID | INVOICE_STATUS.PARTIALLY_PAID | INVOICE_STATUS.ACTIVE;
};

export function deriveInvoicePaymentState(
  installments: readonly InvoicePaymentStateInput[],
): InvoicePaymentState {
  const active = installments.filter(i => i.status !== INSTALLMENT_STATUS.CANCELLED);

  const paidAmount = active.reduce(
    (sum, i) => sum.add(i.paidAmount == null ? new Decimal(0) : new Decimal(i.paidAmount as any)),
    new Decimal(0),
  );

  // Sem parcela ativa não há o que liquidar: a fatura fica `ACTIVE` e quem a
  // cancela de vez é `cancelInvoice`. Note que `every` sobre lista vazia é
  // `true` — sem esta guarda uma fatura com todas as parcelas canceladas
  // se declararia PAGA.
  if (active.length === 0) {
    return { paidAmount, status: INVOICE_STATUS.ACTIVE };
  }

  if (active.every(i => i.status === INSTALLMENT_STATUS.PAID)) {
    return { paidAmount, status: INVOICE_STATUS.PAID };
  }

  // Inclui o pagamento PARCIAL registrado numa parcela ainda em aberto
  // (subpagamento de boleto) — por isso a pergunta é sobre `paidAmount`, e não
  // sobre "alguma parcela PAID".
  if (paidAmount.gt(0)) {
    return { paidAmount, status: INVOICE_STATUS.PARTIALLY_PAID };
  }

  return { paidAmount, status: INVOICE_STATUS.ACTIVE };
}
