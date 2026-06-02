// Curated, domain-tuned overrides for the item-category fuzzy classifier.
//
// Pure token-frequency over the Item.name lexicon mis-routes a few real cases
// the data exposed: "Pigmento" items are bare colour words (Vermelho, Azul…)
// that also appear inside Tinta descriptions ("CONC.VERMELHO VIVO"), and
// monitor/placa land in both Elétrico and Escritório. These keyword/regex hits
// run BEFORE the lexicon and win, so an explicit product keyword always beats a
// stray colour token.
//
// Keys map to ItemCategory.name (matched case-insensitively against the
// item-derived TransactionCategory rows) for product categories, or to a
// SERVICE slug for service NFs.

export interface KeywordRule {
  // Regex tested against the accent-stripped, lowercased raw description.
  pattern: RegExp;
  // Resolution target. `itemCategoryName` is the legacy flat ItemCategory name;
  // `itemCategoryNames` lists candidate names most-specific (new taxonomy leaf)
  // first — the classifier resolves the first that exists, so a rule reaches the
  // mirrored leaf when the new taxonomy is live and still falls back to the flat
  // name otherwise. A service rule sets `serviceSlug` instead.
  itemCategoryName?: string;
  itemCategoryNames?: string[];
  serviceSlug?: string;
  // Confidence (0-100) granted on a hit. Strong, unambiguous keywords score high.
  confidence: number;
}

// Product keywords → ItemCategory.name. Ordered most-specific first.
//
// FIXES (vs the old flat lexicon):
//   - DISCO / LIXA / HOOKIT → Abrasivos (was mislabelled "Ferramenta").
//   - CLEAR / VERNIZ → Verniz (bare "clear" was leaking into "Tinta").
//   - CATALISADOR / ENDURECEDOR → Endurecedor (kept; now also reaches the leaf).
//   - FRESA / TUPIA / ALARGADOR → Ferramenta (cutting tools = Investimento).
export const PRODUCT_KEYWORD_RULES: readonly KeywordRule[] = [
  // NOTE: "redutor" was removed — it collides with "redutor de impacto" (an
  // abrasive disc property), not paint reducer. Real-item matching handles the
  // genuine paint reducers via the Item corpus.
  {
    pattern: /\b(diluente|thinner|solvente|reduzidor|aguarras)\b/,
    itemCategoryNames: ['Diluentes e thinners', 'Diluente'],
    itemCategoryName: 'Diluente',
    confidence: 92,
  },
  {
    pattern: /\b(endurecedor|catalisador|cataliz|hardener)\b/,
    itemCategoryNames: ['Endurecedores e catalisadores', 'Endurecedor'],
    itemCategoryName: 'Endurecedor',
    confidence: 92,
  },
  {
    // Bare "clear" now maps to Verniz (was being captured by the Tinta rule).
    pattern: /\b(verniz|verniz\s?pu|clear|clear\s?coat|incolor)\b/,
    itemCategoryNames: ['Vernizes e clears (acabamento)', 'Verniz'],
    itemCategoryName: 'Verniz',
    confidence: 90,
  },
  {
    // DISCO / LIXA / HOOKIT are Abrasivos — never Ferramenta.
    pattern: /\b(lixa|disco|hookit|roquite|interface|abrasiv|flap|trizact|grao|gr\d{2,3})\b/,
    itemCategoryNames: ["Lixas em folha (manual / d'água)", 'Abrasivos'],
    itemCategoryName: 'Abrasivos',
    confidence: 90,
  },
  {
    pattern: /\b(primer|prim\.|wash\s?primer|fundo|seladora)\b/,
    itemCategoryNames: ['Primers, wash primers e seladoras (fundos)', 'Tinta'],
    itemCategoryName: 'Tinta',
    confidence: 82,
  },
  // "massa"/"poliester" removed — brand-dependent (Lazzuril=Ferramenta vs
  // Farben=Tinta); resolved by uniCode/fuzzy-item + brand tiebreak, not asserted here.
  {
    pattern: /\b(esm(\.|alte)?|tinta|conc(\.|entrado)?|base\s?coat|acril|sintetic|esmalte)\b/,
    itemCategoryNames: ['Tintas e bases prontas (acrílico, sintético, base coat)', 'Tinta'],
    itemCategoryName: 'Tinta',
    confidence: 80,
  },
  {
    pattern: /\b(pigmento|corante|toner|xirallic|perolizado)\b/,
    itemCategoryNames: ['Toners / Bases tintométricas (corantes de cor)', 'Pigmento'],
    itemCategoryName: 'Pigmento',
    confidence: 85,
  },
  {
    pattern: /\b(cabo|fio|disjuntor|tomada|lampada|reator|fusivel|conector|eletr)\b/,
    itemCategoryName: 'Elétrico',
    confidence: 82,
  },
  {
    // FRESA / TUPIA / ALARGADOR are cutting tools → Ferramenta (Investimento).
    pattern: /\b(fresa|tupia|alargador|broca|serra|lamina|bedame|cossinete|macho)\b/,
    itemCategoryNames: ['Ferramentas de corte/recorte e escovas', 'Ferramenta'],
    itemCategoryName: 'Ferramenta',
    confidence: 80,
  },
  {
    pattern: /\b(parafuso|porca|arruela|chave|alicate|martelo|ferrament|rebite|abracadeira)\b/,
    itemCategoryNames: ['Chaves e soquetes (parafusaria)', 'Ferramenta'],
    itemCategoryName: 'Ferramenta',
    confidence: 78,
  },
  {
    pattern: /\b(luva|botina|bota|oculos|mascara|respirador|protetor|avental|epi|mangote)\b/,
    itemCategoryNames: ['Proteção das mãos — luvas descartáveis', 'Epi'],
    itemCategoryName: 'Epi',
    confidence: 85,
  },
];

// Service keywords → SERVICE slug (seeded in the migration). Used for NFSe
// content that has no inventory equivalent.
export const SERVICE_KEYWORD_RULES: readonly KeywordRule[] = [
  { pattern: /\b(pintura|colorimetr|repintura|funilaria)\b/, serviceSlug: 'pintura', confidence: 85 },
  { pattern: /\b(contab|escrit(a|ur)|fiscal|honorario|consultoria\s+contab)\b/, serviceSlug: 'contabilidade', confidence: 85 },
  { pattern: /\b(medic|saude|exame|aso|seguranca\s+do\s+trabalho|ocupacional|nutri)\b/, serviceSlug: 'saude', confidence: 82 },
  { pattern: /\b(cloud|hosting|hospedagem|software|licenca|google|microsoft|saas|sistema|dominio|servidor)\b/, serviceSlug: 'ti', confidence: 80 },
  { pattern: /\b(monitoramento|alarme|vigilancia|seguranca\s+eletr|cftv|cameras?)\b/, serviceSlug: 'monitoramento', confidence: 85 },
  { pattern: /\b(comunicacao\s+visual|adesiv|plotagem|banner|fachada|letreiro|desenho\s+em|envelopament)\b/, serviceSlug: 'comunicacao-visual', confidence: 82 },
];

// Emitter-name priors. Strong recurring suppliers bias the whole NF toward a
// family of categories when line text is thin. Matched against emitName
// (accent-stripped, lowercased). Resolution targets are ItemCategory names or
// service slugs; confidence is modest since it's a prior, not a line match.
export interface EmitterPrior {
  pattern: RegExp;
  itemCategoryNames?: string[];
  serviceSlug?: string;
  confidence: number;
}

export const EMITTER_PRIORS: readonly EmitterPrior[] = [
  // FARBEN (supplier root NCM 85111441) → Matéria-Prima family.
  { pattern: /\bfarben\b/, itemCategoryNames: ['Tinta', 'Verniz', 'Diluente', 'Endurecedor'], confidence: 55 },
  // BR EPIS → EPI family.
  { pattern: /\bbr\s?epis?\b|\bepis?\s+brasil\b/, itemCategoryNames: ['Proteção das mãos — luvas descartáveis', 'Calçados de segurança', 'Epi'], confidence: 58 },
  // VMD → Investimento (tools/equipment).
  { pattern: /\b(maquinas?\s+e\s+ferramentas?|vmd|dewalt|bosch|gedore)\b/, itemCategoryNames: ['Ferramentas de corte/recorte e escovas', 'Ferramenta'], confidence: 55 },
  // NUTRICARD → Cozinha / alimentação (Apoio).
  { pattern: /\bnutricard\b/, itemCategoryNames: ['Copa / descartáveis (alimentação)', 'Cozinha'], confidence: 55 },
  { pattern: /\bconsiga\b|\bcontabil/, serviceSlug: 'contabilidade', confidence: 60 },
  { pattern: /\bgoogle\b|\bmicrosoft\b|\bamazon\s+web\b/, serviceSlug: 'ti', confidence: 60 },
  { pattern: /\balarm|\bmonitora|\bsegur/, serviceSlug: 'monitoramento', confidence: 55 },
  { pattern: /\bcomunicacao\s+visual|\bplotagem|\badesiv/, serviceSlug: 'comunicacao-visual', confidence: 55 },
  { pattern: /\bunimed\b|\bnutricard\b|\bmedic/, serviceSlug: 'saude', confidence: 55 },
];
