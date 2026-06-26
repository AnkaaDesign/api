/**
 * Marketplace payment detection.
 *
 * Purchases made through a marketplace (Mercado Livre, Mercado Pago, etc.) are
 * settled to the marketplace's payment *intermediary*, not to the store that
 * actually sells the goods and emits the NF. The bank memo therefore carries
 * the intermediary's CNPJ (e.g. 10573521000191 — Mercado Pago) or no CNPJ at
 * all — never the NF emitter's. That makes CNPJ-based reconciliation
 * impossible: the only signal that ties the debit to its fiscal document is the
 * amount.
 *
 * Detection is memo-based on purpose, so it covers both observed Sicredi
 * variants identically:
 *   - "PAGAMENTO PIX-PIX_DEB 10573521000191 PIX Marketplace" (intermediary CNPJ)
 *   - "PAGAMENTO PIX-PIX_DEB PIX Marketplace"                  (no CNPJ)
 *
 * Refunds ("DEVOLUCAO PIX-PIX_CRED ... PIX Marketplace") also contain the word
 * but are CREDITs and are classified as ESTORNO upstream; callers that only
 * want outbound payments must gate on BankTransactionType.DEBIT themselves.
 */
export function isMarketplaceMemo(memo: string | null | undefined): boolean {
  if (!memo) return false;
  // "marketplace" (Mercado Livre/Pago) or the Shopee intermediary's memo, which
  // never carries the word "marketplace" — it reads "SHPP BRASIL INSTITUICAO DE
  // PAG" (or "SHOPEE"). Both settle through a payment intermediary the same way.
  return /\bmarketplace\b|\bshopee\b|\bshpp\b/i.test(memo);
}

/**
 * CNPJs of the payment intermediaries that settle marketplace purchases. The
 * bank memo carries THIS CNPJ, never the seller's, so it's the most reliable
 * marketplace signal — more robust than the memo text, which varies per bank.
 *   - 10573521000191 — Mercado Pago (Mercado Livre)
 *   - 38372267000182 — SHPP Brasil Instituição de Pagamento (Shopee)
 */
export const MARKETPLACE_INTERMEDIARY_CNPJS = new Set<string>([
  '10573521000191',
  '38372267000182',
]);

/**
 * Whether a bank transaction is a marketplace payment, detected by the
 * intermediary CNPJ (primary signal) or the memo (fallback). Used to route the
 * debit into the value-only marketplace matching pass: marketplace settlements
 * carry the intermediary's CNPJ — never the NF emitter's — so the only signal
 * tying the debit to its fiscal document is the amount.
 */
export function isMarketplaceTransaction(
  memo: string | null | undefined,
  counterpartyCnpjCpf: string | null | undefined,
): boolean {
  const digits = counterpartyCnpjCpf?.replace(/\D/g, '');
  if (digits && MARKETPLACE_INTERMEDIARY_CNPJS.has(digits)) return true;
  return isMarketplaceMemo(memo);
}
