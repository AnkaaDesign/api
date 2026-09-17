import { Prisma } from '@prisma/client';

/**
 * APAGAR PARCELA AGORA É UM GESTO EXPLÍCITO — e por quê.
 *
 * `BankSlip.installment`, `Installment.customerConfig` e `Invoice.customerConfig`
 * eram `onDelete: Cascade`. Um `installment.deleteMany` levava junto o BOLETO
 * REGISTRADO no Sicredi, e um `budgetPayer.deleteMany` levava a
 * fatura, as parcelas — PAGAS inclusive — os boletos e os `ReconciliationMatch`.
 * A guarda de obrigação viva só olhava faturas `status <> 'CANCELLED'`, então uma
 * parcela PAGA pendurada numa fatura CANCELADA (o que sobra de um ciclo
 * revertido) não era vista por ninguém e sumia em silêncio junto com o dinheiro.
 *
 * As três FKs viraram `Restrict`. O preço é este helper: quem desmonta um
 * faturamento diz, na ordem, o que acontece com cada peça. É de propósito — o
 * banco deixou de ser o lugar onde a decisão de apagar dinheiro é tomada por
 * omissão.
 *
 * A NOTA FISCAL NUNCA entra aqui. `NfseDocument.invoiceId` é `SetNull`: nota
 * emitida sobrevive à fatura e continua sendo o histórico fiscal do orçamento.
 */
export async function deleteInstallmentsWithSlips(
  tx: Prisma.TransactionClient | any,
  where: any,
): Promise<{ slips: number; installments: number }> {
  // Os ids primeiro: `bankSlip.deleteMany` com um filtro relacional depende de a
  // parcela ainda existir, e depois do delete ela não existe mais.
  const doomed = await tx.installment.findMany({ where, select: { id: true } });
  if (doomed.length === 0) return { slips: 0, installments: 0 };
  const ids = doomed.map((i: { id: string }) => i.id);

  const slips = await tx.bankSlip.deleteMany({ where: { installmentId: { in: ids } } });
  const installments = await tx.installment.deleteMany({ where: { id: { in: ids } } });
  return { slips: slips.count, installments: installments.count };
}
