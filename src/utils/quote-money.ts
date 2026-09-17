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
export type QuoteBillingSplitValue = 'JOINT' | 'PER_TASK' | 'CUSTOM' | string;

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
  /**
   * QUANTOS VEÍCULOS ESTA FATURA COBRA — o tamanho da cobertura da fatia.
   *
   * Substituiu `billingSplit` na aritmética, e isso é a simplificação central
   * desta feature. Antes a conta tinha um "se": `PER_TASK` cobrava um veículo,
   * o resto cobrava todos. Com lotes existiria um terceiro caso, e um terceiro
   * caso numa fórmula de dinheiro é onde os centavos divergem.
   *
   *     total da fatura = total por veículo × veículos COBERTOS
   *
   * JOINT cobre N, `PER_TASK` cobre 1, um lote cobre k — e os três são a mesma
   * linha. Omitido = `taskCount` (a fatura cobre o orçamento inteiro), que é o
   * padrão e o comportamento de sempre.
   */
  coveredTaskCount?: number | null;
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
  /** Quantos veículos ESTA fatura cobre. Ver `coveredTaskCount`. */
  coveredVehicleCount: number;
  /**
   * O que UMA configuração de faturamento cobra — ou seja, o que vai para
   * `TaskQuoteCustomerConfig.total`, `Invoice.totalAmount` e a soma das parcelas.
   *
   * É `por veículo × cobertos`, sem ramificação: o total geral quando a fatura
   * cobre os sessenta, o de um caminhão quando cobre um, o do lote quando cobre
   * vinte.
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

  // Quantos veículos ESTA fatura cobra.
  //
  // Ausente, zero ou inválido caem em "cobre o orçamento inteiro" — o padrão, e
  // o comportamento de sempre. É deliberado que ZERO caia aí e não em um: uma
  // cobertura vazia significa "a consulta não trouxe a relação" ou "a fatia
  // acabou de nascer", nunca "esta fatura é de um veículo", e responder um faria
  // uma fatura de sessenta caminhões cobrar um. O teto em `vehicleCount` impede
  // o contrário — cobrar setenta num orçamento de sessenta.
  const requested = Math.trunc(Number(input.coveredTaskCount ?? 0)) || 0;
  const coveredVehicleCount = requested > 0 ? Math.min(vehicleCount, requested) : vehicleCount;

  return {
    vehicleCount,
    perVehicleSubtotal,
    perVehicleDiscount,
    perVehicleTotal,
    grandSubtotal,
    grandTotal,
    coveredVehicleCount,
    configSubtotal: round2(perVehicleSubtotal * coveredVehicleCount),
    configTotal: round2(perVehicleTotal * coveredVehicleCount),
  };
}

/**
 * COMO OS VEÍCULOS SE REPARTEM ENTRE AS FATURAS DE UM CLIENTE.
 *
 * Devolve os grupos de cobertura — um por faturamento. É o que a reconciliação
 * usa para decidir o que criar, o que manter e o que apagar, e o que a aprovação
 * usa para saber se o orçamento inteiro fechou.
 *
 *     JOINT     → [[t1..tN]]              uma fatura para todos
 *     PER_TASK  → [[t1], [t2], … [tN]]    uma por veículo
 *     CUSTOM    → os lotes que a tela montou, saneados
 *
 * Substituiu `expectedConfigTaskIds`, que devolvia `Array<string | null>` com
 * `null` querendo dizer "todos". Aquele `null` era a cobertura implícita que
 * esta feature existe para eliminar: um grupo VAZIO e um grupo com os sessenta
 * eram a mesma coisa escrita, e a diferença só aparecia na leitura.
 *
 * ⚠️ SANEAMENTO DO `CUSTOM`, e por que ele não adivinha. Os lotes recebidos são
 * filtrados pelas tarefas que o orçamento realmente tem (um veículo removido não
 * pode continuar coberto), os grupos que sobram vazios caem, e todo veículo NÃO
 * coberto ganha um grupo SÓ DELE — nunca é enfiado no primeiro lote. Enfiá-lo
 * mudaria em silêncio o valor de uma fatura que alguém já conferiu; isolá-lo faz
 * a tela mostrar um faturamento novo, sozinho, que é uma pergunta visível.
 */
export function planCoverage(
  billingSplit: QuoteBillingSplitValue | null | undefined,
  taskIds: readonly string[],
  existingGroups?: readonly (readonly string[])[] | null,
): string[][] {
  // Orçamento ainda sem veículo vinculado (o registro nasce antes do vínculo):
  // um faturamento, cobertura vazia. Devolver lista vazia faria a reconciliação
  // apagar a configuração do cliente e, com ela, o desconto combinado.
  if (taskIds.length === 0) return [[]];

  if (billingSplit === 'PER_TASK') return taskIds.map(id => [id]);

  if (billingSplit === 'CUSTOM') {
    const valid = new Set(taskIds);
    const seen = new Set<string>();
    const groups: string[][] = [];
    for (const group of existingGroups ?? []) {
      const kept: string[] = [];
      for (const id of group) {
        if (!valid.has(id) || seen.has(id)) continue;
        seen.add(id);
        kept.push(id);
      }
      if (kept.length > 0) groups.push(kept);
    }
    // Os veículos que nenhum lote reivindicou — inclusive o caso em que NENHUM
    // lote veio, que é o `CUSTOM` recém-declarado: ali cada veículo começa
    // sozinho, e a tela agrupa a partir daí.
    for (const id of taskIds) if (!seen.has(id)) groups.push([id]);
    return groups.length > 0 ? groups : [[...taskIds]];
  }

  return [[...taskIds]];
}

/**
 * O PLANO DE COBERTURA DE UM ORÇAMENTO INTEIRO — por CLIENTE, nunca por fatia.
 *
 * `planCoverage` responde por um cliente de cada vez, e responde ISOLANDO todo
 * veículo que os lotes recebidos não reivindicaram. Isso a torna correta quando
 * recebe TODOS os lotes daquele cliente e uma armadilha quando recebe um só: com
 * um grupo na mão ela devolve aquele grupo mais um grupo para cada veículo que
 * sobrou — os veículos dos OUTROS lotes.
 *
 * Foi exatamente isso que aconteceu na CRIAÇÃO de um orçamento em lotes: a
 * chamada era por configuração, com um grupo cada, e cada fatia reivindicava os
 * lotes das outras. Num orçamento de quatro caminhões em dois lotes, cada
 * caminhão aparecia DUAS vezes no plano, e `BillingTask.@@unique([taskId])` —
 * que é global — derrubava a criação inteira em P2002.
 *
 * A EDIÇÃO nunca teve o defeito porque `reconcileQuoteCustomerConfigs` agrupa por
 * cliente antes de chamar. Esta função é essa mesma regra, escrita uma vez, para
 * que os dois caminhos não possam divergir de novo.
 *
 * A PROPRIEDADE que ela garante, e que o teste verifica: **para cada cliente, os
 * grupos devolvidos PARTICIONAM os veículos** — todo veículo aparece em
 * exatamente um grupo daquele cliente. É essa partição que faz a soma das
 * faturas reconstruir o valor do contrato.
 *
 * Um grupo recebe TODAS as configurações do cliente que o declararam; nenhuma o
 * declarou, recebe todas as que delegaram ao modo (dois pagadores em `JOINT` são
 * dois objetos sem cobertura para um grupo só, e ficar com um deles perderia um
 * pagador); nenhuma das duas, a primeira do cliente.
 */
export function planCoverageByCustomer<
  T extends {
    // Opcional no tipo porque o objeto inferido pelo zod da criação traz todas as
    // chaves opcionais; o valor é obrigatório e o zod já o exigiu.
    customerId?: string | null;
    taskIds?: readonly string[] | null;
    taskId?: string | null;
  },
>(
  configs: readonly T[],
  taskIds: readonly string[],
  billingSplit: QuoteBillingSplitValue | null | undefined,
): Array<{ config: T; coverage: string[] }> {
  const keyOf = (ids: readonly string[]) => [...ids].sort().join('|');
  const declaredOf = (c: T): string[] | null => {
    if (Array.isArray(c.taskIds)) return [...c.taskIds];
    if (typeof c.taskId === 'string' && c.taskId) return [c.taskId];
    return null;
  };

  const porCliente = new Map<string, T[]>();
  for (const config of configs) {
    const chave = String(config.customerId ?? '');
    const lista = porCliente.get(chave) ?? [];
    lista.push(config);
    porCliente.set(chave, lista);
  }

  const plano: Array<{ config: T; coverage: string[] }> = [];
  for (const [, doCliente] of porCliente) {
    const declarados = doCliente.map(declaredOf).filter((g): g is string[] => g !== null);
    const groups = planCoverage(
      declarados.length > 0 ? 'CUSTOM' : billingSplit,
      taskIds,
      declarados.length > 0 ? declarados : null,
    );

    const porLote = new Map<string, T[]>();
    const semCobertura: T[] = [];
    for (const config of doCliente) {
      const d = declaredOf(config);
      if (d) {
        const k = keyOf(d);
        const lista = porLote.get(k) ?? [];
        lista.push(config);
        porLote.set(k, lista);
      } else {
        semCobertura.push(config);
      }
    }

    for (const coverage of groups) {
      const candidatos = porLote.get(keyOf(coverage)) ?? semCobertura;
      const donos = candidatos.length > 0 ? candidatos : [doCliente[0]];
      for (const config of donos) plano.push({ config, coverage });
    }
  }
  return plano;
}
