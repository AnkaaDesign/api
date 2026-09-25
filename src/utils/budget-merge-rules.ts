/**
 * AS REGRAS DE "ESTES ORÇAMENTOS PODEM VIRAR UM SÓ".
 *
 * Puras de propósito: nenhuma consulta, nenhum Prisma, nenhuma data de hoje. O
 * serviço carrega o grafo, chama isto, e o que volta é a lista de impedimentos e
 * a de avisos. Assim a prévia (que não escreve) e a união (que escreve) julgam
 * pela MESMA função, e a tela nunca oferece um botão que o servidor vai recusar.
 *
 * ── POR QUE A UNIÃO EXISTE ──────────────────────────────────────────────────
 *
 * Um orçamento passou a cobrir N veículos, mas a tela de criação continuou
 * produzindo um orçamento POR caminhão durante meses. O acervo herdou isso: em
 * produção, 17/09/2026, há 72 grupos de orçamentos irmãos — mesmo cliente, mesmo
 * dia, mesmo total, um veículo cada. O maior tem 30 (nº 448 a 480), o seguinte
 * 29, o terceiro 27. São trinta números, trinta PDFs e trinta cerimônias de
 * assinatura para um negócio só.
 *
 * Unir dá UM documento e UMA assinatura. Não dá uma fatura só — ver
 * `billingSplit` no serviço.
 *
 * ── A DOUTRINA DOS IMPEDIMENTOS ─────────────────────────────────────────────
 *
 * Bloqueia o que a união DESTRUIRIA; avisa o que ela apenas DECIDE.
 *
 * A lista de serviços é o caso exemplar. Ela é UMA por orçamento, e
 * `BudgetItem.amount` é o preço de UM veículo. Unir dois orçamentos com
 * listas diferentes não "mescla" nada: o segundo passa a ser cobrado pela lista
 * do primeiro, e alguém recebe uma fatura por um serviço que não contratou. Isso
 * bloqueia.
 *
 * Já a validade é uma DECISÃO: duas datas, uma tem de vencer. Avisa qual, e
 * segue.
 *
 * ⚠️ O NÚMERO DO PEDIDO DE COMPRA NÃO IMPEDE NADA, e a tentação de bloqueá-lo é
 * grande porque ele é diferente em quase todo grupo. Ele é POR VEÍCULO
 * (`Task.customerOrderNumber`) desde a migração `20260909170000`, exatamente
 * para que uma frota comprada em pedidos distintos caiba num orçamento só.
 * Bloquear por ele recusaria o caso NORMAL.
 */

/** Um serviço do orçamento, como a regra precisa vê-lo. */
export interface MergeService {
  description: string;
  amount: number;
}

/** Um pagador do orçamento, com os termos que a união teria de unificar. */
export interface MergeCustomerConfig {
  customerId: string;
  discountType: string | null;
  discountValue: number | null;
  paymentCondition: string | null;
  customPaymentText: string | null;
  paymentConfig: unknown;
  /** O faturamento deste pagador já foi aprovado ou saiu do estado inicial? */
  billingFrozen: boolean;
  /** Já existe fatura viva, nota emitida ou boleto registrado nesta fatia? */
  hasLiveMoney: boolean;
}

/** Um orçamento candidato, reduzido ao que a regra julga. */
export interface MergeCandidate {
  id: string;
  budgetNumber: number;
  status: string;
  billingSplit: string;
  expiresAt: Date;
  guaranteeYears: number | null;
  customGuaranteeText: string | null;
  customForecastDays: number | null;
  layoutFileIds: string[];
  /** `SHARED` (padrão quando ausente) ou `PER_VEHICLE` — ver `Budget.layoutScope`. */
  layoutScope?: string | null;
  services: MergeService[];
  customerConfigs: MergeCustomerConfig[];
  /** Ids das tarefas (veículos) deste orçamento. */
  taskIds: string[];
  /** Tem envelope de assinatura protegido (coleta viva ou documento selado)? */
  signatureProtected: boolean;
}

export interface MergeBlocker {
  /** Estável — a tela agrupa e ordena por ele. */
  code: string;
  /** Uma frase, em português, dizendo o que impede E o que fazer. */
  message: string;
  /** Os números de orçamento envolvidos, para a tela destacar. */
  budgetNumbers: number[];
}

export interface MergeWarning {
  code: string;
  message: string;
  budgetNumbers: number[];
}

export interface MergeVerdict {
  /** Quem sobrevive — o de MENOR número. */
  survivor: MergeCandidate | null;
  /** Os que somem, em ordem de número. */
  absorbed: MergeCandidate[];
  blockers: MergeBlocker[];
  warnings: MergeWarning[];
  /** Quantos veículos o orçamento resultante vai cobrir. */
  vehicleCount: number;
}

/** Comparação de dinheiro em centavos: `0.1 + 0.2` não é `0.3`. */
const cents = (v: number | null | undefined): number => Math.round(Number(v ?? 0) * 100);

/**
 * A lista de serviços como CHAVE — sem depender da ordem.
 *
 * A posição é significativa no documento (é ela que numera "1 - Pintura
 * Laterais"), mas dois orçamentos irmãos com a mesma lista em ordem diferente
 * cobram exatamente o mesmo. Recusar por ordem seria recusar por cosmética; a
 * ordem que prevalece é a do sobrevivente, e isso é um aviso, não um bloqueio.
 */
const serviceKey = (services: MergeService[]): string =>
  services
    .map(s => `${normalizeDescription(s.description)}#${cents(s.amount)}`)
    .sort()
    .join('|');

/**
 * Descrição comparável: sem acento, sem caixa, sem espaço dobrado.
 *
 * "Logomarca  Laterais" e "logomarca laterais" são o mesmo serviço digitado duas
 * vezes, e recusar a união por isso mandaria o comercial caçar um espaço.
 */
export function normalizeDescription(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Os termos de um pagador, como chave — desconto e forma de pagamento. */
const termsKey = (c: MergeCustomerConfig): string =>
  JSON.stringify([
    c.discountType ?? 'NONE',
    c.discountValue != null ? cents(c.discountValue) : null,
    c.paymentCondition ?? null,
    (c.customPaymentText ?? '').trim() || null,
    c.paymentConfig ?? null,
  ]);

/**
 * O conjunto de pagadores, como chave — quem paga, e sob quais termos.
 *
 * CONJUNTO, não lista: um orçamento `PER_TASK` tem UMA linha de pagador POR
 * VEÍCULO, todas iguais. Contar as repetições fazia o nº 421 da Marquespan (28
 * veículos, 28 linhas idênticas, resultado de uma união) nunca bater com o nº
 * 430 (1 veículo, 1 linha) — e TODO orçamento já simplificado recusava absorver
 * mais alguém, com "as condições de pagamento diferem" sobre termos idênticos.
 */
const payersKey = (configs: MergeCustomerConfig[]): string =>
  [...new Set(configs.map(c => `${c.customerId}::${termsKey(c)}`))].sort().join('|');

/**
 * Julga um conjunto de orçamentos candidatos à união.
 *
 * `candidates` já vem DEDUPLICADO por orçamento: a tela seleciona TAREFAS, e
 * quatro linhas de um orçamento de quatro veículos são quatro tarefas do mesmo
 * orçamento. Deduplicar é do chamador porque só ele sabe o que foi selecionado.
 */
export function judgeMerge(candidates: MergeCandidate[]): MergeVerdict {
  const blockers: MergeBlocker[] = [];
  const warnings: MergeWarning[] = [];
  const nums = (list: MergeCandidate[]) => list.map(c => c.budgetNumber).sort((a, b) => a - b);

  if (candidates.length < 2) {
    return {
      survivor: candidates[0] ?? null,
      absorbed: [],
      blockers: [
        {
          code: 'SINGLE_QUOTE',
          message:
            candidates.length === 1
              ? `Os veículos selecionados já são do mesmo orçamento (nº ${candidates[0].budgetNumber}). ` +
                'Não há o que simplificar.'
              : 'Selecione veículos de pelo menos dois orçamentos diferentes.',
          budgetNumbers: nums(candidates),
        },
      ],
      warnings: [],
      vehicleCount: candidates[0]?.taskIds.length ?? 0,
    };
  }

  // ── O SOBREVIVENTE: o de MENOR número ──────────────────────────────────────
  //
  // Decisão do dono, 17/09/2026. É o primeiro que foi gerado e, quase sempre, o
  // que já saiu por e-mail ou WhatsApp para o cliente — o número que ele vai
  // citar no pedido de compra e na descrição do Pix. Manter o maior obrigaria a
  // avisar o cliente de que o número mudou.
  const ordered = [...candidates].sort((a, b) => a.budgetNumber - b.budgetNumber);
  const survivor = ordered[0];
  const absorbed = ordered.slice(1);

  // ── BLOQUEIOS ──────────────────────────────────────────────────────────────

  const cancelled = ordered.filter(c => c.status === 'CANCELLED');
  if (cancelled.length) {
    blockers.push({
      code: 'CANCELLED',
      message:
        `Orçamento cancelado não entra numa união: ${cancelled.map(c => `nº ${c.budgetNumber}`).join(', ')}. ` +
        'Tire-o da seleção.',
      budgetNumbers: nums(cancelled),
    });
  }

  const custom = ordered.filter(c => c.billingSplit === 'CUSTOM');
  if (custom.length) {
    blockers.push({
      code: 'CUSTOM_SPLIT',
      message:
        `Faturamento em lotes livres não é derivável: ${custom.map(c => `nº ${c.budgetNumber}`).join(', ')}. ` +
        'A união teria de adivinhar em qual lote cada veículo entra.',
      budgetNumbers: nums(custom),
    });
  }

  // Serviços: a lista é UMA por orçamento, e o preço é por veículo.
  const survivorServices = serviceKey(survivor.services);
  const divergentServices = absorbed.filter(c => serviceKey(c.services) !== survivorServices);
  if (divergentServices.length) {
    blockers.push({
      code: 'SERVICES',
      message:
        'A lista de serviços difere entre os orçamentos ' +
        `(nº ${survivor.budgetNumber} × ${divergentServices.map(c => `nº ${c.budgetNumber}`).join(', ')}). ` +
        'Um orçamento tem UMA lista, então unir passaria a cobrar todos os veículos pela lista do ' +
        `nº ${survivor.budgetNumber}.`,
      budgetNumbers: nums([survivor, ...divergentServices]),
    });
  }

  // Pagadores e termos: desconto, condição e configuração de pagamento.
  const survivorPayers = payersKey(survivor.customerConfigs);
  const divergentPayers = absorbed.filter(c => payersKey(c.customerConfigs) !== survivorPayers);
  if (divergentPayers.length) {
    const outroCliente = divergentPayers.filter(
      c =>
        [...new Set(c.customerConfigs.map(x => x.customerId))].sort().join('|') !==
        [...new Set(survivor.customerConfigs.map(x => x.customerId))].sort().join('|'),
    );
    blockers.push({
      code: outroCliente.length ? 'CUSTOMERS' : 'TERMS',
      message: outroCliente.length
        ? 'Os orçamentos são de clientes diferentes ' +
          `(nº ${survivor.budgetNumber} × ${outroCliente.map(c => `nº ${c.budgetNumber}`).join(', ')}). ` +
          'Um orçamento é de um contratante.'
        : 'As condições de pagamento ou o desconto diferem ' +
          `(nº ${survivor.budgetNumber} × ${divergentPayers.map(c => `nº ${c.budgetNumber}`).join(', ')}). ` +
          `Unir aplicaria as condições do nº ${survivor.budgetNumber} a todos os veículos.`,
      budgetNumbers: nums([survivor, ...divergentPayers]),
    });
  }

  // Dinheiro já emitido. Mover o veículo apagaria a cobertura da fatura dele.
  const frozen = ordered.filter(c => c.customerConfigs.some(x => x.billingFrozen));
  if (frozen.length) {
    blockers.push({
      code: 'BILLING_FROZEN',
      message:
        `Faturamento já aprovado em ${frozen.map(c => `nº ${c.budgetNumber}`).join(', ')}. ` +
        'Reverta o faturamento antes de unir — a fatura, a nota e o boleto apontam para o ' +
        'orçamento como ele está hoje.',
      budgetNumbers: nums(frozen),
    });
  }

  const liveMoney = ordered.filter(
    c => !c.customerConfigs.some(x => x.billingFrozen) && c.customerConfigs.some(x => x.hasLiveMoney),
  );
  if (liveMoney.length) {
    blockers.push({
      code: 'LIVE_MONEY',
      message:
        `Há fatura, nota fiscal ou boleto vivos em ${liveMoney.map(c => `nº ${c.budgetNumber}`).join(', ')}. ` +
        'Cancele-os antes de unir.',
      budgetNumbers: nums(liveMoney),
    });
  }

  // Assinatura. Só os ABSORVIDOS: o sobrevivente mantém o dele — e, se a união
  // mudar o documento, a própria invalidação material se encarrega.
  const signed = absorbed.filter(c => c.signatureProtected);
  if (signed.length) {
    blockers.push({
      code: 'SIGNATURE',
      message:
        `Há assinatura coletada ou documento selado em ${signed.map(c => `nº ${c.budgetNumber}`).join(', ')}. ` +
        'Um orçamento assinado não pode desaparecer dentro de outro: o documento ficaria sem ' +
        'o registro que o sustenta.',
      budgetNumbers: nums(signed),
    });
  }

  // ── AVISOS ─────────────────────────────────────────────────────────────────

  // A VALIDADE NÃO É JULGADA AQUI. Ela recomeça no dia da união (o documento é
  // outro e vai ser reemitido), e "hoje" não entra numa regra pura — quem avisa
  // a data nova é o serviço (`VALIDITY_RESET`). Herdar a mais distante, como
  // era até 25/09/2026, entregava ao grupo antigo uma validade já VENCIDA: o nº
  // 421 da Marquespan saiu da união válido até 26/06, três meses no passado, e
  // não podia ser assinado.

  const statuses = [...new Set(ordered.map(c => c.status))];
  if (statuses.length > 1 || statuses[0] !== 'PENDING') {
    warnings.push({
      code: 'STATUS_RESET',
      message:
        'O orçamento unido volta para Pendente: ele é um documento novo, com outros veículos, ' +
        'e precisa ser reemitido.',
      budgetNumbers: nums(ordered),
    });
  }

  const layoutDivergente = absorbed.filter(
    c => [...c.layoutFileIds].sort().join('|') !== [...survivor.layoutFileIds].sort().join('|'),
  );
  if (layoutDivergente.length) {
    warnings.push({
      code: 'LAYOUT',
      message:
        `O layout aprovado do nº ${survivor.budgetNumber} prevalece; o dos demais sai do ` +
        'orçamento (a arte continua na tarefa de cada veículo).',
      budgetNumbers: nums([survivor, ...layoutDivergente]),
    });
  }

  // O SOBREVIVENTE TEM LAYOUT POR VEÍCULO: quem chega não herda arte nenhuma.
  // A cobertura é uma afirmação sobre CADA caminhão, e inventá-la para os que
  // vieram de outro orçamento seria aprovar para eles uma pintura que ninguém
  // escolheu. Eles entram descobertos, e o portão da assinatura e da aprovação
  // acusa até alguém atribuir.
  if (survivor.layoutScope === 'PER_VEHICLE' && absorbed.length) {
    warnings.push({
      code: 'LAYOUT_PER_VEHICLE',
      message:
        `O nº ${survivor.budgetNumber} tem layout por veículo: os veículos que entram ficam ` +
        'sem layout aprovado até alguém atribuir um a cada um, na tela do orçamento.',
      budgetNumbers: nums([survivor]),
    });
  }

  const garantiaDivergente = absorbed.filter(
    c =>
      c.guaranteeYears !== survivor.guaranteeYears ||
      (c.customGuaranteeText ?? '') !== (survivor.customGuaranteeText ?? '') ||
      c.customForecastDays !== survivor.customForecastDays,
  );
  if (garantiaDivergente.length) {
    warnings.push({
      code: 'TERMS_FALLBACK',
      message: `Garantia e previsão do nº ${survivor.budgetNumber} passam a valer para todos os veículos.`,
      budgetNumbers: nums([survivor, ...garantiaDivergente]),
    });
  }

  warnings.push({
    code: 'NUMBERS_BURNED',
    message:
      `Os números ${absorbed.map(c => `nº ${c.budgetNumber}`).join(', ')} deixam de existir. ` +
      'A numeração é densa e não os reaproveita; eles ficam registrados no histórico do ' +
      `nº ${survivor.budgetNumber} e de cada veículo movido.`,
    budgetNumbers: nums(absorbed),
  });

  return {
    survivor,
    absorbed,
    blockers,
    warnings,
    vehicleCount: ordered.reduce((sum, c) => sum + c.taskIds.length, 0),
  };
}
