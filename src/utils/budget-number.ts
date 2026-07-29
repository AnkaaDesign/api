import { Prisma } from '@prisma/client';

type PrismaContext = Prisma.TransactionClient | { taskQuote: any; $executeRaw: any };

/**
 * Advisory-lock key that serializes `TaskQuote.budgetNumber` allocation.
 *
 * Distinct from RECON_ADVISORY_LOCK_KEY (4_337_271) — advisory locks share one
 * global namespace, so every key in the app must be unique.
 */
export const BUDGET_NUMBER_ADVISORY_LOCK_KEY = 4_337_272;

/**
 * Allocate the next `TaskQuote.budgetNumber`.
 *
 * `budgetNumber` is `@unique` but is minted read-then-write (`MAX(budgetNumber) + 1`).
 * Under READ COMMITTED — Postgres' default, which is what Prisma opens transactions
 * with — two concurrent transactions both read the same MAX and both try to insert
 * N+1; the loser dies with P2002 and takes its whole enclosing transaction with it.
 * That is exactly how a bulk "copiar de outra tarefa" over N targets produced 500s:
 * every target deep-copies the source quote, so every target mints a budgetNumber.
 *
 * `pg_advisory_xact_lock` serializes the read-then-write window across sessions. The
 * lock is held on the transaction's own connection and released automatically at
 * COMMIT **or ROLLBACK**, so a failed transaction can never strand it. Callers must
 * therefore allocate INSIDE the same transaction that performs the insert — passing
 * the plain PrismaClient would take a lock that is released before the insert lands
 * and buys nothing.
 *
 * Numbering semantics are unchanged: still dense, still MAX+1, still no gaps on
 * rollback (a rolled-back allocation was never visible to anyone else).
 */
export async function allocateBudgetNumber(tx: PrismaContext): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BUDGET_NUMBER_ADVISORY_LOCK_KEY})`;

  const maxBudgetNumber = await tx.taskQuote.aggregate({
    _max: { budgetNumber: true },
  });

  return (maxBudgetNumber._max.budgetNumber || 0) + 1;
}
