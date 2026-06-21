import { Injectable, Logger } from '@nestjs/common';
import { ItemCategoryAliasSource, Prisma, ReconciliationSource } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TransactionCategoryService } from './transaction-category.service';
import { ItemCategoryAliasService } from './item-category-alias.service';
import {
  itemDescriptionTokens,
  codeCandidateTokens,
  descriptionFingerprint,
  stripAccents,
  COLOR_TOKENS,
} from './text-normalization';
import {
  PRODUCT_KEYWORD_RULES,
  SERVICE_KEYWORD_RULES,
  EMITTER_PRIORS,
} from './category-keywords';
import { lookupNcm, NcmTarget } from './ncm-category-map';

const LEXICON_TTL_MS = 5 * 60_000;
// Minimum confidence for a derived tag to be persisted at all. Below this the
// signal is too noisy to be useful even as a suggestion. Raised 45→55: the
// 45-54 band was dominated by weak single-signal coincidences (e.g. a lone
// generic token like "auto" routing motor oil → Verniz). A real match (NCM,
// learned alias, keyword, multi-token fuzzy) comfortably clears 55.
const MIN_CONFIDENCE = 55;
// Tags at/above this are "confident"; the UI surfaces anything below for review.
export const REVIEW_CONFIDENCE_THRESHOLD = 75;

interface LexItem {
  nameTokens: Set<string>;
  brandTokens: Set<string>;
  itemCategoryId: string;
}

interface Lexicon {
  // every categorized inventory item, used for fuzzy name+brand matching
  items: LexItem[];
  // normalized Item.uniCode → indices into items (a code can map to >1 item)
  uniCode: Map<string, number[]>;
  // name token → item indices (inverted index for candidate gathering)
  tokenIndex: Map<string, number[]>;
  // token → number of items containing it (document frequency, for IDF)
  df: Map<string, number>;
  // token → (itemCategoryId → weight) — the demoted token-vote lexicon
  tokens: Map<string, Map<string, number>>;
  // learned descriptionFingerprint → { TransactionCategory id, confidence }
  aliasMap: Map<string, { categoryId: string; confidence: number }>;
}

// Minimum name-token overlap for a fuzzy item match to count.
const FUZZY_MIN_OVERLAP = 0.6;

interface LineResult {
  itemId: string;
  // resolved TransactionCategory id (item-derived or service), or null
  categoryId: string | null;
  confidence: number;
  lineValue: number;
}

/**
 * The "extremely intelligent fuzzy" item categorizer. Runs AFTER a transaction
 * is matched to one or more FiscalDocuments and maps each NF line item to a
 * TransactionCategory, then aggregates the lines into multi-category tags on the
 * transaction with proportional amount allocation.
 *
 * Identify the real inventory Item FIRST, then take its category — generic
 * heuristics only fill the gaps. Layered, highest-confidence-first:
 *   1.  uniCode hit — from the `code` field OR a uniCode embedded in the
 *       description text; brand-disambiguated across categories (100).
 *   1b. Learned alias (human corrections + AUTO_CODE self-training).
 *   2.  NCM → mirrored subcategory leaf — near-deterministic fiscal code
 *       (85-96 for 8-digit; lower for chapter/heading prefixes).
 *   3.  Supplier-root prior — constrains toward the emitter's category family.
 *   4.  Fuzzy item match — name-token overlap vs the real Item corpus (70-94).
 *   5.  Curated product/service keyword overrides (capped 70).
 *   6.  Token-vote lexicon (capped 70).
 *   7.  Emitter-name prior floor (capped 60).
 *
 * The invariant: no keyword/lexicon/emitter heuristic may outrank a real-item
 * match — that inversion is what fixes same-name-different-category items
 * (e.g. "Massa Poliester" Lazzuril=Ferramenta vs Farben=Tinta).
 *
 * Item-derived tags are enrichment only — they never resolve a transaction (an
 * NF match is still required). MANUAL tags are never overwritten.
 */
@Injectable()
export class ItemCategoryClassifierService {
  private readonly logger = new Logger(ItemCategoryClassifierService.name);
  private lexicon: Lexicon | null = null;
  private lexiconLoadedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: TransactionCategoryService,
    private readonly aliasService: ItemCategoryAliasService,
  ) {}

  invalidateLexicon(): void {
    this.lexicon = null;
    this.lexiconLoadedAt = 0;
  }

  /**
   * Learns a (description → category) mapping from a human correction. Only
   * attributes when unambiguous: exactly one item-derived category was chosen
   * AND the matched NF(s) have exactly one line item — so the line that the
   * category refers to is unambiguous. The common single-line NF (286 of 351 in
   * this data) is covered; multi-line corrections are skipped (can't safely tell
   * which line the category belongs to). Best-effort.
   */
  async learnFromManual(
    transactionId: string,
    chosen: Array<{ id: string; kind: string }>,
  ): Promise<void> {
    try {
      const itemDerived = chosen.filter(c => c.kind === 'ITEM_DERIVED' || c.kind === 'SERVICE');
      if (itemDerived.length !== 1) return;
      const tx = await this.prisma.bankTransaction.findUnique({
        where: { id: transactionId },
        select: {
          matches: {
            where: { reversedAt: null, fiscalDocumentId: { not: null } },
            select: { fiscalDocumentId: true },
          },
        },
      });
      const docIds = (tx?.matches ?? []).map(m => m.fiscalDocumentId!).filter(Boolean);
      if (docIds.length === 0) return;
      const items = await this.prisma.fiscalDocumentItem.findMany({
        where: { fiscalDocumentId: { in: docIds } },
        select: { description: true },
      });
      if (items.length !== 1) return;
      await this.aliasService.record({
        description: items[0].description,
        categoryId: itemDerived[0].id,
        source: ItemCategoryAliasSource.MANUAL,
      });
      this.invalidateLexicon();
    } catch (err) {
      this.logger.warn(`learnFromManual failed for ${transactionId}: ${err}`);
    }
  }

  /**
   * Records a manual NF-line → category mapping as a learning signal. Unlike
   * learnFromManual (which infers the line from a transaction's single matched
   * NF), this is called when the user categorizes a specific item directly — the
   * description→category mapping is unambiguous, so it's the cleanest signal.
   */
  async recordItemAlias(description: string, categoryId: string): Promise<void> {
    try {
      await this.aliasService.record({
        description,
        categoryId,
        source: ItemCategoryAliasSource.MANUAL,
      });
      this.invalidateLexicon();
    } catch (err) {
      this.logger.warn(`recordItemAlias failed: ${err}`);
    }
  }

  private async buildLexicon(force = false): Promise<Lexicon> {
    const now = Date.now();
    if (!force && this.lexicon && now - this.lexiconLoadedAt < LEXICON_TTL_MS) {
      return this.lexicon;
    }
    const items = await this.prisma.item.findMany({
      where: { categoryId: { not: null } },
      select: {
        name: true,
        uniCode: true,
        categoryId: true,
        brands: { select: { name: true } },
      },
    });
    const lex: Lexicon = {
      items: [],
      uniCode: new Map(),
      tokenIndex: new Map(),
      df: new Map(),
      tokens: new Map(),
      aliasMap: await this.aliasService.buildResolvedMap(),
    };
    for (const it of items) {
      const catId = it.categoryId!;
      const nameTokens = new Set(itemDescriptionTokens(it.name));
      // Multi-brand: tokenize every brand name the item carries.
      const brandTokens = new Set(
        (it.brands ?? []).flatMap(b => itemDescriptionTokens(b.name)),
      );
      const idx = lex.items.push({ nameTokens, brandTokens, itemCategoryId: catId }) - 1;
      if (it.uniCode) {
        const c = normCode(it.uniCode);
        if (c) {
          const arr = lex.uniCode.get(c) ?? [];
          arr.push(idx);
          lex.uniCode.set(c, arr);
        }
      }
      for (const tok of nameTokens) {
        const arr = lex.tokenIndex.get(tok) ?? [];
        arr.push(idx);
        lex.tokenIndex.set(tok, arr);
        lex.df.set(tok, (lex.df.get(tok) ?? 0) + 1);
        let m = lex.tokens.get(tok);
        if (!m) {
          m = new Map();
          lex.tokens.set(tok, m);
        }
        m.set(catId, (m.get(catId) ?? 0) + 1);
      }
    }
    this.lexicon = lex;
    this.lexiconLoadedAt = now;
    return lex;
  }

  // Resolves a set of candidate item indices to ONE itemCategoryId. Returns the
  // shared category when unambiguous; otherwise applies a brand tiebreak (keep
  // only items whose brand token appears in the description). Null if still
  // ambiguous.
  private pickItemCategory(idxs: number[], lex: Lexicon, descTokens: Set<string>): string | null {
    const cats = new Set(idxs.map(i => lex.items[i].itemCategoryId));
    if (cats.size === 1) return [...cats][0];
    const branded = idxs.filter(i => {
      for (const b of lex.items[i].brandTokens) if (descTokens.has(b)) return true;
      return false;
    });
    const brandedCats = new Set(branded.map(i => lex.items[i].itemCategoryId));
    if (brandedCats.size === 1) return [...brandedCats][0];
    return null;
  }

  /**
   * Resolves a mirror-leaf TransactionCategory from an ordered list of candidate
   * names then candidate slugs — returns the first that exists. This insulates
   * the NCM table / keyword rules from the new-vs-old taxonomy: a rule can target
   * the verbose new leaf name AND still fall back to the legacy flat name/slug.
   */
  private async resolveLeaf(
    names?: string[],
    slugs?: string[],
  ): Promise<string | undefined> {
    for (const nm of names ?? []) {
      const cat = await this.categories.resolveByName(nm);
      if (cat) return cat.id;
    }
    for (const sl of slugs ?? []) {
      // ITEM_DERIVED mirror rows carry an `item-`-prefixed slug (see
      // mirrorSlug() in TransactionCategoryService). The NCM/keyword tables list
      // the bare operational slug (e.g. `diluentes-e-thinners`), so try the
      // mirror-prefixed form FIRST, then the bare slug (legacy/seeded rows).
      const cat =
        (await this.categories.resolveBySlug(`item-${sl}`)) ??
        (await this.categories.resolveBySlug(sl));
      if (cat) return cat.id;
    }
    return undefined;
  }

  /**
   * Classifies a single NF line. Returns the best TransactionCategory id and a
   * 0-100 confidence, or null below threshold. Pure given the lexicon + the
   * category cache, so it is unit-testable.
   *
   * Precedence (highest trust first):
   *   1.  uniCode / code exact item → its category (100).
   *   1b. Learned alias (human corrections + AUTO_CODE self-training).
   *   2.  NCM → mirrored subcategory leaf — deterministic for this supplier mix
   *       (85-96 for 8-digit codes, lower for chapter/heading prefixes).
   *   3.  Supplier-root prior — constrains the result toward the emitter's
   *       category family BEFORE the noisier fuzzy/keyword tiers.
   *   4.  Fuzzy item-name match against the real Item corpus (70-94).
   *   5.  Curated product/service keyword overrides (capped 70).
   *   6.  Token-vote lexicon (capped 70).
   *   7.  Emitter prior again as a last-resort floor (capped 60).
   *
   * No keyword/lexicon/emitter heuristic may outrank a real-item or NCM match.
   */
  private async classifyLine(
    code: string | null,
    description: string,
    emitName: string | null,
    lex: Lexicon,
    docType?: string | null,
    ncm?: string | null,
  ): Promise<{ categoryId: string; confidence: number } | null> {
    const raw = stripAccents(description || '').toLowerCase();
    const descTokens = new Set(itemDescriptionTokens(description));
    // NFSe carries SERVICES, not inventory items — never assign an item-derived
    // category from product-matching heuristics; only service keywords / emitter
    // service priors (and learned aliases) apply.
    const isService = docType === 'NFSE';

    let best: { categoryId: string; confidence: number } | null = null;
    const consider = (categoryId: string | undefined, confidence: number) => {
      if (!categoryId) return;
      if (!best || confidence > best.confidence) best = { categoryId, confidence };
    };

    // 1. uniCode — from the `code` field AND any uniCode embedded in the
    //    description text (letter+digit tokens). Highest trust.
    const codeKeys = new Set<string>();
    if (code) {
      const c = normCode(code);
      if (c) codeKeys.add(c);
    }
    for (const t of codeCandidateTokens(description)) codeKeys.add(t);
    const uniIdxs: number[] = [];
    for (const k of codeKeys) {
      const arr = lex.uniCode.get(k);
      if (arr) uniIdxs.push(...arr);
    }
    if (uniIdxs.length) {
      const itemCatId = this.pickItemCategory(uniIdxs, lex, descTokens);
      if (itemCatId) {
        const cat = await this.categories.resolveByItemCategoryId(itemCatId);
        if (cat) return { categoryId: cat.id, confidence: 100 };
      }
    }

    // 1b. Learned alias — past categorizations (human corrections + deterministic
    //     uniCode hits) recorded for this description fingerprint. Lets the system
    //     improve over time; a human-confirmed mapping outranks fuzzy/keyword.
    const fp = descriptionFingerprint(description);
    if (fp) {
      const learned = lex.aliasMap.get(fp);
      if (learned) consider(learned.categoryId, learned.confidence);
    }

    // 2. NCM → mirrored subcategory leaf. Near-deterministic for this supplier
    //    mix (NCM is a federally-coded fiscal classification on every NFe line),
    //    so it outranks fuzzy/keyword/emitter heuristics. Only applies to
    //    product docs — NFSe service lines carry an ItemListaServico, not an NCM.
    if (!isService) {
      const target: NcmTarget | null = lookupNcm(ncm);
      if (target) {
        const leafId = await this.resolveLeaf(target.names, target.slugs);
        if (leafId) {
          // A deterministic 8-digit NCM is as trustworthy as a uniCode hit, so it
          // short-circuits the heuristics below — but it must NOT override an
          // already-stronger signal (a learned MANUAL alias can score 96-97).
          if (target.confidence >= 95 && target.confidence > (best?.confidence ?? 0)) {
            return { categoryId: leafId, confidence: target.confidence };
          }
          consider(leafId, target.confidence);
        }
      }
    }

    // 3. Supplier-root prior — constrain toward the emitter's category family
    //    BEFORE the noisier fuzzy/keyword tiers. Capped so a real-item match
    //    (step 4) can still win, but it biases thin lines correctly.
    if ((!best || best.confidence < 60) && emitName) {
      const emitRoot = stripAccents(emitName).toLowerCase();
      for (const prior of EMITTER_PRIORS) {
        if (!prior.pattern.test(emitRoot)) continue;
        if (!isService) {
          for (const nm of prior.itemCategoryNames ?? []) {
            const cat = await this.categories.resolveByName(nm);
            if (cat) {
              consider(cat.id, Math.min(58, prior.confidence));
              break; // first resolvable name in the family is enough
            }
          }
        }
        if (prior.serviceSlug) {
          const cat = await this.categories.resolveBySlug(prior.serviceSlug);
          consider(cat?.id, Math.min(58, prior.confidence));
        }
      }
    }

    // 4. Fuzzy item match against the real Item corpus. We pick the single best
    //    item by IDF-weighted matched-token score: rare, discriminative tokens
    //    (e.g. "interface", present in one item) outweigh common ones ("disco",
    //    "hookit"), which is what separates same-prefix items across categories
    //    ("Disco de Interface"=Abrasivos vs "Disco Hookit"=Ferramenta). Requires
    //    ≥60% of the catalog item's name to be covered so partial noise doesn't
    //    win. Ties break by brand-token presence, then by name specificity.
    if (descTokens.size && !isService) {
      const N = lex.items.length || 1;
      const idf = (t: string) => Math.log((N + 1) / ((lex.df.get(t) ?? 0) + 1)) + 1;
      const candidateIdxs = new Set<number>();
      for (const t of descTokens) {
        const arr = lex.tokenIndex.get(t);
        if (arr) for (const i of arr) candidateIdxs.add(i);
      }
      let bestIdx = -1;
      let bestW = 0;
      let bestBranded = false;
      for (const i of candidateIdxs) {
        const it = lex.items[i];
        let inter = 0;
        let w = 0;
        let nonColorMatched = 0;
        for (const t of it.nameTokens) {
          if (descTokens.has(t)) {
            inter += 1;
            w += idf(t);
            if (!COLOR_TOKENS.has(t)) nonColorMatched += 1;
          }
        }
        if (!inter) continue;
        // A match made entirely of colour words ("Azul", "Vermelho Vivo") is not
        // real evidence — it would hijack any line that merely mentions a colour
        // (real paint "CONC.VERMELHO VIVO", vehicle-painting services, "luva
        // preta"…). Require at least one non-colour matched token. Genuine
        // pigment purchases still resolve via the "pigmento|corante" keyword.
        if (nonColorMatched === 0) continue;
        const coverage = inter / it.nameTokens.size;
        if (coverage < FUZZY_MIN_OVERLAP) continue;
        const branded = [...it.brandTokens].some(b => descTokens.has(b));
        const better =
          bestIdx < 0 ||
          w > bestW + 1e-9 ||
          (Math.abs(w - bestW) <= 1e-9 &&
            ((branded && !bestBranded) ||
              (branded === bestBranded && it.nameTokens.size > lex.items[bestIdx].nameTokens.size)));
        if (better) {
          bestIdx = i;
          bestW = w;
          bestBranded = branded;
        }
      }
      if (bestIdx >= 0) {
        const cat = await this.categories.resolveByItemCategoryId(lex.items[bestIdx].itemCategoryId);
        // A single-token item match (e.g. a generic word like "Disco"/"Cabo") is
        // weak evidence — cap it BELOW the keyword tier (70) so a curated keyword
        // or a multi-token real match wins. Multi-token matches scale up to 94.
        const singleToken = lex.items[bestIdx].nameTokens.size === 1;
        const conf = singleToken
          ? Math.min(65, Math.round(45 + 20 * Math.min(1, bestW / 4)))
          : Math.min(94, Math.round(60 + 34 * Math.min(1, bestW / 4)));
        if (cat) consider(cat.id, conf);
      }
    }

    // 5. Curated keyword overrides — DEMOTED (capped 70) so they never beat a
    //    real-item/NCM match; only consulted when nothing strong matched. Product
    //    keywords are skipped for NFSe (service docs have no inventory items).
    //    Prefer the new mirror-leaf name (itemCategoryNames) when it resolves,
    //    falling back to the legacy flat name.
    if (!best || best.confidence < 70) {
      if (!isService) {
        for (const rule of PRODUCT_KEYWORD_RULES) {
          if (!rule.pattern.test(raw)) continue;
          const leafId =
            (await this.resolveLeaf(rule.itemCategoryNames)) ??
            (rule.itemCategoryName
              ? (await this.categories.resolveByName(rule.itemCategoryName))?.id
              : undefined);
          consider(leafId, Math.min(70, rule.confidence));
        }
      }
      for (const rule of SERVICE_KEYWORD_RULES) {
        if (rule.pattern.test(raw) && rule.serviceSlug) {
          const cat = await this.categories.resolveBySlug(rule.serviceSlug);
          consider(cat?.id, Math.min(70, rule.confidence));
        }
      }
    }

    // 6. Token-vote lexicon (capped 70). Item-derived only → skip for NFSe.
    if ((!best || best.confidence < 70) && !isService) {
      const lexHit = await this.scoreFromLexicon(description, lex);
      if (lexHit) consider(lexHit.categoryId, Math.min(70, lexHit.confidence));
    }

    // 7. Emitter prior (capped 60).
    if (!best || best.confidence < REVIEW_CONFIDENCE_THRESHOLD) {
      const emit = stripAccents(emitName || '').toLowerCase();
      for (const prior of EMITTER_PRIORS) {
        if (!prior.pattern.test(emit)) continue;
        if (prior.serviceSlug) {
          const cat = await this.categories.resolveBySlug(prior.serviceSlug);
          consider(cat?.id, Math.min(60, prior.confidence));
        }
        for (const nm of prior.itemCategoryNames ?? []) {
          const cat = await this.categories.resolveByName(nm);
          consider(cat?.id, Math.min(60, prior.confidence));
        }
      }
    }

    if (best && best.confidence >= MIN_CONFIDENCE) return best;
    return null;
  }

  private async scoreFromLexicon(
    description: string,
    lex: Lexicon,
  ): Promise<{ categoryId: string; confidence: number } | null> {
    const tokens = itemDescriptionTokens(description);
    if (tokens.length === 0) return null;
    const catScores = new Map<string, number>();
    let matched = 0;
    let total = 0;
    for (const tok of tokens) {
      const m = lex.tokens.get(tok);
      if (!m) continue;
      matched += 1;
      for (const [catId, w] of m) {
        catScores.set(catId, (catScores.get(catId) ?? 0) + w);
        total += w;
      }
    }
    if (matched === 0 || total === 0) return null;
    let bestCat: string | null = null;
    let bestScore = 0;
    for (const [catId, s] of catScores) {
      if (s > bestScore) {
        bestScore = s;
        bestCat = catId;
      }
    }
    if (!bestCat) return null;
    const purity = bestScore / total;
    const coverage = matched / tokens.length;
    const itemCat = await this.categories.resolveByItemCategoryId(bestCat);
    if (!itemCat) return null;
    const confidence = Math.round(100 * purity * (0.55 + 0.45 * coverage));
    // A single shared token is non-discriminative coincidence: a generic word
    // ("auto", "kit", "linha") that happens to appear only in one category's
    // items produces purity 1.0 and a deceptively high score (this is exactly
    // how "LUBRAX TOP AUTO 0W20" → Verniz at 66). The lexicon is the LAST,
    // demoted fallback — require ≥2 matched tokens for full weight and halve a
    // lone-token vote so it falls below MIN_CONFIDENCE and is discarded.
    const adjusted = matched < 2 ? Math.round(confidence * 0.5) : confidence;
    return { categoryId: itemCat.id, confidence: Math.min(94, adjusted) };
  }

  /**
   * Derives item categories for a matched transaction and persists them. Loads
   * the line items of every fiscal document currently matched (non-reversed),
   * classifies each line, aggregates per category, allocates the transaction
   * amount proportionally to each category's line-value share, and replaces the
   * transaction's AUTO category tags (MANUAL tags are preserved).
   *
   * Best-effort: never throws into the caller's match flow.
   */
  async deriveForTransaction(
    transactionId: string,
    prismaTx?: Prisma.TransactionClient,
  ): Promise<number> {
    try {
      const db = prismaTx ?? this.prisma;
      const tx = await db.bankTransaction.findUnique({
        where: { id: transactionId },
        select: {
          amount: true,
          matches: {
            where: { reversedAt: null, fiscalDocumentId: { not: null } },
            select: { fiscalDocumentId: true },
          },
          categories: {
            where: { source: ReconciliationSource.MANUAL },
            select: { id: true },
          },
        },
      });
      if (!tx || tx.matches.length === 0) return 0;
      // Respect human decisions: if the user has manually categorized this
      // transaction, never re-derive — otherwise a rejected auto guess would
      // reappear alongside the manual one on the next "Verificar".
      if (tx.categories.length > 0) return 0;
      const txAmount = Math.abs(Number(tx.amount));
      const docIds = tx.matches.map(m => m.fiscalDocumentId!).filter(Boolean);

      const docs = await db.fiscalDocument.findMany({
        where: { id: { in: docIds } },
        select: {
          emitName: true,
          docType: true,
          items: {
            select: { id: true, code: true, description: true, totalValue: true, ncm: true },
          },
        },
      });

      const lex = await this.buildLexicon();
      const lineResults: LineResult[] = [];
      for (const doc of docs) {
        for (const item of doc.items) {
          const hit = await this.classifyLine(item.code, item.description, doc.emitName, lex, doc.docType, item.ncm);
          // Learn from deterministic uniCode hits (confidence 100): the same
          // product's description will then resolve later even without the code.
          if (hit && hit.confidence === 100) {
            await this.aliasService.record({
              description: item.description,
              categoryId: hit.categoryId,
              source: ItemCategoryAliasSource.AUTO_CODE,
            });
          }
          lineResults.push({
            itemId: item.id,
            categoryId: hit?.categoryId ?? null,
            confidence: hit?.confidence ?? 0,
            lineValue: Number(item.totalValue),
          });
        }
      }

      // Aggregate per category: sum line values, take max confidence, remember a
      // representative source line.
      const totalLineValue = lineResults.reduce((a, l) => a + l.lineValue, 0) || txAmount;
      const perCat = new Map<
        string,
        { value: number; confidence: number; derivedFromFiscalItemId: string }
      >();
      for (const l of lineResults) {
        if (!l.categoryId) continue;
        const cur = perCat.get(l.categoryId);
        if (!cur) {
          perCat.set(l.categoryId, {
            value: l.lineValue,
            confidence: l.confidence,
            derivedFromFiscalItemId: l.itemId,
          });
        } else {
          cur.value += l.lineValue;
          if (l.confidence > cur.confidence) {
            cur.confidence = l.confidence;
            cur.derivedFromFiscalItemId = l.itemId;
          }
        }
      }

      await this.persist(transactionId, txAmount, totalLineValue, lineResults, perCat, prismaTx);
      return perCat.size;
    } catch (err) {
      this.logger.warn(`Item categorization failed for ${transactionId}: ${err}`);
      return 0;
    }
  }

  /**
   * Re-runs line classification over EVERY FiscalDocumentItem (not just matched
   * transactions) and refreshes the cached per-line category on each item:
   * `categoryId` / `categoryConfidence` / `categorySource = AUTO`.
   *
   * MANUAL per-item categorizations are preserved (never stomped). This powers
   * the reprocess script after the NCM map / keyword rules change — it does NOT
   * touch BankTransaction tags (those are re-derived by deriveForTransaction on
   * the next "Verificar"). Returns coverage stats for before/after logging.
   */
  async reclassifyAllItems(
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ total: number; before: number; after: number; updated: number; skippedManual: number }> {
    const lex = await this.buildLexicon(true);
    const docs = await this.prisma.fiscalDocument.findMany({
      select: {
        emitName: true,
        docType: true,
        items: {
          select: { id: true, code: true, description: true, ncm: true, categoryId: true, categorySource: true },
        },
      },
    });

    let total = 0;
    let before = 0;
    let after = 0;
    let updated = 0;
    let skippedManual = 0;
    let done = 0;

    for (const doc of docs) {
      for (const item of doc.items) {
        total += 1;
        if (item.categoryId) before += 1;
        // Never overwrite a human decision.
        if (item.categorySource === ReconciliationSource.MANUAL) {
          if (item.categoryId) after += 1;
          skippedManual += 1;
          continue;
        }
        const hit = await this.classifyLine(
          item.code,
          item.description,
          doc.emitName,
          lex,
          doc.docType,
          item.ncm,
        );
        const newCategoryId = hit?.categoryId ?? null;
        if (newCategoryId) after += 1;
        if (newCategoryId !== item.categoryId) {
          await this.prisma.fiscalDocumentItem.update({
            where: { id: item.id },
            data: {
              categoryId: newCategoryId,
              categoryConfidence: newCategoryId ? hit!.confidence : null,
              categorySource: newCategoryId ? ReconciliationSource.AUTO : null,
            },
          });
          updated += 1;
        }
        // Self-train on deterministic hits, mirroring deriveForTransaction.
        if (hit && hit.confidence === 100) {
          await this.aliasService.record({
            description: item.description,
            categoryId: hit.categoryId,
            source: ItemCategoryAliasSource.AUTO_CODE,
          });
        }
        done += 1;
        if (onProgress && done % 100 === 0) onProgress(done, total);
      }
    }
    if (onProgress) onProgress(done, total);
    return { total, before, after, updated, skippedManual };
  }

  private async persist(
    transactionId: string,
    txAmount: number,
    totalLineValue: number,
    lineResults: LineResult[],
    perCat: Map<string, { value: number; confidence: number; derivedFromFiscalItemId: string }>,
    prismaTx?: Prisma.TransactionClient,
  ): Promise<void> {
    const run = async (db: Prisma.TransactionClient) => {
      // Respect manual per-item categorizations: a user who picked a category on
      // an NF line (categorySource = MANUAL) must not have it stomped by the
      // auto-classifier on the next "Verificar".
      const manualItems = await db.fiscalDocumentItem.findMany({
        where: {
          id: { in: lineResults.map(l => l.itemId) },
          categorySource: ReconciliationSource.MANUAL,
        },
        select: { id: true },
      });
      const manualItemIds = new Set(manualItems.map(i => i.id));
      // Cache the per-line derived category on the fiscal items (for the NF detail).
      for (const l of lineResults) {
        if (manualItemIds.has(l.itemId)) continue; // keep the human's choice
        await db.fiscalDocumentItem.update({
          where: { id: l.itemId },
          data: {
            categoryId: l.categoryId,
            categoryConfidence: l.categoryId ? l.confidence : null,
            categorySource: l.categoryId ? ReconciliationSource.AUTO : null,
          },
        });
      }
      // Replace AUTO tags; keep MANUAL ones untouched.
      await db.bankTransactionCategory.deleteMany({
        where: { transactionId, source: ReconciliationSource.AUTO },
      });
      const manual = await db.bankTransactionCategory.findMany({
        where: { transactionId, source: ReconciliationSource.MANUAL },
        select: { categoryId: true },
      });
      const manualIds = new Set(manual.map(m => m.categoryId));
      for (const [categoryId, agg] of perCat) {
        if (manualIds.has(categoryId)) continue; // don't duplicate a manual tag
        const allocatedAmount =
          totalLineValue > 0
            ? Number(((agg.value / totalLineValue) * txAmount).toFixed(2))
            : null;
        await db.bankTransactionCategory.create({
          data: {
            transactionId,
            categoryId,
            source: ReconciliationSource.AUTO,
            confidence: agg.confidence,
            allocatedAmount,
            derivedFromFiscalItemId: agg.derivedFromFiscalItemId,
          },
        });
      }
    };
    if (prismaTx) await run(prismaTx);
    else await this.prisma.$transaction(run);
  }
}

function normCode(code: string): string {
  return code.replace(/[^a-z0-9]/gi, '').toLowerCase();
}
