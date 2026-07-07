import { FiscalDocOffBankResolution, FiscalDocumentOperation } from '@prisma/client';

/**
 * Off-bank settlement detection for RECEIVED (ENTRADA) fiscal documents that
 * will never match a bank statement line, so they should be closed with a
 * reason instead of lingering as "Pendente" (and instead of polluting every
 * transaction's candidate pool).
 *
 * Signals come straight from the NF's own XML-derived fields:
 *   - `tPag` 03 (Cartão de crédito): the card BILL is later paid by a boleto, so
 *     the individual note never appears on the bank statement → CARTAO_CREDITO.
 *   - a doação/bonificação/brinde/amostra natureza → BONIFICACAO (free goods).
 *   - a non-payment remessa natureza (comodato, conserto, demonstração,
 *     garantia, locação…) → SEM_PAGAMENTO.
 *
 * The NATUREZA is authoritative for the non-sale cases: a remessa em
 * comodato/bonificação/amostra is never a paid purchase whatever the payment
 * code says (these routinely carry tPag 99 "Negociação Futura" or 90 "Sem
 * pagamento"), so resolution does NOT gate on tPag there.
 *
 * CRITICAL: the payment code is NOT trusted the other way — a bare tPag 90/99 on
 * a VENDA natureza is NOT resolved. Brazilian suppliers routinely stamp tPag 90
 * "Sem pagamento" / 99 "Negociação Futura" on ordinary term sales settled later
 * by boleto/PIX (Farben issues its VENDA notes with tPag 90 yet is paid
 * directly). Only an unambiguous NON-SALE natureza, or an all-credit-card tPag,
 * triggers auto-resolution.
 */

/**
 * Vendors whose ENTRADA notes are ALWAYS settled on the company credit card —
 * recurring subscriptions billed to the card, whose bill is later paid by a
 * boleto, so the individual note never appears on the bank statement. Service
 * notes (NFS-e) declare NO tPag, so the emitter CNPJ is the only reliable
 * signal. Extend as more recurring card vendors are identified.
 *   25012398000107 — Google Cloud Brasil (Workspace / Cloud)
 */
export const CREDIT_CARD_SERVICE_CNPJS = new Set<string>(['25012398000107']);

/** Combining diacritical marks (U+0300–U+036F), stripped after NFD normalize. */
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Strip everything but digits from a CNPJ/CPF. */
function digitsOnly(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

/** Strip accents + lowercase so "DOAÇÃO" and "doacao" compare equal. */
function normalizeText(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(DIACRITICS, '').toLowerCase();
}

/** Extract the tPag codes from the stored paymentMethods JSON ({tPag,vPag} | []). */
export function extractTPags(paymentMethods: unknown): string[] {
  if (!paymentMethods) return [];
  const list = Array.isArray(paymentMethods) ? paymentMethods : [paymentMethods];
  return list
    .map(p =>
      p && typeof p === 'object' && (p as { tPag?: unknown }).tPag != null
        ? String((p as { tPag: unknown }).tPag)
        : null,
    )
    .filter((t): t is string => !!t);
}

export interface OffBankDetectInput {
  operationType: FiscalDocumentOperation;
  naturezaOperacao?: string | null;
  paymentMethods?: unknown;
  emitCnpj?: string | null;
}

/**
 * Returns the off-bank resolution reason for a document, or null when it should
 * still be reconciled against a bank transaction. SAIDA (emitted) notes are
 * never handled here — their link is the faturamento, not a bank match.
 */
export function detectOffBankResolution(
  input: OffBankDetectInput,
): FiscalDocOffBankResolution | null {
  if (input.operationType !== FiscalDocumentOperation.ENTRADA) return null;

  // Known recurring credit-card vendor (e.g. Google Cloud): service notes carry
  // no tPag, so the emitter CNPJ is the only signal that it's card-settled.
  const emit = digitsOnly(input.emitCnpj);
  if (emit && CREDIT_CARD_SERVICE_CNPJS.has(emit)) {
    return FiscalDocOffBankResolution.CARTAO_CREDITO;
  }

  const nat = normalizeText(input.naturezaOperacao);
  // Free goods: doação / bonificação / brinde / amostra (grátis or not — an
  // "AMOSTRA" natureza is a free sample). The natureza is AUTHORITATIVE: a
  // non-sale remessa is never a paid purchase, whatever tPag says (these notes
  // routinely carry tPag 99 "Negociação Futura" or 90 "Sem pagamento").
  const bonusNat = /bonific|doacao|brinde|amostra/.test(nat);
  // Other non-payment remessas: goods that move without a sale (loaned, shown,
  // sent for repair, rented). Also natureza-authoritative.
  const noPaymentNat =
    /comodato|demonstracao|mostruario|conserto|em garantia|locacao|emprestimo/.test(nat);

  const pays = extractTPags(input.paymentMethods);
  const allCreditCard = pays.length > 0 && pays.every(t => t === '03');

  // Whole note paid by credit card → settled via the card bill, never a bank line.
  if (allCreditCard) return FiscalDocOffBankResolution.CARTAO_CREDITO;

  // Free goods (doação/bonificação/brinde/amostra) — never bank-settled.
  if (bonusNat) return FiscalDocOffBankResolution.BONIFICACAO;

  // Other genuine no-payment remessa (comodato, conserto, demonstração, locação…).
  if (noPaymentNat) return FiscalDocOffBankResolution.SEM_PAGAMENTO;

  // NB: a VENDA natureza is deliberately NOT resolved even with tPag 90/99 — it's
  // a term sale paid later by boleto/PIX and must stay a bank candidate.
  return null;
}
