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

  // ----- recurring monthly forecast ---------------------------------------

  /**
   * Recurring payables view over an arbitrary date range. Lists recurring
   * categories and the actual amount paid in [from, to] (sum of abs transaction
   * amounts tagged to each). It's a "marked recurring" flag only — no
   * expected/predicted value — so it copes with amounts that change period to
   * period.
   */
  async forecast(from: Date, to: Date): Promise<{
    from: Date;
    to: Date;
    totalPaid: number;
    items: Array<{
      category: TransactionCategory;
      paidAmount: number;
      transactionCount: number;
      status: 'PAID' | 'PENDING';
    }>;
  }> {
    const recurring = await this.prisma.transactionCategory.findMany({
      where: { isRecurring: true, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const grouped = await this.prisma.bankTransactionCategory.groupBy({
      by: ['categoryId'],
      where: {
        categoryId: { in: recurring.map(c => c.id) },
        transaction: { postedAt: { gte: from, lte: to } },
      },
      _count: { _all: true },
      _sum: { allocatedAmount: true },
    });

    // allocatedAmount is null for transaction-only tags, so fall back to the
    // transaction amount for those. Compute that fallback per category.
    const byCat = new Map(grouped.map(g => [g.categoryId, g]));
    const items = await Promise.all(
      recurring.map(async category => {
        const g = byCat.get(category.id);
        const count = g?._count._all ?? 0;
        let paidAmount = Number(g?._sum.allocatedAmount ?? 0);
        if (count > 0 && paidAmount === 0) {
          const agg = await this.prisma.bankTransaction.aggregate({
            _sum: { amount: true },
            where: {
              postedAt: { gte: from, lte: to },
              categories: { some: { categoryId: category.id } },
            },
          });
          paidAmount = Math.abs(Number(agg._sum.amount ?? 0));
        }
        return {
          category,
          paidAmount,
          transactionCount: count,
          status: (count > 0 ? 'PAID' : 'PENDING') as 'PAID' | 'PENDING',
        };
      }),
    );

    return {
      from,
      to,
      totalPaid: items.reduce((a, b) => a + b.paidAmount, 0),
      items,
    };
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
