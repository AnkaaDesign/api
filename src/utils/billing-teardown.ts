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
 * A NOTA FISCAL EMITIDA nunca entra aqui. `NfseDocument.invoiceId` é `SetNull`:
 * nota emitida sobrevive à fatura e continua sendo o histórico fiscal do
 * orçamento. A que NUNCA chegou a existir na prefeitura é outra coisa — ver
 * `abandonUnmintedNfseDocuments`.
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

/**
 * A NOTA QUE NUNCA FOI CUNHADA MORRE COM A FATURA.
 *
 * `NfseDocument.invoiceId` é `SetNull`, e isso é o certo para a nota EMITIDA:
 * documento fiscal não é filho descartável de uma fatura. Mas um documento
 * PENDENTE ou em ERROR nunca virou nada na prefeitura — não tem `nfseNumber` nem
 * `elotechNfseId` —, e ao perder a fatura ele fica num beco de que não sai mais:
 *
 *   • a varredura das 09:00 exige `invoice: { is: … }`, então nunca mais o emite;
 *   • `alertOrphanLiveNotes` só olha `NFSE_LIVE_STATUSES` com `nfseNumber` não
 *     nulo, então nunca o acusa;
 *   • `GET /invoices/task/:id/nfse-history` o exibe como "Pendente" para sempre —
 *     a tela afirmando ao contador que existe uma nota a caminho que não existe.
 *
 * Marcar CANCELLED é a saída mais limpa das três (cancelar, esconder do
 * histórico, ou alertar) porque é a única que diz a VERDADE em vez de escondê-la
 * ou de pedir uma providência que não existe: não há nota, e não vai haver.
 * Esconder do histórico apagaria a trilha de que uma emissão foi tentada; alertar
 * criaria um aviso recorrente cuja única ação possível é justamente esta.
 *
 * É exatamente o que `InvoiceService.cancelInvoice` já faz quando CANCELA a
 * fatura (`PENDING/PROCESSING/ERROR → CANCELLED`, "nunca foram autorizadas, não há
 * nada vivo na prefeitura"); o que faltava era o mesmo gesto no caminho que APAGA
 * a fatura.
 *
 * ⚠️ `PROCESSING` fica DE FORA, e é a diferença deliberada em relação ao
 * cancelamento: uma emissão em voo pode cunhar a nota logo depois desta escrita, e
 * marcá-la morta orfanaria um documento fiscal VIVO. Quem desmonta já é obrigado a
 * barrar PENDING/PROCESSING antes (`assertBillingArtifactsConfirmed`) — esta função
 * é a rede para a janela entre aquela leitura e esta transação, em que um clique em
 * "Emitir NFS-e" cria um PENDENTE novo.
 *
 * A dupla trava `nfseNumber: null` + `elotechNfseId: null` é o que garante que
 * nenhuma nota com existência municipal seja tocada, mesmo que o `status` esteja
 * atrasado em relação à prefeitura.
 */
export async function abandonUnmintedNfseDocuments(
  tx: Prisma.TransactionClient | any,
  invoiceWhere: any,
  motivo: string,
): Promise<number> {
  const doomed = await tx.nfseDocument.findMany({
    where: {
      invoice: { is: invoiceWhere },
      status: { in: ['PENDING', 'ERROR'] },
      nfseNumber: null,
      elotechNfseId: null,
    },
    select: { id: true },
  });
  if (doomed.length === 0) return 0;
  const result = await tx.nfseDocument.updateMany({
    where: { id: { in: doomed.map((d: { id: string }) => d.id) } },
    data: { status: 'CANCELLED', errorMessage: motivo.slice(0, 1000), retryAfter: null },
  });
  return result.count;
}
