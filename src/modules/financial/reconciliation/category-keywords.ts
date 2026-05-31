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
  // Resolution target: an ItemCategory name (product) or a service slug.
  itemCategoryName?: string;
  serviceSlug?: string;
  // Confidence (0-100) granted on a hit. Strong, unambiguous keywords score high.
  confidence: number;
}

// Product keywords → ItemCategory.name. Ordered most-specific first.
export const PRODUCT_KEYWORD_RULES: readonly KeywordRule[] = [
  // NOTE: "redutor" was removed — it collides with "redutor de impacto" (an
  // abrasive disc property), not paint reducer. Real-item matching handles the
  // genuine paint reducers via the Item corpus.
  { pattern: /\b(diluente|thinner|solvente)\b/, itemCategoryName: 'Diluente', confidence: 92 },
  { pattern: /\b(endurecedor|catalisador|cataliz)\b/, itemCategoryName: 'Endurecedor', confidence: 92 },
  { pattern: /\b(verniz|clear\s?coat|incolor)\b/, itemCategoryName: 'Verniz', confidence: 90 },
  { pattern: /\b(lixa|disco|hookit|roquite|interface|abrasiv|flap|grao|gr\d{2,3})\b/, itemCategoryName: 'Abrasivos', confidence: 90 },
  // "massa"/"poliester" removed — brand-dependent (Lazzuril=Ferramenta vs
  // Farben=Tinta); resolved by uniCode/fuzzy-item + brand tiebreak, not asserted here.
  { pattern: /\b(esm(\.|alte)?|tinta|primer|prim\.|conc(\.|entrado)?|base\s?coat|fundo|acril)\b/, itemCategoryName: 'Tinta', confidence: 80 },
  { pattern: /\b(pigmento|corante)\b/, itemCategoryName: 'Pigmento', confidence: 85 },
  { pattern: /\b(cabo|fio|disjuntor|tomada|lampada|reator|fusivel|conector|eletr)\b/, itemCategoryName: 'Elétrico', confidence: 82 },
  { pattern: /\b(parafuso|porca|arruela|broca|chave|alicate|martelo|serra|ferrament|rebite|abracadeira)\b/, itemCategoryName: 'Ferramenta', confidence: 78 },
  { pattern: /\b(luva|botina|bota|oculos|mascara|respirador|protetor|avental|epi|mangote)\b/, itemCategoryName: 'Epi', confidence: 85 },
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
  { pattern: /\bfarben\b/, itemCategoryNames: ['Tinta', 'Verniz', 'Diluente', 'Endurecedor'], confidence: 55 },
  { pattern: /\b(maquinas?\s+e\s+ferramentas?|vmd|dewalt|bosch|gedore)\b/, itemCategoryNames: ['Ferramenta'], confidence: 55 },
  { pattern: /\bconsiga\b|\bcontabil/, serviceSlug: 'contabilidade', confidence: 60 },
  { pattern: /\bgoogle\b|\bmicrosoft\b|\bamazon\s+web\b/, serviceSlug: 'ti', confidence: 60 },
  { pattern: /\balarm|\bmonitora|\bsegur/, serviceSlug: 'monitoramento', confidence: 55 },
  { pattern: /\bcomunicacao\s+visual|\bplotagem|\badesiv/, serviceSlug: 'comunicacao-visual', confidence: 55 },
  { pattern: /\bunimed\b|\bnutricard\b|\bmedic/, serviceSlug: 'saude', confidence: 55 },
];
