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

/**
 * Sorted, stoplisted token key of a counterparty NAME — the lookup key for
 * CounterpartyProfile (name → CNPJ identity learning). Mirrors memoFingerprint
 * but uses the name pipeline (a name field carries no CNPJ/date/amount noise).
 * Returns null when nothing survives.
 */
export function nameFingerprint(raw: string | null | undefined): string | null {
  const tokens = [...nameTokens(raw)].sort();
  if (tokens.length === 0) return null;
  return tokens.join(' ');
}

// Stoplist for MEMO LEARNING tokens. Deliberately SMALLER than
// COMPANY_SUFFIX_TOKENS — words like "tarifa", "folha", "darf", "gps" ARE the
// category signal for transaction-only buckets, so they must survive here even
// though name-matching strips them. We drop only rail/instrument noise and pure
// connectors. Ubiquity of generic rails (pix/ted) is demoted by IDF at score
// time, not removed, so a memo that is ONLY "PIX" still contributes weakly.
export const MEMO_LEARN_STOPLIST: ReadonlySet<string> = new Set([
  // pure connectors
  'do', 'da', 'de', 'dos', 'das', 'em', 'no', 'na', 'ou', 'com', 'ref',
  // generic rail/instrument words that never disambiguate a category
  'pagamento', 'pagto', 'pgto', 'pgmt', 'recebimento', 'receb',
  'transf', 'doc', 'cred', 'credito', 'deb', 'debito', 'liquidacao', 'liquidado',
  // counterparty-form noise (subset of COMPANY_SUFFIX_TOKENS)
  'ltda', 'sa', 'epp', 'eireli', 'mei', 'cia',
]);

// Generic rails that must NOT resolve a category on their own — IDF demotes them
// and the learner floor-guards on minimum evidence.
export const MEMO_UBIQUITOUS_TOKENS: ReadonlySet<string> = new Set([
  'pix', 'ted', 'boleto', 'blt', 'tar',
]);

/**
 * Tokenises a memo into category-learning tokens. Unlike memoFingerprint (which
 * sorts+joins into a SINGLE exact key) this returns the INDIVIDUAL surviving
 * tokens so each votes independently — the generalization the exact alias lacks.
 * Strips CNPJ/CPF/dates/values like memoFingerprint, then applies the smaller
 * MEMO_LEARN_STOPLIST. Numbers are dropped (reference codes are exactly why
 * exact aliases fail to generalize: "darf 1410" and "darf 0220" → ["darf"]).
 * Returns [] when nothing survives.
 */
export function memoLearnTokens(memo: string | null | undefined): string[] {
  if (!memo) return [];
  const stripped = stripAccents(memo)
    .toLowerCase()
    .replace(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, ' ')
    .replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, ' ')
    .replace(/\d{11,14}/g, ' ')
    .replace(/\d{2}[./\-]\d{2}[./\-]\d{2,4}/g, ' ')
    .replace(/r\$\s?\d+[.,]?\d*/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ');
  return stripped
    .split(/\s+/)
    .filter(t => t.length >= 3 && !MEMO_LEARN_STOPLIST.has(t) && !/^\d+$/.test(t));
}

// ---------------------------------------------------------------------------
// NF line-item normalization (used by the item-category fuzzy classifier).
//
// FiscalDocumentItem.description is supplier free-text: UPPERCASE, abbreviated,
// with packaging/units and SEFAZ noise ("ONU 1263", "QUANT.LTDA", trailing
// "3 II"). These primitives strip that down to the tokens that carry the
// product's category signal, sharing stripAccents() with the rest of the module
// so the lexicon (built from Item.name) and the lookup (NF descriptions) speak
// the same dialect.
// ---------------------------------------------------------------------------

// Units, packaging and SEFAZ/classification noise dropped before matching an NF
// line to an item category. Kept separate from COMPANY_SUFFIX_TOKENS — that one
// targets counterparty names, this one targets product descriptions.
export const ITEM_STOPLIST: ReadonlySet<string> = new Set([
  // units / packaging
  'kg', 'kgs', 'gr', 'grs', 'mg', 'ml', 'lt', 'lts', 'litro', 'litros', 'un',
  'und', 'unid', 'unidade', 'cx', 'caixa', 'pct', 'pacote', 'pcs', 'pca',
  'metro', 'metros', 'pol', 'kit', 'fardo', 'rolo', 'rolos', 'saco', 'sacos',
  'lata', 'latas', 'galao', 'balde', 'frasco', 'tubo', 'par', 'pares', 'jogo',
  'pecas',
  // SEFAZ / NF noise observed in real data
  'onu', 'quant', 'ltda', 'material', 'relacionado', 'com', 'tintas',
  'classe', 'risco', 'embalagem',
  // NFSe painting-service noise (license plates / vehicle words / labels that
  // otherwise let a service line fuzzy-match a product item)
  'placa', 'placas', 'caminhao', 'carreta', 'cabine', 'serie', 'valor', 'veiculo',
  // generic connectors / filler
  'para', 'pra', 'tipo', 'cor', 'ref', 'cod', 'codigo', 'produto', 'item',
  'novo', 'nova',
]);

// Bare colour words. A colour alone must NOT resolve a category (it would let
// single-token "Pigmento" items like "Azul"/"Vermelho" hijack any line — paint
// descriptions and even NFSe vehicle-painting lines contain colours). The fuzzy
// matcher skips single-token item matches whose only token is a colour.
export const COLOR_TOKENS: ReadonlySet<string> = new Set([
  'azul', 'verde', 'vermelho', 'amarelo', 'laranja', 'preto', 'branco', 'cinza',
  'rosa', 'violeta', 'roxo', 'marrom', 'bege', 'dourado', 'prata', 'vinho',
  'creme', 'gelo', 'grafite', 'fosco', 'metalico',
  // colour modifiers — so a colour PHRASE ("Vermelho Vivo", "Azul Claro") is
  // still recognised as all-colour and can't hijack a paint line.
  'vivo', 'claro', 'escuro', 'medio', 'neon', 'perola', 'perolizado',
]);

/**
 * Tokenises an NF line description into category-signal tokens. Same accent +
 * lowercase + non-alnum-split rules as nameTokens, but with the item stoplist
 * and a 3-char floor. Critical short tokens (e.g. "pu") are handled by the
 * curated keyword overrides, not here.
 */
export function itemDescriptionTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const cleaned = stripAccents(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s+/)
    .filter(t => t.length >= 3 && !ITEM_STOPLIST.has(t) && !/^\d+$/.test(t));
}

/**
 * Extracts likely product-code tokens from a free-text description — tokens that
 * contain BOTH a letter and a digit (e.g. "m3500", "stv200", "int_hok" → "int",
 * "hok" don't qualify but "m3500" does). NF descriptions routinely embed our
 * Item.uniCode in the text ("MASSA POLIESTER M3500 …"); matching those against
 * the uniCode index disambiguates same-named items across categories. The
 * letter+digit rule deliberately excludes pure measures ("750", "6") and plain
 * words to avoid false uniCode collisions.
 */
export function codeCandidateTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const cleaned = stripAccents(raw).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s+/)
    .filter(t => t.length >= 3 && /[a-z]/.test(t) && /[0-9]/.test(t));
}

/**
 * Order-independent fingerprint of an NF line description, for the item-category
 * alias learner (description token-set → chosen category). Mirrors
 * memoFingerprint's strip-then-sort approach using the item stoplist.
 */
export function descriptionFingerprint(raw: string | null | undefined): string | null {
  const tokens = itemDescriptionTokens(raw).slice().sort();
  if (tokens.length === 0) return null;
  return tokens.join(' ');
}
