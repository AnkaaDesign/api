/**
 * Geradores de texto do orçamento (pagamento, garantia, prazo).
 *
 * Porte fiel de `web/src/utils/quote-text-generators.ts`. A duplicação é
 * deliberada e não deve ser "corrigida": os repositórios são independentes, e a
 * partir de agora o **servidor** é a fonte da verdade do documento assinado. O
 * web continua usando a versão dele para a pré-visualização em tela; qualquer
 * divergência aparece no PDF congelado, que é o que vale.
 */

import { TRUCK_CATEGORY_LABELS, IMPLEMENT_TYPE_LABELS } from '@constants/enum-labels';
import { toTitleCase } from '@utils/formatters';
import { parseDueDateYMD } from '@utils/due-date.util';

const NUMBER_WORDS: Record<number, string> = {
  1: 'uma',
  2: 'duas',
  3: 'três',
  4: 'quatro',
  5: 'cinco',
  6: 'seis',
  7: 'sete',
};

const PAYMENT_METHOD_PHRASES: Record<string, string> = {
  BANK_SLIP: 'via boleto',
  PIX: 'via Pix',
  CASH: 'em dinheiro',
  TRANSFER: 'via transferência bancária',
  ACCOUNT_GENIVALDO: 'via depósito em conta',
  ACCOUNT_SERGIO: 'via depósito em conta',
};

export interface PaymentConfig {
  type?: 'CASH' | 'INSTALLMENTS' | string;
  cashDays?: number;
  installmentCount?: number;
  installmentStep?: number;
  entryDays?: number;
  specificDate?: string;
  method?: string;
}

export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

/** `DD/MM/AAAA` no fuso de Brasília — o documento é lido no Brasil. */
export function formatDateBR(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }).format(d);
}

/** `DD/MM/AAAA HH:mm:ss` com o offset explícito, como Clicksign e Autentique imprimem. */
export function formatDateTimeBR(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const formatted = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'America/Sao_Paulo',
  }).format(d);
  return `${formatted} (GMT-03:00)`;
}

function formatDays(n: number): string {
  return `${n} ${n === 1 ? 'dia' : 'dias'}`;
}

/**
 * `specificDate` é uma DATA DE CALENDÁRIO ("2026-08-12"), não um instante.
 *
 * O porte do web usava `new Date(y, m - 1, d)` — meia-noite LOCAL — porque no
 * browser o local É São Paulo e `formatDate` também formata em local: os dois
 * se cancelam. No servidor não: o `ankaa-api.service` não define `TZ` e a
 * máquina é `Etc/UTC`, então meia-noite local vira meia-noite UTC, e
 * `formatDateBR` (que fixa America/Sao_Paulo, UTC-3) renderiza o dia ANTERIOR.
 * O orçamento 609 (Nutrymax 15,50 — série 38772) saiu com "vencimento em
 * 11/08/2026" no dossiê enquanto a parcela e o boleto diziam 12/08.
 *
 * `parseDueDateYMD` materializa ao MEIO-DIA UTC, a mesma convenção com que
 * parcela e boleto são gravados — daí o dia do calendário ser o mesmo em
 * qualquer fuso, e o texto do documento bater com o boleto por construção.
 */
function parseSpecificDate(iso?: string): Date | null {
  if (!iso) return null;
  const ymd = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const date = parseDueDateYMD(ymd);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function conditionToConfig(condition?: string | null): PaymentConfig | null {
  if (!condition || condition === 'CUSTOM') return null;
  const cashDays: Record<string, number> = { CASH_5: 5, CASH_10: 10, CASH_20: 20, CASH_40: 40 };
  if (condition in cashDays) return { type: 'CASH', cashDays: cashDays[condition] };
  const counts: Record<string, number> = {
    INSTALLMENTS_2: 2,
    INSTALLMENTS_3: 3,
    INSTALLMENTS_4: 4,
    INSTALLMENTS_5: 5,
    INSTALLMENTS_6: 6,
    INSTALLMENTS_7: 7,
  };
  const installmentCount = counts[condition];
  if (!installmentCount) return null;
  return { type: 'INSTALLMENTS', installmentCount, installmentStep: 20, entryDays: 5 };
}

function fromConfig(
  pc: PaymentConfig,
  total: number,
  methodPhrase: string,
  firstDueDate: Date | null,
): string {
  const dueDate = firstDueDate ?? parseSpecificDate(pc.specificDate);

  if (pc.type === 'CASH') {
    const head = `Pagamento à vista no valor de ${formatCurrencyBRL(total)}${methodPhrase}`;
    return dueDate
      ? `${head}, com vencimento em ${formatDateBR(dueDate)}.`
      : `${head}, para ${formatDays(pc.cashDays ?? 5)} a partir da finalização do serviço.`;
  }

  if (pc.type === 'INSTALLMENTS') {
    const count = pc.installmentCount ?? 2;
    const step = pc.installmentStep ?? 20;
    const entryDays = pc.entryDays ?? 5;
    const installmentValue = Math.round((total / count) * 100) / 100;
    const word = NUMBER_WORDS[count] ?? String(count);
    const entryText = dueDate
      ? `com entrada em ${formatDateBR(dueDate)}`
      : `com entrada para ${formatDays(entryDays)} a partir da finalização do serviço`;
    return `Fica acertado o pagamento em ${count} (${word}) parcelas de ${formatCurrencyBRL(
      installmentValue,
    )}${methodPhrase}, ${entryText} e as demais a cada ${formatDays(step)}.`;
  }

  return '';
}

export function generatePaymentText(args: {
  customPaymentText?: string | null;
  paymentConfig?: PaymentConfig | null;
  paymentCondition?: string | null;
  total: number;
  paymentMethod?: string | null;
  /**
   * Vencimento da 1ª parcela REAL, quando o faturamento já a gerou.
   *
   * O `specificDate` do `paymentConfig` é o que foi *combinado*; a parcela é o
   * que foi *emitido*. `generateInstallmentsFromPaymentConfig` ainda aplica o
   * piso de hoje+3 e rola sábado/domingo/feriado para o próximo dia útil, então
   * os dois divergem sempre que a data combinada cai em dia não útil ou já
   * passou — e o dossiê ficava citando um dia que o boleto não tem. O web já
   * preferia a parcela real (`configInstallments[0]?.dueDate`); esta porta não
   * aceitava o parâmetro, e era essa a segunda fonte de divergência.
   *
   * Na assinatura ainda não há parcela: fica `null` e a cláusula sai do
   * `specificDate`, exatamente como antes.
   */
  firstDueDate?: Date | null;
}): string {
  if (args.customPaymentText) return args.customPaymentText;

  const config = args.paymentConfig?.type
    ? args.paymentConfig
    : conditionToConfig(args.paymentCondition);
  if (!config) return '';

  const method = args.paymentMethod || args.paymentConfig?.method || 'BANK_SLIP';
  const phrase = PAYMENT_METHOD_PHRASES[method];
  const methodPhrase = phrase ? ` ${phrase}` : '';

  const firstDueDate =
    args.firstDueDate && !Number.isNaN(args.firstDueDate.getTime()) ? args.firstDueDate : null;

  return fromConfig(config, args.total, methodPhrase, firstDueDate);
}

export function generateGuaranteeText(args: {
  customGuaranteeText?: string | null;
  guaranteeYears?: number | null;
}): string {
  if (args.customGuaranteeText) return args.customGuaranteeText;
  if (!args.guaranteeYears) return '';
  return `A Garantia para o serviço de pintura é de ${args.guaranteeYears} anos desde que seja atendido as condições de uso e cuidado do implemento.`;
}

/** Escape de HTML sem DOM — o gerador do web usa `document.createElement`, indisponível aqui. */
export function escapeHtml(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Destaca "N anos" em negrito, como o gerador do web. */
export function formatGuaranteeHtml(text: string): string {
  return escapeHtml(text).replace(/(\d+)\s*(anos?)/gi, '<strong>$1 $2</strong>');
}

// ===========================================================================
// RÓTULOS DE ENUM
// ---------------------------------------------------------------------------
// O documento assinado exibia o valor CRU do enum: "SEMI_TRAILER_2_AXLES" e
// "CURTAIN_SIDE" no lugar de "Semirreboque 2 Eixos" e "Sider". Num orçamento
// que o cliente assina, isso não é um detalhe de UI — é o texto do documento.
//
// Os mapas são reusados de `@constants/enum-labels` (os MESMOS que a web
// importa em `budget-pdf-generator.ts`), nunca reescritos aqui: uma segunda
// tabela divergiria na primeira categoria nova.
// ===========================================================================

/**
 * Resolve o rótulo humano, deixando passar o que já vier resolvido.
 *
 * O fallback não é preguiça: o chamador atual (`SignatureEnvelopeService`)
 * entrega o enum cru, mas os scripts de smoke entregam "Carreta"/"Baú" prontos.
 * Como nenhum rótulo é chave do mapa, `map[value] ?? value` acerta os dois — e
 * um enum novo ainda não mapeado aparece cru em vez de sumir do documento.
 */
function resolveLabel(map: Record<string, string>, value: string | null): string | null {
  if (!value) return null;
  return map[value] ?? value;
}

export function truckCategoryLabel(value: string | null): string | null {
  return resolveLabel(TRUCK_CATEGORY_LABELS as Record<string, string>, value);
}

export function implementTypeLabel(value: string | null): string | null {
  return resolveLabel(IMPLEMENT_TYPE_LABELS as Record<string, string>, value);
}

// ===========================================================================
// LINHA DE SERVIÇO
// ===========================================================================

export interface QuoteServiceLine {
  description: string;
  observation: string | null;
}

/**
 * Texto de uma linha de serviço, como o gerador de referência monta
 * (`web/src/utils/budget-pdf-generator.ts:530-551`).
 *
 * Três regras, todas dele:
 * 1. A descrição vai em **Title Case** — o cadastro é digitado em caixa alta e
 *    "PINTURA GERAL AZUL FIRENZE" gritando no meio do documento era o efeito.
 * 2. A observação é anexada **na mesma linha**, e sem Title Case: é texto livre
 *    do vendedor ("Azul Firenze", "conforme layout"), e recapitalizá-lo
 *    estragaria nomes próprios e códigos.
 * 3. **"Outros" some** quando há observação. O item genérico existe só para
 *    abrigar o texto livre; imprimir "Outros Pintura do teto" descreveria o
 *    serviço errado num documento que o cliente assina.
 */
export function serviceLineText(service: QuoteServiceLine): string {
  const observation = (service.observation ?? '').trim();
  const raw = (service.description ?? '').trim();
  const isOutros = raw.toLowerCase() === 'outros';
  const description = toTitleCase(raw || 'Serviço');

  if (isOutros && observation) return observation;
  return observation ? `${description} ${observation}` : description;
}

// ===========================================================================
// DESCONTO
// ===========================================================================

export interface DiscountLabelInput {
  /** Percentual, quando `discountType === 'PERCENTAGE'`. */
  percent?: number | null;
  /** Texto livre do motivo ("ESPECIAL", "CAMPANHA JULHO"). */
  reference?: string | null;
  /**
   * Forma legada: `"5%"` ou já a própria referência. Mantida porque
   * `SignatureEnvelopeService` ainda alimenta este campo. Ignorada quando
   * `percent`/`reference` são informados.
   */
  legacy?: string | null;
}

const PERCENT_ONLY = /^\s*\d+(?:[.,]\d+)?\s*%\s*$/;

/**
 * `Desconto (5%) — ESPECIAL`.
 *
 * O parêntese carrega o **percentual**; a referência entra depois de um travessão.
 * É a forma usada na página pública do orçamento
 * (`web/src/pages/public/budget/[id].tsx:471-477`), no Dossiê
 * (`web/src/utils/dossie-pdf-generator.ts:530-534`) e no detalhe da tarefa —
 * ou seja, é o que o cliente já viu antes de assinar.
 *
 * O porte server-side colapsava os dois num único parêntese, e o resultado para
 * um desconto de valor fixo era `Desconto (ESPECIAL)`: lia-se como se
 * "ESPECIAL" fosse o percentual. Com referência E percentual juntos, a
 * referência simplesmente sumia do documento assinado.
 */
export function composeDiscountLabel(input: DiscountLabelInput): string {
  let label = 'Desconto';

  const percentText =
    input.percent != null && Number.isFinite(input.percent)
      ? `${input.percent}%`
      : input.legacy && PERCENT_ONLY.test(input.legacy)
        ? input.legacy.trim()
        : null;
  if (percentText) label += ` (${percentText})`;

  const reference =
    input.reference?.trim() ||
    // O legado só vira referência quando NÃO é o percentual — senão a mesma
    // informação apareceria duas vezes.
    (input.legacy && !PERCENT_ONLY.test(input.legacy) ? input.legacy.trim() : null);
  if (reference) label += ` — ${reference}`;

  return label;
}
