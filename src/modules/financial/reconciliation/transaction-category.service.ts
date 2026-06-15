import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TransactionCategory,
  TransactionCategoryKind,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { stripAccents } from './text-normalization';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/transaction-category.dto';

const CACHE_TTL_MS = 60_000;

export interface CategorySnapshot {
  all: TransactionCategory[];
  bySlug: Map<string, TransactionCategory>;
  byId: Map<string, TransactionCategory>;
  // item-derived categories keyed by their source ItemCategory id
  byItemCategoryId: Map<string, TransactionCategory>;
  // any category keyed by lowercased, accent-stripped name (for keyword resolution)
  byNameKey: Map<string, TransactionCategory>;
}

/**
 * Owns the unified reconciliation taxonomy (TransactionCategory). The classifier
 * and the item-category fuzzy engine resolve slugs/ItemCategory ids → category
 * rows through the cached snapshot here, so neither has to re-query per
 * transaction. CRUD mutations invalidate the cache.
 */
@Injectable()
export class TransactionCategoryService {
  private readonly logger = new Logger(TransactionCategoryService.name);
  private cache: CategorySnapshot | null = null;
  private cacheLoadedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  // ----- cache -------------------------------------------------------------

  invalidate(): void {
    this.cache = null;
    this.cacheLoadedAt = 0;
  }

  async snapshot(force = false): Promise<CategorySnapshot> {
    const now = Date.now();
    if (!force && this.cache && now - this.cacheLoadedAt < CACHE_TTL_MS) {
      return this.cache;
    }
    const all = await this.prisma.transactionCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const snap: CategorySnapshot = {
      all,
      bySlug: new Map(),
      byId: new Map(),
      byItemCategoryId: new Map(),
      byNameKey: new Map(),
    };
    for (const c of all) {
      // byId keeps every category (for display/validation of existing tags).
      snap.byId.set(c.id, c);
      // The assignment resolvers (slug/name/itemCategory) must only return
      // ACTIVE categories — archiving a category stops it being auto-assigned to
      // new transactions, not just hidden from the list.
      if (!c.isActive) continue;
      snap.bySlug.set(c.slug, c);
      if (c.itemCategoryId) snap.byItemCategoryId.set(c.itemCategoryId, c);
      snap.byNameKey.set(nameKey(c.name), c);
    }
    this.cache = snap;
    this.cacheLoadedAt = now;
    return snap;
  }

  async resolveBySlug(slug: string): Promise<TransactionCategory | undefined> {
    return (await this.snapshot()).bySlug.get(slug);
  }

  async resolveByItemCategoryId(
    itemCategoryId: string,
  ): Promise<TransactionCategory | undefined> {
    return (await this.snapshot()).byItemCategoryId.get(itemCategoryId);
  }

  async resolveByName(name: string): Promise<TransactionCategory | undefined> {
    return (await this.snapshot()).byNameKey.get(nameKey(name));
  }

  // ----- CRUD --------------------------------------------------------------

  async list(filter?: {
    kind?: TransactionCategoryKind;
    isRecurring?: boolean;
    includeInactive?: boolean;
  }): Promise<TransactionCategory[]> {
    const where: Prisma.TransactionCategoryWhereInput = {};
    if (filter?.kind) where.kind = filter.kind;
    if (filter?.isRecurring !== undefined) where.isRecurring = filter.isRecurring;
    if (!filter?.includeInactive) where.isActive = true;
    return this.prisma.transactionCategory.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(input: CreateCategoryDto): Promise<TransactionCategory> {
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('Nome da categoria é obrigatório');
    const kind = input.kind;
    const slug = await this.uniqueSlug(name);
    const created = await this.prisma.transactionCategory.create({
      data: {
        name,
        slug,
        kind,
        // Transaction-only categories resolve on assign by default; service
        // categories are NF-derived enrichment only.
        isResolving:
          input.isResolving ?? kind === TransactionCategoryKind.TRANSACTION_ONLY,
        isRecurring: input.isRecurring ?? false,
        color: input.color ?? null,
        sortOrder: input.sortOrder ?? 0,
        accountingType: input.accountingType ?? null,
      },
    });
    this.invalidate();
    return created;
  }

  async update(id: string, input: UpdateCategoryDto): Promise<TransactionCategory> {
    const existing = await this.prisma.transactionCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Categoria não encontrada');
    const data: Prisma.TransactionCategoryUpdateInput = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Nome da categoria é obrigatório');
      data.name = name;
      // Slug is an immutable internal key — renaming only changes the display
      // name. (Previously a rename re-slugged the row, which silently broke the
      // classifier's hardcoded slug rules, e.g. "aluguel" → "aluguel-2".)
    }
    if (input.isResolving !== undefined) data.isResolving = input.isResolving;
    if (input.isRecurring !== undefined) data.isRecurring = input.isRecurring;
    if (input.color !== undefined) data.color = input.color;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.accountingType !== undefined) data.accountingType = input.accountingType;
    const updated = await this.prisma.transactionCategory.update({ where: { id }, data });
    this.invalidate();
    return updated;
  }

  /**
   * Soft-deletes (archives) a category. Hard delete is refused when the category
   * is still referenced by transaction tags, so we archive instead to preserve
   * historical reconciliation records.
   */
  async remove(id: string): Promise<TransactionCategory> {
    const existing = await this.prisma.transactionCategory.findUnique({
      where: { id },
      include: { _count: { select: { transactionTags: true, fiscalDocumentItems: true } } },
    });
    if (!existing) throw new NotFoundException('Categoria não encontrada');
    if (existing.itemCategoryId) {
      throw new BadRequestException(
        'Categorias derivadas de item são gerenciadas pelo cadastro de categorias de estoque',
      );
    }
    const referenced =
      existing._count.transactionTags > 0 || existing._count.fiscalDocumentItems > 0;
    const result = referenced
      ? await this.prisma.transactionCategory.update({
          where: { id },
          data: { isActive: false },
        })
      : await this.prisma.transactionCategory.delete({ where: { id } });
    this.invalidate();
    return result;
  }

  // ----- ITEM_DERIVED mirror sync -----------------------------------------

  /**
   * Upserts the single ITEM_DERIVED TransactionCategory that mirrors the given
   * ItemCategory (matched by itemCategoryId), copying name, accountingType and a
   * fixed `item-<slug>` slug, and reactivating it if it was previously archived.
   * Idempotent: re-running with unchanged source data is a no-op write.
   *
   * Returns 'created' | 'updated' | 'noop' describing what happened.
   */
  async syncMirrorFromItemCategory(
    itemCategoryId: string,
  ): Promise<'created' | 'updated' | 'noop'> {
    const source = await this.prisma.itemCategory.findUnique({
      where: { id: itemCategoryId },
      select: { id: true, name: true, accountingType: true },
    });
    if (!source) {
      // Source was deleted between event emission and handling — deactivate.
      const deactivated = await this.deactivateMirror(itemCategoryId);
      return deactivated ? 'updated' : 'noop';
    }

    const name = source.name.trim();
    const slug = mirrorSlug(name);
    const existing = await this.prisma.transactionCategory.findFirst({
      where: { itemCategoryId, kind: TransactionCategoryKind.ITEM_DERIVED },
    });

    if (!existing) {
      // The mirror slug/name must be unique across the whole taxonomy. Disambiguate
      // against any non-mirror row holding the same slug/name.
      const uniqueSlug = await this.uniqueSlug(slug);
      const uniqueName = await this.uniqueMirrorName(name);
      await this.prisma.transactionCategory.create({
        data: {
          name: uniqueName,
          slug: uniqueSlug,
          kind: TransactionCategoryKind.ITEM_DERIVED,
          itemCategoryId,
          accountingType: source.accountingType ?? null,
          // Item-derived rows are NF-enrichment only — they never self-resolve.
          isResolving: false,
          isRecurring: false,
          sortOrder: 0,
          isActive: true,
        },
      });
      this.invalidate();
      return 'created';
    }

    const data: Prisma.TransactionCategoryUpdateInput = {};
    if (existing.accountingType !== (source.accountingType ?? null)) {
      data.accountingType = source.accountingType ?? null;
    }
    if (!existing.isActive) data.isActive = true;
    // Keep the display name in sync (slug stays immutable once minted).
    if (existing.name !== name) {
      data.name = await this.uniqueMirrorName(name, existing.id);
    }
    if (Object.keys(data).length === 0) return 'noop';
    await this.prisma.transactionCategory.update({ where: { id: existing.id }, data });
    this.invalidate();
    return 'updated';
  }

  /**
   * Deactivates the ITEM_DERIVED mirror for a deleted ItemCategory. Soft-only
   * (the row may still be referenced by historical fiscal-document items).
   * Returns true if a row was changed.
   */
  async deactivateMirror(itemCategoryId: string): Promise<boolean> {
    const existing = await this.prisma.transactionCategory.findFirst({
      where: {
        itemCategoryId,
        kind: TransactionCategoryKind.ITEM_DERIVED,
        isActive: true,
      },
      select: { id: true },
    });
    if (!existing) return false;
    await this.prisma.transactionCategory.update({
      where: { id: existing.id },
      data: { isActive: false },
    });
    this.invalidate();
    return true;
  }

  /**
   * Bulk reconciliation of the entire ITEM_DERIVED mirror set against the current
   * ItemCategory tree. Creates/updates one mirror per ItemCategory and cleans up
   * mirrors whose source ItemCategory no longer exists. Idempotent.
   *
   * Orphan cleanup is two-tier:
   *   - Mirrors still referenced by history (a categorized bank transaction or a
   *     fiscal-document line) are DEACTIVATED — the row must survive so those
   *     references keep resolving.
   *   - Mirrors with no such references are DELETED outright, so deleting an
   *     ItemCategory leaves no trace in the categories list.
   */
  async syncAllItemCategoryMirrors(): Promise<{
    created: number;
    updated: number;
    deactivated: number;
    deleted: number;
    unchanged: number;
  }> {
    const categories = await this.prisma.itemCategory.findMany({
      select: { id: true },
    });

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const c of categories) {
      const result = await this.syncMirrorFromItemCategory(c.id);
      if (result === 'created') created += 1;
      else if (result === 'updated') updated += 1;
      else unchanged += 1;
    }

    // Reconcile orphaned mirrors (source ItemCategory deleted). Deleting an
    // ItemCategory SetNulls the mirror's itemCategoryId (optional relation), so
    // an orphan can have EITHER a null id OR a stale id absent from liveIds — we
    // must catch both. (The previous query filtered `itemCategoryId: { not: null }`,
    // which let every SetNull'd orphan stay ACTIVE in the categories list forever.)
    const liveIds = new Set(categories.map(c => c.id));
    const mirrors = await this.prisma.transactionCategory.findMany({
      where: { kind: TransactionCategoryKind.ITEM_DERIVED },
      select: {
        id: true,
        itemCategoryId: true,
        isActive: true,
        _count: { select: { transactionTags: true, fiscalDocumentItems: true } },
      },
    });
    let deactivated = 0;
    let deleted = 0;
    for (const m of mirrors) {
      // Still mirrors a live ItemCategory → leave it (already up to date above).
      if (m.itemCategoryId && liveIds.has(m.itemCategoryId)) continue;
      // Real history pins the row in place; archive instead of deleting so the
      // categorized transactions / fiscal lines keep resolving.
      const hasHistory = m._count.transactionTags > 0 || m._count.fiscalDocumentItems > 0;
      if (hasHistory) {
        if (m.isActive) {
          await this.prisma.transactionCategory.update({
            where: { id: m.id },
            data: { isActive: false },
          });
          deactivated += 1;
        }
      } else {
        // No history → safe to remove. Learning tables cascade; alias/suggestion
        // FKs SetNull. Cleans up both active and previously-archived orphans.
        await this.prisma.transactionCategory.delete({ where: { id: m.id } });
        deleted += 1;
      }
    }
    if (created || updated || deactivated || deleted) this.invalidate();

    return { created, updated, deactivated, deleted, unchanged };
  }

  // ----- recurring monthly forecast ---------------------------------------

  /**
   * Recurring payables view over an arbitrary date range. Lists recurring
   * categories and the actual amount paid in [from, to] (sum of abs transaction
   * amounts tagged to each), the payment date, plus a forecast ("previsão")
   * derived from the past 3 months: an expected amount (average of the per-month
   * totals) and, for not-yet-paid categories, a predicted payment date from the
   * typical payment day. Copes with amounts that change period to period.
   */
  async forecast(from: Date, to: Date): Promise<{
    from: Date;
    to: Date;
    totalPaid: number;
    totalForecast: number;
    items: Array<{
      category: TransactionCategory;
      paidAmount: number;
      forecastAmount: number;
      transactionCount: number;
      status: 'PAID' | 'PENDING';
      paymentDate: Date | null;
      isPaymentDateForecast: boolean;
    }>;
  }> {
    const recurring = await this.prisma.transactionCategory.findMany({
      where: { isRecurring: true, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const recurringIds = recurring.map(c => c.id);

    // Look back 3 whole months before the period start to derive the expected
    // amount and the typical payment day for each recurring category.
    const lookbackStart = new Date(from);
    lookbackStart.setMonth(lookbackStart.getMonth() - 3);

    const txs = recurringIds.length
      ? await this.prisma.bankTransaction.findMany({
          where: {
            postedAt: { gte: lookbackStart, lte: to },
            categories: { some: { categoryId: { in: recurringIds } } },
          },
          select: {
            postedAt: true,
            amount: true,
            categories: {
              where: { categoryId: { in: recurringIds } },
              select: { categoryId: true, allocatedAmount: true },
            },
          },
        })
      : [];

    // Bucket each transaction's contribution under every recurring category it
    // is tagged with, split into the current period vs. the historical lookback.
    // allocatedAmount is null/0 for transaction-only tags → fall back to the
    // transaction amount.
    type Entry = { date: Date; amount: number };
    const buckets = new Map<string, { current: Entry[]; history: Entry[] }>();
    for (const id of recurringIds) buckets.set(id, { current: [], history: [] });

    for (const tx of txs) {
      const txAmount = Math.abs(Number(tx.amount));
      for (const link of tx.categories) {
        const bucket = buckets.get(link.categoryId);
        if (!bucket) continue;
        const allocated =
          link.allocatedAmount != null ? Number(link.allocatedAmount) : 0;
        const amount = allocated !== 0 ? Math.abs(allocated) : txAmount;
        const entry: Entry = { date: tx.postedAt, amount };
        if (tx.postedAt >= from) bucket.current.push(entry);
        else bucket.history.push(entry);
      }
    }

    const items = recurring.map(category => {
      const { current, history } = buckets.get(category.id)!;
      const paidAmount = current.reduce((a, e) => a + e.amount, 0);
      const transactionCount = current.length;
      const status: 'PAID' | 'PENDING' =
        transactionCount > 0 ? 'PAID' : 'PENDING';

      // Expected amount = average of the per-month totals over the lookback
      // window. Falls back to the current paid amount when there's no history.
      const monthly = new Map<string, number>();
      for (const e of history) {
        const key = `${e.date.getFullYear()}-${e.date.getMonth()}`;
        monthly.set(key, (monthly.get(key) ?? 0) + e.amount);
      }
      // FIXED recurrents use their known monthly amount; VARIABLE use the
      // 3-month average (falling back to the current paid amount).
      const isFixed = category.recurrenceKind === 'FIXED' && category.fixedAmount != null;
      const forecastAmount = isFixed
        ? Number(category.fixedAmount)
        : monthly.size > 0
          ? [...monthly.values()].reduce((a, b) => a + b, 0) / monthly.size
          : paidAmount;

      // Payment date: the latest actual date when paid, otherwise the predicted
      // date from the typical (median) payment day across past + current dates.
      const paidDates = current
        .map(e => e.date)
        .sort((a, b) => a.getTime() - b.getTime());
      let paymentDate: Date | null = paidDates.length
        ? paidDates[paidDates.length - 1]
        : null;
      let isPaymentDateForecast = false;
      // FIXED recurrents have a statutory due day; predict from it when unpaid.
      if (!paymentDate && isFixed && category.dueDayOfMonth) {
        paymentDate = this.dateForDayInPeriod(category.dueDayOfMonth, from, to);
        isPaymentDateForecast = paymentDate != null;
      }
      if (!paymentDate) {
        const days = [...history, ...current]
          .map(e => e.date.getDate())
          .sort((a, b) => a - b);
        if (days.length) {
          const medianDay = days[Math.floor(days.length / 2)];
          paymentDate = this.dateForDayInPeriod(medianDay, from, to);
          isPaymentDateForecast = paymentDate != null;
        }
      }

      return {
        category,
        paidAmount,
        forecastAmount,
        transactionCount,
        status,
        paymentDate,
        isPaymentDateForecast,
      };
    });

    return {
      from,
      to,
      totalPaid: items.reduce((a, b) => a + b.paidAmount, 0),
      totalForecast: items.reduce((a, b) => a + b.forecastAmount, 0),
      items,
    };
  }

  /** Maps a day-of-month onto the actual date that falls inside [from, to]. */
  private dateForDayInPeriod(day: number, from: Date, to: Date): Date | null {
    for (const base of [from, to]) {
      const d = new Date(base.getFullYear(), base.getMonth(), day, 12, 0, 0, 0);
      if (d >= from && d <= to) return d;
    }
    return null;
  }

  // ----- helpers -----------------------------------------------------------

  private async uniqueSlug(name: string, excludeId?: string): Promise<string> {
    const base = slugify(name) || 'categoria';
    let slug = base;
    let n = 1;
    // Loop until free. The taxonomy is tiny, so this is cheap.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const clash = await this.prisma.transactionCategory.findFirst({
        where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { id: true },
      });
      if (!clash) return slug;
      n += 1;
      slug = `${base}-${n}`;
    }
  }

  /**
   * Ensures the mirror display name is unique (name is @unique on the model).
   * Item categories are tiny, so the linear probe is cheap.
   */
  private async uniqueMirrorName(name: string, excludeId?: string): Promise<string> {
    let candidate = name;
    let n = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const clash = await this.prisma.transactionCategory.findFirst({
        where: { name: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { id: true },
      });
      if (!clash) return candidate;
      n += 1;
      candidate = `${name} (${n})`;
    }
  }
}

/** Fixed slug scheme for ITEM_DERIVED mirror rows: `item-<slugified name>`. */
function mirrorSlug(name: string): string {
  return `item-${slugify(name) || 'categoria'}`;
}

function slugify(name: string): string {
  return stripAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nameKey(name: string): string {
  return stripAccents(name).toLowerCase().trim();
}
