import { coveredTaskIds } from './quote-tasks';

/**
 * OS VEÍCULOS QUE ESTA NOTA COBRE, na ordem canônica do orçamento.
 *
 * Era `customerConfig.taskId` — preenchido querendo dizer "um veículo", nulo
 * querendo dizer "todos". A coluna SAIU em `20260913120000_billing_coverage` e a
 * leitura antiga continuou compilando porque passava por `as any`: a condição
 * era sempre falsa, e toda nota que não tivesse `Invoice.taskId` caía no ramo
 * "os veículos do orçamento". Para a nota de um LOTE — vinte dos sessenta — isso
 * é declarar à prefeitura quarenta implementos que ela não cobra.
 *
 * A resposta é a COBERTURA (`BillingTask`), e é a cobertura inteira: a
 * âncora (`sliceTask`) seria uma afirmação falsa sobre os outros dezenove.
 *
 * O recuo para `Invoice.task` — e, na falta dele, para o orçamento todo — é o
 * que sustenta o acervo: fatura antiga, emitida antes da migração, sem linha de
 * cobertura nenhuma.
 */
/**
 * DE ONDE a resposta veio — porque o recuo não vale o mesmo que a cobertura.
 *
 *   `coverage`       — a cobertura respondeu: estes veículos, nesta ordem.
 *   `invoice-anchor` — a própria fatura nomeia o seu único veículo
 *                      (`Invoice.taskId`, que `sliceAnchorTaskId` só preenche
 *                      quando a cobertura tem EXATAMENTE um). Quantidade 1, sem
 *                      chute.
 *   `whole-quote`    — RECUO: "todos os veículos do orçamento". É uma suposição,
 *                      e é ela que precisa ser julgada antes de virar nota.
 */
export type CoverageSource = 'coverage' | 'invoice-anchor' | 'whole-quote';

export const resolveCoveredVehicles = (
  customerConfig: unknown,
  quoteTaskRows: Array<{ id: string }>,
  fallbackTask: { id: string } | null | undefined,
): { rows: Array<any>; source: CoverageSource } => {
  const covered = new Set(coveredTaskIds(customerConfig as any));
  const own = covered.size > 0 ? quoteTaskRows.filter(t => covered.has(t.id)) : [];
  if (own.length > 0) return { rows: own as Array<any>, source: 'coverage' };
  if (fallbackTask) return { rows: [fallbackTask] as Array<any>, source: 'invoice-anchor' };
  return { rows: quoteTaskRows as Array<any>, source: 'whole-quote' };
};

/**
 * O RECUO "TODOS OS VEÍCULOS DO ORÇAMENTO" PODE VIRAR NOTA FISCAL?
 *
 * Devolve a mensagem de recusa quando não pode, `null` quando pode.
 *
 * `emitServiceQuantity` sai da contagem destes veículos, e a nota DECLARA essa
 * contagem à prefeitura. Num lote de vinte dos sessenta — `Invoice.taskId` nulo
 * por construção — o recuo declarava SESSENTA: o líquido ainda fechava (o
 * desconto por diferença absorve a sobra), então o boleto batia, a conciliação
 * casava pelo líquido e ninguém via. O que saiu autorizado foi um documento
 * fiscal irreversível declarando quarenta implementos que ninguém cobrou e um
 * "desconto incondicionado" que nunca existiu.
 *
 * A separação NÃO é "recuo = erro", porque no acervo cobertura vazia significa
 * mesmo "todos": a entidade `Billing` nasceu em 16/09/2026. O que separa é de
 * onde a fatura vem:
 *
 *   • SEM `billing` — fatura de acervo, sem `customerConfigId` nenhum. Não há
 *     cobertura a faltar; o recuo É a leitura de sempre e continua valendo.
 *   • COM `billing` e cobertura vazia — a migração `20260913120000_billing_coverage`
 *     escreveu uma linha para CADA fatia antiga (a de um veículo e a conjunta,
 *     esta com uma linha por tarefa do orçamento). Vazio aqui é dado FALTANDO, e
 *     a nota sairia inventando. Recusa.
 *   • COM `billing`, cobertura vazia e UM veículo no orçamento — "todos" e "este"
 *     são o mesmo conjunto: não há afirmação falsa possível. Emite.
 *
 * A recusa deixa o `NfseDocument` em ERROR, com `retryAfter` nulo: nenhuma
 * tentativa futura conserta dado que falta, e quem tem de agir é o operador.
 */
export const missingCoverageError = (
  customerConfig: any,
  coverage: { rows: Array<any>; source: CoverageSource },
): string | null => {
  if (coverage.source !== 'whole-quote') return null;
  const billing = customerConfig?.billing;
  if (!billing) return null;
  if (coverage.rows.length <= 1) return null;
  return (
    'Cobertura da cobrança ausente: o faturamento não declara quais veículos esta fatura ' +
    `cobre, e a nota sairia declarando os ${coverage.rows.length} veículos do orçamento. ` +
    'Refaça o faturamento para gravar a cobertura e emita a NFS-e de novo.'
  );
};
