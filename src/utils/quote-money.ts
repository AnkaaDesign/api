/**
 * A ARITMÉTICA DO ORÇAMENTO — uma fórmula, um lugar.
 *
 * Todo número que o cliente vê tem de sair daqui: a lista de serviços do PDF
 * assinado, o "× 60", o total geral, o `subtotal`/`total` de cada
 * `TaskQuoteCustomerConfig`, o `Invoice.totalAmount`, o valor de cada parcela e
 * o valor de cada boleto. Se dois desses forem calculados por caminhos
 * diferentes, eles divergem em centavos — e um documento assinado que não fecha
 * com o boleto é um problema jurídico, não um arredondamento.
 *
 * A REGRA CENTRAL: O PREÇO É POR VEÍCULO
 * ─────────────────────────────────────────────────────────────────────────────
 * `TaskQuoteService.amount` é o preço de UM veículo. Sempre foi — num orçamento
 * de uma tarefa a distinção não existia. Agora que um orçamento cobre sessenta,
 * ela é a decisão de projeto que tudo o mais segue:
 *
 *     subtotal por veículo = Σ serviços                    R$ 13.830,00
 *     desconto por veículo = 12%                          - R$  1.659,60
 *     total por veículo                                     R$ 12.170,40
 *     × 60 veículos
 *     ─────────────────────────────────────────────────────────────────
 *     total geral                                          R$ 730.224,00
 *
 * O total geral é `total por veículo × N`, e NÃO o desconto recalculado sobre a
 * soma dos sessenta subtotais. As duas contas dão resultados diferentes por
 * centavos, e esta é a que o documento imprime: o cliente confere o preço do
 * caminhão, não a divisão de setecentos mil por sessenta.
 *
 * ⚠️ DESCONTO FIXO É POR VEÍCULO. Um desconto `PERCENTAGE` é invariante — 12%
 * sobre o unitário × 60 é igual a 12% sobre o total —, mas `FIXED_VALUE` não:
 * R$ 500 é R$ 500 por caminhão, R$ 30.000 no orçamento. Essa é a leitura certa
 * (o desconto é uma condição do serviço, e o serviço é prestado sessenta vezes)
 * e é a única compatível com o `PER_TASK`, em que cada fatura carrega o próprio
 * desconto. A tela diz "por veículo" ao lado do campo justamente porque a outra
 * leitura é plausível e custaria caro.
 */

/** Arredonda para centavos. Nunca comparar dinheiro sem passar por aqui. */
export function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export type QuoteDiscountType = 'NONE' | 'PERCENTAGE' | 'FIXED_VALUE' | string;
export type QuoteBillingSplitValue = 'JOINT' | 'PER_TASK' | string;

export interface QuoteMoneyInput {
  /** Os serviços DESTA configuração, com o preço unitário (por veículo). */
  serviceAmounts: readonly (number | null | undefined)[];
  discountType?: QuoteDiscountType | null;
  discountValue?: number | null;
  /**
   * Quantos veículos o orçamento cobre. Zero é tratado como um: um orçamento
   * ainda sem tarefa vinculada (o registro nasce antes do vínculo) precisa
   * mostrar o preço do serviço, e multiplicar por zero exibiria R$ 0,00 num
   * orçamento que tem preço.
   */
  taskCount?: number | null;
  billingSplit?: QuoteBillingSplitValue | null;
}

export interface QuoteMoney {
  /** Nº de veículos usado na conta (mínimo 1). É o "× N" do documento. */
  vehicleCount: number;
  /** Σ dos serviços, para UM veículo. */
  perVehicleSubtotal: number;
  /** O desconto aplicado a UM veículo. */
  perVehicleDiscount: number;
  /** O que UM veículo custa. É o que o documento imprime na lista. */
  perVehicleTotal: number;
  /** `perVehicleSubtotal × N`. */
  grandSubtotal: number;
  /** `perVehicleTotal × N`. É o valor do contrato. */
  grandTotal: number;
  /**
   * O que UMA configuração de faturamento cobra — ou seja, o que vai para
   * `TaskQuoteCustomerConfig.total`, `Invoice.totalAmount` e a soma das parcelas.
   *
   * `JOINT`: o total geral (uma fatura para os sessenta caminhões).
   * `PER_TASK`: o total por veículo (sessenta faturas, uma por caminhão).
   */
  configSubtotal: number;
  configTotal: number;
}

export function computeQuoteMoney(input: QuoteMoneyInput): QuoteMoney {
  const vehicleCount = Math.max(1, Math.trunc(input.taskCount ?? 1) || 1);

  const perVehicleSubtotal = round2(
    input.serviceAmounts.reduce<number>((sum, amount) => sum + (Number(amount) || 0), 0),
  );

  const discountValue = Number(input.discountValue ?? 0) || 0;
  let perVehicleDiscount = 0;
  if (input.discountType === 'PERCENTAGE' && discountValue) {
    perVehicleDiscount = round2((perVehicleSubtotal * discountValue) / 100);
  } else if (input.discountType === 'FIXED_VALUE' && discountValue) {
    // Nunca descontar mais do que o subtotal: um desconto fixo maior que o
    // serviço produziria total negativo, e o boleto de um valor negativo é
    // recusado pelo banco com uma mensagem que não diz nada.
    perVehicleDiscount = Math.min(discountValue, perVehicleSubtotal);
  }
  perVehicleDiscount = round2(perVehicleDiscount);

  const perVehicleTotal = Math.max(0, round2(perVehicleSubtotal - perVehicleDiscount));

  const grandSubtotal = round2(perVehicleSubtotal * vehicleCount);
  const grandTotal = round2(perVehicleTotal * vehicleCount);

  const perTask = input.billingSplit === 'PER_TASK';

  return {
    vehicleCount,
    perVehicleSubtotal,
    perVehicleDiscount,
    perVehicleTotal,
    grandSubtotal,
    grandTotal,
    configSubtotal: perTask ? perVehicleSubtotal : grandSubtotal,
    configTotal: perTask ? perVehicleTotal : grandTotal,
  };
}

/**
 * Quantas configurações de faturamento um orçamento deve ter, por cliente.
 *
 * `JOINT` → 1 (a de `taskId` nulo). `PER_TASK` → uma por veículo. É o que a
 * reconciliação de configurações usa para decidir o que criar e o que apagar, e
 * o que a aprovação de faturamento usa para saber se o orçamento inteiro fechou.
 */
export function expectedConfigTaskIds(
  billingSplit: QuoteBillingSplitValue | null | undefined,
  taskIds: readonly string[],
): Array<string | null> {
  if (billingSplit === 'PER_TASK' && taskIds.length > 0) return [...taskIds];
  return [null];
}
