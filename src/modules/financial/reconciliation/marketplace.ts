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
  return /\bmarketplace\b/i.test(memo);
}
