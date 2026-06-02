import { Injectable } from '@nestjs/common';
import {
  AccountingType,
  Prisma,
  ReconciliationMatchType,
  ReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ReconciliationStatistics } from './types/reconciliation.types';
import { StatisticsFilterDto } from './dto/statistics-filter.dto';

// One chart-of-accounts (plano de contas) group's roll-up: total value and
// transaction-tag count across the period. accountingType is null for the
// bucket of tagged-but-ungrouped transactions (no accountingType on the
// resolving category yet).
export interface AccountingTypeDistributionEntry {
  accountingType: AccountingType | null;
  count: number;
  amount: number;
}

// getStatistics returns the base ReconciliationStatistics plus the new
// chart-of-accounts roll-up. Defined here (not in types/) to keep the addition
// scoped to the statistics service.
export type ReconciliationStatisticsWithAccounting = ReconciliationStatistics & {
  accountingTypeDistribution: AccountingTypeDistributionEntry[];
};

@Injectable()
export class ReconciliationStatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatistics(
    filters: StatisticsFilterDto,
  ): Promise<ReconciliationStatisticsWithAccounting> {
    const now = new Date();
    const to = filters.to ? new Date(filters.to) : now;
    const from = filters.from
      ? new Date(filters.from)
      : new Date(to.getTime() - filters.months * 30 * 86_400_000);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      monthMatched,
      monthPending,
      totalDocs,
      lastImport,
      matchedOverTime,
      topUnmatched,
      typeDistribution,
      statusDistribution,
      categoryDistribution,
      accountingTypeDistribution,
    ] = await Promise.all([
      this.prisma.reconciliationMatch.aggregate({
        _sum: { allocatedAmount: true },
        where: { matchedAt: { gte: monthStart, lte: now }, reversedAt: null },
      }),
      this.prisma.bankTransaction.aggregate({
        _sum: { amount: true },
        where: {
          reconciliationStatus: {
            in: [ReconciliationStatus.PENDING, ReconciliationStatus.PARTIAL],
          },
          postedAt: { gte: from, lte: to },
          // Outbound payments (DEBIT) are what need an NF/categorization — the
          // pending backlog this feature exists to surface.
          type: 'DEBIT',
        },
      }),
      this.prisma.fiscalDocument.count({
        where: { issueDate: { gte: from, lte: to } },
      }),
      this.prisma.bankTransaction.aggregate({
        _max: { importedAt: true },
      }),
      this.aggregateMatchedOverTime(from, to),
      this.aggregateTopUnmatched(from, to),
      this.aggregateMatchTypeDistribution(from, to),
      this.aggregateStatusDistribution(from, to),
      this.aggregateCategoryDistribution(from, to),
      this.aggregateAccountingTypeDistribution(from, to),
    ]);

    return {
      totalConciliadoMes: Number(monthMatched._sum.allocatedAmount ?? 0),
      pendenteConciliacao: Number(monthPending._sum.amount ?? 0),
      notasRecebidas: totalDocs,
      ultimaImportacao: lastImport._max.importedAt ?? null,
      matchedOverTime,
      topUnmatchedByCounterparty: topUnmatched,
      matchTypeDistribution: typeDistribution,
      statusDistribution,
      categoryDistribution,
      accountingTypeDistribution,
    };
  }

  private async aggregateMatchedOverTime(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ period: string; matched: number; unmatched: number }>
    >(Prisma.sql`
      SELECT
        TO_CHAR(t."postedAt", 'YYYY-MM') AS period,
        SUM(CASE WHEN t."reconciliationStatus" IN ('RECONCILED','PARTIAL') THEN ABS(t.amount) ELSE 0 END)::float AS matched,
        SUM(CASE WHEN t."reconciliationStatus" = 'PENDING' THEN ABS(t.amount) ELSE 0 END)::float AS unmatched
      FROM "BankTransaction" t
      WHERE t."postedAt" >= ${from} AND t."postedAt" <= ${to}
      GROUP BY 1
      ORDER BY 1 ASC
    `);
    return rows;
  }

  private async aggregateTopUnmatched(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ counterparty: string; amount: number; count: bigint }>
    >(Prisma.sql`
      SELECT
        COALESCE(t."counterpartyName", t."counterpartyCnpjCpf", '(sem identificação)') AS counterparty,
        SUM(ABS(t.amount))::float AS amount,
        COUNT(*) AS count
      FROM "BankTransaction" t
      WHERE t."reconciliationStatus" = 'PENDING'
        AND t."postedAt" >= ${from} AND t."postedAt" <= ${to}
      GROUP BY 1
      ORDER BY amount DESC
      LIMIT 10
    `);
    return rows.map(r => ({
      counterparty: r.counterparty,
      amount: r.amount,
      count: Number(r.count),
    }));
  }

  private async aggregateMatchTypeDistribution(
    from: Date,
    to: Date,
  ): Promise<Record<ReconciliationMatchType, number>> {
    const rows = await this.prisma.reconciliationMatch.groupBy({
      by: ['matchType'],
      _count: { _all: true },
      where: { matchedAt: { gte: from, lte: to }, reversedAt: null },
    });
    const acc = Object.values(ReconciliationMatchType).reduce(
      (a, k) => ({ ...a, [k]: 0 }),
      {} as Record<ReconciliationMatchType, number>,
    );
    for (const r of rows) acc[r.matchType] = r._count._all;
    return acc;
  }

  private async aggregateStatusDistribution(
    from: Date,
    to: Date,
  ): Promise<Record<ReconciliationStatus, number>> {
    const rows = await this.prisma.bankTransaction.groupBy({
      by: ['reconciliationStatus'],
      _count: { _all: true },
      where: { postedAt: { gte: from, lte: to } },
    });
    const acc = Object.values(ReconciliationStatus).reduce(
      (a, k) => ({ ...a, [k]: 0 }),
      {} as Record<ReconciliationStatus, number>,
    );
    for (const r of rows) acc[r.reconciliationStatus] = r._count._all;
    return acc;
  }

  /**
   * Distribution over the dynamic taxonomy via the tag join table. Amounts use
   * the per-category allocatedAmount (proportional NF split) and fall back to
   * the whole transaction amount for transaction-only tags (no allocation), so
   * a multi-category NF is never double-counted by value.
   */
  private async aggregateCategoryDistribution(
    from: Date,
    to: Date,
  ): Promise<Array<{ categoryId: string; name: string; slug: string; kind: string; count: number; amount: number }>> {
    // For tags WITHOUT an explicit allocatedAmount, split the transaction's
    // amount evenly across that transaction's null-allocated tags — so two
    // resolving categories on one transaction don't each count the full amount.
    const rows = await this.prisma.$queryRaw<
      Array<{ categoryId: string; name: string; slug: string; kind: string; count: bigint; amount: number }>
    >(Prisma.sql`
      SELECT
        c."id"   AS "categoryId",
        c."name" AS name,
        c."slug" AS slug,
        c."kind"::text AS kind,
        COUNT(*) AS count,
        SUM(x."eff")::float AS amount
      FROM (
        SELECT
          btc."categoryId" AS cid,
          COALESCE(
            btc."allocatedAmount",
            -- Null-allocated tags split only the UNALLOCATED remainder
            -- (clamped to >= 0), not the full ABS(amount), so allocated
            -- ITEM_DERIVED tags on the same transaction aren't double-counted.
            GREATEST(
              ABS(t.amount) - COALESCE(
                SUM(btc."allocatedAmount")
                  OVER (PARTITION BY btc."transactionId"),
                0),
              0
            ) / NULLIF(
              COUNT(*) FILTER (WHERE btc."allocatedAmount" IS NULL)
                OVER (PARTITION BY btc."transactionId"),
              0)
          ) AS eff
        FROM "BankTransactionCategory" btc
        JOIN "BankTransaction" t ON t."id" = btc."transactionId"
        WHERE t."postedAt" >= ${from} AND t."postedAt" <= ${to}
      ) x
      JOIN "TransactionCategory" c ON c."id" = x."cid"
      GROUP BY c."id", c."name", c."slug", c."kind"
      ORDER BY amount DESC
    `);
    return rows.map(r => ({
      categoryId: r.categoryId,
      name: r.name,
      slug: r.slug,
      kind: r.kind,
      count: Number(r.count),
      amount: r.amount ?? 0,
    }));
  }

  /**
   * Roll-up over the chart of accounts (plano de contas): the same per-tag
   * value as aggregateCategoryDistribution, but grouped by the tagged
   * TransactionCategory's accountingType so cost reports see the 13
   * chart-of-accounts groups instead of the dynamic taxonomy. Tags whose
   * category has no accountingType land in the null bucket. Uses the same
   * even-split for null-allocated tags so a multi-category NF isn't
   * double-counted by value.
   */
  private async aggregateAccountingTypeDistribution(
    from: Date,
    to: Date,
  ): Promise<AccountingTypeDistributionEntry[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ accountingType: AccountingType | null; count: bigint; amount: number }>
    >(Prisma.sql`
      SELECT
        c."accountingType"::text AS "accountingType",
        COUNT(*) AS count,
        SUM(x."eff")::float AS amount
      FROM (
        SELECT
          btc."categoryId" AS cid,
          COALESCE(
            btc."allocatedAmount",
            -- Null-allocated tags split only the UNALLOCATED remainder
            -- (clamped to >= 0), not the full ABS(amount), so allocated
            -- ITEM_DERIVED tags on the same transaction aren't double-counted.
            GREATEST(
              ABS(t.amount) - COALESCE(
                SUM(btc."allocatedAmount")
                  OVER (PARTITION BY btc."transactionId"),
                0),
              0
            ) / NULLIF(
              COUNT(*) FILTER (WHERE btc."allocatedAmount" IS NULL)
                OVER (PARTITION BY btc."transactionId"),
              0)
          ) AS eff
        FROM "BankTransactionCategory" btc
        JOIN "BankTransaction" t ON t."id" = btc."transactionId"
        WHERE t."postedAt" >= ${from} AND t."postedAt" <= ${to}
      ) x
      JOIN "TransactionCategory" c ON c."id" = x."cid"
      GROUP BY c."accountingType"
      ORDER BY amount DESC NULLS LAST
    `);
    return rows.map(r => ({
      accountingType: (r.accountingType as AccountingType | null) ?? null,
      count: Number(r.count),
      amount: r.amount ?? 0,
    }));
  }
}
