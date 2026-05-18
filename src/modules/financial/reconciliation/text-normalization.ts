// Shared text-normalization primitives for the reconciliation matcher and the
// alias learner. The two consumers MUST use the same stoplist + accent rules,
// otherwise the fingerprint we record on capture won't match the fingerprint
// we compute on lookup.

// Brazilian business-form + OFX transaction-prefix tokens dropped before any
// name comparison or fingerprinting. OFX memos routinely prepend
// "PAGAMENTO PIX-PIX_DEB", "TED CRED", "BOLETO LIQUIDADO" etc. — they're noise
// relative to the counterparty name.
export const COMPANY_SUFFIX_TOKENS: ReadonlySet<string> = new Set([
  // legal form
  'sa',
  'as',
  'ltda',
  'limitada',
  'epp',
  'eireli',
  'mei',
  'cia',
  'companhia',
  'sociedade',
  'anonima',
  // generic descriptors
  'industria',
  'comercio',
  'servicos',
  'servico',
  'transportes',
  'transporte',
  'distribuidora',
  'representacoes',
  'representacao',
  // connectors
  'do',
  'da',
  'de',
  'dos',
  'das',
  'em',
  'no',
  'na',
  'ou',
  'com',
  // OFX/banking prefixes
  'pagamento',
  'pagto',
  'pgto',
  'pgmt',
  'recebimento',
  'receb',
  'pix',
  'ted',
  'doc',
  'deb',
  'debito',
  'cred',
  'credito',
  'transferencia',
  'transf',
  'tarifa',
  'tar',
  'boleto',
  'blt',
  'estorno',
  'liquidacao',
  'liquidado',
  'fornecedor',
  'cliente',
]);

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Tokenises a name/memo into a Set of canonical comparison tokens. Strips
 * accents, lowercases, splits on non-alphanumeric runs, drops tokens shorter
 * than 3 chars and any token in the OFX/legal-form stoplist.
 */
export function nameTokens(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  const cleaned = stripAccents(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return new Set();
  const tokens = cleaned
    .split(/\s+/)
    .filter(t => t.length >= 3 && !COMPANY_SUFFIX_TOKENS.has(t));
  return new Set(tokens);
}

export function nameSimilarity(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const A = nameTokens(a);
  const B = nameTokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  if (inter === 0) return 0;
  // Overlap coefficient (|A∩B|/min). A short clean legal name fully contained
  // in a noisier memo should score 1.0; we shouldn't penalize a clean side
  // just because the other side has extra OFX prefix junk past our stoplist.
  const overlap = inter / Math.min(A.size, B.size);
  const jaccard = inter / (A.size + B.size - inter);
  return Math.max(overlap, jaccard);
}

/**
 * Canonical, order-independent fingerprint of an OFX memo. The same supplier
 * paying us in different months produces memos with the same descriptive
 * tokens but different FITIDs, dates and amounts; this function collapses
 * those into a single key we can learn against.
 *
 * Strips: CNPJ/CPF digit runs (11/14 digits), formatted CNPJ/CPF,
 * dd/mm/yyyy-style dates, R$ amounts, and any token in COMPANY_SUFFIX_TOKENS.
 * Then sorts the surviving tokens so "ACME TINTAS" and "TINTAS ACME"
 * fingerprint identically.
 *
 * Returns null when nothing meaningful survives normalisation — caller must
 * not learn or look up an alias for that memo.
 */
export function memoFingerprint(memo: string | null | undefined): string | null {
  if (!memo) return null;
  const stripped = stripAccents(memo)
    .toLowerCase()
    // Formatted CNPJ first (must precede digit-run strip so we don't leave dangling dots).
    .replace(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, ' ')
    .replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, ' ')
    // Standalone CNPJ (14) / CPF (11) digit runs.
    .replace(/\d{11,14}/g, ' ')
    // Dates: dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (and 2-digit year).
    .replace(/\d{2}[./\-]\d{2}[./\-]\d{2,4}/g, ' ')
    // Monetary values "R$ 1.234,56" or "1.234,56".
    .replace(/r\$\s?\d+[.,]?\d*/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ');

  const tokens = stripped
    .split(/\s+/)
    .filter(t => t.length >= 3 && !COMPANY_SUFFIX_TOKENS.has(t))
    .sort();

  if (tokens.length === 0) return null;
  return tokens.join(' ');
}
