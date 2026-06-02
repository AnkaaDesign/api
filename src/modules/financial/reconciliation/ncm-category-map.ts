// NCM → item subcategory map for the reconciliation item classifier.
//
// The fiscal XML carries the NCM (Nomenclatura Comum do Mercosul) on every NFe
// product line (`FiscalDocumentItem.ncm`, from prod.NCM). For this supplier mix
// the NCM is *near-deterministic* for the operational subcategory — far more
// reliable than fuzzy item-name matching, which trips on shared prefixes
// ("Disco …" = Abrasivo vs Ferramenta) and brand-dependent words ("Clear" =
// Verniz, not Tinta). Measured facts drive the high-confidence 8-digit rows;
// 4/6-digit prefixes give sensible coverage for the rest of each chapter.
//
// Each target names a MIRRORED leaf TransactionCategory (an ITEM_DERIVED row
// that 1:1-mirrors an ItemCategory). Because the new taxonomy uses long,
// punctuation-heavy leaf names, every target carries:
//   - `names`: ordered candidate ItemCategory/TransactionCategory names (the
//     classifier resolves the first that exists — handles new-vs-old taxonomy);
//   - `slugs`: ordered candidate slugs (fallback when a name lookup misses);
// The resolver in the classifier tries names then slugs and takes the first hit,
// so a partially-migrated mirror still resolves to *something* sensible.
//
// Confidence is per-row: 8-digit deterministic hits score ~96, chapter/heading
// prefixes a notch lower (the line could be an adjacent product in the chapter).

export interface NcmTarget {
  /** Candidate mirror-leaf names, most-specific (new taxonomy) first. */
  names: string[];
  /** Candidate mirror slugs, used when no name resolves. */
  slugs: string[];
  /** 0-100 confidence granted on a hit. */
  confidence: number;
  /** Human note — why this NCM maps here (kept for audit/readability). */
  note?: string;
}

// Canonical leaf targets, reused across NCM entries to avoid drift.
const T = {
  diluente: {
    names: ['Diluentes e thinners', 'Diluente'],
    slugs: ['diluentes-e-thinners', 'diluente'],
    confidence: 96,
    note: 'Diluente / thinner / solvente',
  },
  verniz: {
    names: ['Vernizes e clears (acabamento)', 'Verniz'],
    slugs: ['vernizes-e-clears-acabamento', 'verniz'],
    confidence: 96,
    note: 'Verniz / clear coat',
  },
  tinta: {
    names: ['Tintas e bases prontas (acrílico, sintético, base coat)', 'Tinta'],
    slugs: ['tintas-e-bases-prontas', 'tinta'],
    confidence: 95,
    note: 'Tinta / base pronta',
  },
  toner: {
    names: ['Toners / Bases tintométricas (corantes de cor)', 'Pigmento'],
    slugs: ['toners-bases-tintometricas', 'pigmento'],
    confidence: 92,
    note: 'Pigmento / toner / corante',
  },
  endurecedor: {
    names: ['Endurecedores e catalisadores', 'Endurecedor'],
    slugs: ['endurecedores-e-catalisadores', 'endurecedor'],
    confidence: 96,
    note: 'Endurecedor / catalisador',
  },
  primer: {
    names: ['Primers, wash primers e seladoras (fundos)', 'Primer', 'Tinta'],
    slugs: ['primers-wash-primers-e-seladoras', 'primer', 'tinta'],
    confidence: 90,
    note: 'Primer / fundo / seladora',
  },
  preparador: {
    names: ['Preparadores de superfície (desengraxante/removedor)', 'Diluente'],
    slugs: ['preparadores-de-superficie', 'diluente'],
    confidence: 88,
    note: 'Desengraxante / removedor de superfície',
  },
  luvasDescartaveis: {
    names: ['Proteção das mãos — luvas descartáveis', 'Epi'],
    slugs: ['protecao-das-maos-luvas-descartaveis', 'epi'],
    confidence: 94,
    note: 'Luvas (EPI)',
  },
  calcados: {
    names: ['Calçados de segurança', 'Epi'],
    slugs: ['calcados-de-seguranca', 'epi'],
    confidence: 94,
    note: 'Botina / calçado de segurança (EPI)',
  },
  protecaoResp: {
    names: ['Proteção respiratória — máscaras e respiradores', 'Epi'],
    slugs: ['protecao-respiratoria-mascaras-e-respiradores', 'epi'],
    confidence: 85,
    note: 'Máscara / respirador (EPI)',
  },
  abrasivosLixa: {
    names: ["Lixas em folha (manual / d'água)", 'Abrasivos'],
    slugs: ['lixas-em-folha', 'abrasivos'],
    confidence: 90,
    note: 'Abrasivos (lixa/disco) — chapter 68',
  },
  abrasivosDisco: {
    names: ['Discos de desbaste e corte (esmerilhadeira)', 'Abrasivos'],
    slugs: ['discos-de-desbaste-e-corte', 'abrasivos'],
    confidence: 90,
    note: 'Disco abrasivo de desbaste/corte',
  },
  ferramentasCorte: {
    names: ['Ferramentas de corte/recorte e escovas', 'Ferramenta'],
    slugs: ['ferramentas-de-corte-recorte-e-escovas', 'ferramenta'],
    confidence: 88,
    note: 'Fresas / ferramentas de corte (Investimento)',
  },
  ferramentasManuais: {
    names: ['Chaves e soquetes (parafusaria)', 'Ferramenta'],
    slugs: ['chaves-e-soquetes', 'ferramenta'],
    confidence: 82,
    note: 'Ferramentas manuais (chaves/soquetes)',
  },
  fixadores: {
    names: ['Fixadores — parafusos e porcas', 'Ferramenta'],
    slugs: ['fixadores-parafusos-e-porcas', 'ferramenta'],
    confidence: 82,
    note: 'Parafusos / porcas / fixação',
  },
  massas: {
    names: ['Massas de reparo (poliéster/plástica)', 'Tinta'],
    slugs: ['massas-de-reparo', 'tinta'],
    confidence: 84,
    note: 'Massa poliéster / plástica (funilaria)',
  },
  fitaMascaramento: {
    names: ['Fita crepe / fita de mascaramento', 'Abrasivos'],
    slugs: ['fita-crepe-fita-de-mascaramento'],
    confidence: 86,
    note: 'Fita crepe / mascaramento',
  },
} satisfies Record<string, NcmTarget>;

// ---------------------------------------------------------------------------
// 8-digit exact NCMs (deterministic, measured). Highest priority.
// ---------------------------------------------------------------------------
const NCM_EXACT: Readonly<Record<string, NcmTarget>> = {
  '38140090': T.diluente, // Solventes/diluentes compostos orgânicos
  '32081020': T.verniz, // Vernizes/tintas à base de poliésteres (Clear)
  '32089021': T.tinta, // Tintas/bases não-aquosas (base coat)
  '32129090': T.toner, // Pigmentos/corantes (toner tintométrico)
  '38249931': T.endurecedor, // Catalisador / endurecedor (preparação química)
  '40151900': T.luvasDescartaveis, // Luvas de borracha (EPI)
  '64039990': T.calcados, // Calçado de segurança (botina) — couro
  '68052000': T.abrasivosLixa, // Abrasivos sobre papel/tecido (lixa)
};

// ---------------------------------------------------------------------------
// 6-digit headings (sub-chapter). Resolve when the exact 8-digit code is absent.
// ---------------------------------------------------------------------------
const NCM_6: Readonly<Record<string, NcmTarget>> = {
  '320810': T.verniz, // poliésteres
  '320890': { ...T.tinta, confidence: 90 },
  '321290': { ...T.toner, confidence: 88 },
  '381400': { ...T.diluente, confidence: 92 },
  '382499': { ...T.endurecedor, confidence: 86 },
  '340290': T.preparador, // agentes de superfície / desengraxante
  '401519': { ...T.luvasDescartaveis, confidence: 90 },
  '640399': { ...T.calcados, confidence: 90 },
  '630790': { ...T.protecaoResp, confidence: 78 }, // máscaras têxteis
  '680520': T.abrasivosLixa,
  '680530': { ...T.abrasivosLixa, confidence: 88 },
  '482390': { ...T.fitaMascaramento, confidence: 80 }, // papel de cobertura
  '391910': { ...T.fitaMascaramento, confidence: 78 }, // fita autoadesiva plástica
  '820900': { ...T.ferramentasCorte, confidence: 86 }, // plaquitas/insertos de corte
  '732690': { ...T.fixadores, confidence: 70 },
};

// ---------------------------------------------------------------------------
// 4-digit chapter headings — broad fallback. Lower confidence.
// ---------------------------------------------------------------------------
const NCM_4: Readonly<Record<string, NcmTarget>> = {
  '3208': { ...T.verniz, confidence: 78, note: 'Cap. 3208 — tintas/vernizes não-aquosos' },
  '3209': { ...T.tinta, confidence: 78, note: 'Cap. 3209 — tintas/vernizes aquosos' },
  '3210': { ...T.tinta, confidence: 72 },
  '3212': { ...T.toner, confidence: 78 },
  '3214': { ...T.massas, confidence: 76 }, // mástiques / massas de vedação
  '3814': { ...T.diluente, confidence: 80 },
  '3824': { ...T.endurecedor, confidence: 70 },
  '4015': { ...T.luvasDescartaveis, confidence: 84 },
  '4016': { ...T.luvasDescartaveis, confidence: 60 },
  '6403': { ...T.calcados, confidence: 84 },
  '6404': { ...T.calcados, confidence: 78 },
  '6506': { ...T.protecaoResp, confidence: 60 }, // capacetes/EPI cabeça
  '6804': { ...T.abrasivosDisco, confidence: 82 }, // rebolos / mós
  '6805': { ...T.abrasivosLixa, confidence: 84 }, // abrasivos sobre suporte
  '6806': { ...T.abrasivosLixa, confidence: 70 },
  '8202': { ...T.ferramentasCorte, confidence: 78 }, // serras
  '8203': { ...T.ferramentasManuais, confidence: 76 }, // limas/alicates
  '8204': { ...T.ferramentasManuais, confidence: 78 }, // chaves de aperto
  '8205': { ...T.ferramentasManuais, confidence: 74 }, // ferramentas manuais diversas
  '8207': { ...T.ferramentasCorte, confidence: 80 }, // ferramentas intercambiáveis (fresas/brocas)
  '8208': { ...T.ferramentasCorte, confidence: 78 }, // facas/lâminas para máquinas
  '7318': { ...T.fixadores, confidence: 78 }, // parafusos, porcas, arruelas
};

/** Strips everything but digits from a raw NCM string. */
function normNcm(ncm: string): string {
  return (ncm || '').replace(/\D/g, '');
}

/**
 * Resolves a raw NCM to its target subcategory, longest-prefix-first:
 * exact 8-digit → 6-digit heading → 4-digit chapter. Returns null when no
 * table entry covers the code (the classifier then falls through to the
 * supplier prior / fuzzy / keyword tiers).
 */
export function lookupNcm(ncm: string | null | undefined): NcmTarget | null {
  if (!ncm) return null;
  const d = normNcm(ncm);
  if (d.length < 4) return null;
  const k8 = d.slice(0, 8);
  if (k8.length === 8 && NCM_EXACT[k8]) return NCM_EXACT[k8];
  const k6 = d.slice(0, 6);
  if (NCM_6[k6]) return NCM_6[k6];
  const k4 = d.slice(0, 4);
  if (NCM_4[k4]) return NCM_4[k4];
  return null;
}

/** Total distinct NCM keys in the table (for coverage logging). */
export function ncmTableSize(): { exact: number; heading6: number; chapter4: number } {
  return {
    exact: Object.keys(NCM_EXACT).length,
    heading6: Object.keys(NCM_6).length,
    chapter4: Object.keys(NCM_4).length,
  };
}
