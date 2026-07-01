/**
 * seed-recurrent-payables-from-categories.ts
 * ---------------------------------------------------------------------------
 * Phase E — unify recurring payables onto a single first-class source, SPLIT
 * per real recipient / outflow.
 *
 * The de-facto recurring obligations historically lived as `TransactionCategory`
 * rows flagged `isRecurring=true` (Aluguel, Energia, Água, Internet, Folha, …),
 * summed as a 3-month bank average in the forecast but NEVER surfaced as concrete
 * Contas a Pagar rows (that view reads first-class RecurrentPayable occurrences,
 * which were EMPTY). The two views therefore contradicted each other.
 *
 * A first pass created ONE MONTHLY RecurrentPayable per recurring category. That
 * is too coarse: several categories bundle multiple distinct payees / due dates
 * (two landlords on Aluguel, two partners on Distribuição de Lucro, two payroll
 * runs on Folha, two utilities on Energia, phone vs. internet on Internet/
 * Telefone). This script REWRITES the seed to the explicit, data-verified split
 * set below — one RecurrentPayable template per real recipient/outflow, multiple
 * templates may share a `categoryId`.
 *
 * Field mapping (mirrors the RecurrentPayable model + service.computeEstimate):
 *   - amountKind   ← FIXED | VARIABLE.
 *   - FIXED        → fixedAmount = amount, estimatedAmount = null
 *                    (computeEstimate resolves FIXED to fixedAmount).
 *   - VARIABLE     → estimatedAmount = amount (the seeded estimate), fixedAmount
 *                    = null (computeEstimate returns the stored estimate, so it
 *                    never falls back to the whole-category 3-month average).
 *   - dueDayOfMonth ← dueDay (MONTHLY cadence).
 *   - payeeName / payeeCnpj ← the real recipient (CNPJ/CPF, digits only).
 *   - expectsNf    ← true only when a real 14-digit CNPJ payee exists (so the NF
 *                    sweep has an emitter to match on). Personal CPFs (Aluguel /
 *                    Distribuição) and Folha (no payee) → false.
 *
 * Idempotent replacement:
 *   1. DELETE every `[SEED-RECURRING]` template whose name is NOT in the new set
 *      (the 10 old single-per-category templates) — occurrences first (they also
 *      cascade), then the template.
 *   2. Create each of the 15 split templates that does not already exist (matched
 *      by name, or by categoryId + payeeCnpj as a backstop).
 *   3. Materialize the current competence's occurrences (via the real service) so
 *      every obligation is an actionable Contas a Pagar row immediately.
 *
 * Re-running is a no-op (0 created / 0 deleted). Templates carry the
 * `[SEED-RECURRING]` tag in their description.
 *
 * Run in dev (against the restored prod backup):
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     src/scripts/seed-recurrent-payables-from-categories.ts
 *
 * The RecurrentPayableService is constructed directly over a PrismaClient (real
 * code, no DI graph) so the script doesn't boot the whole AppModule (which would
 * trigger unrelated onModuleInit side effects like the backup dir).
 */

import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient, RecurrenceKind } from '@prisma/client';

import { RecurrentPayableService } from '../modules/financial/recurrent-payable/recurrent-payable.service';

const SEED_TAG = '[SEED-RECURRING]';

/** One explicit recurring obligation. `categoria` is the DB TransactionCategory
 *  name (resolved to its id at runtime). `payeeCnpjCpf` may be a CPF (11 digits)
 *  or CNPJ (14 digits); null when there is no single payee (Folha). */
interface SeedRow {
  name: string;
  categoria: string;
  payeeName: string | null;
  payeeCnpjCpf: string | null;
  dueDay: number;
  kind: RecurrenceKind;
  amount: number;
}

/** Data-verified split set. Multiple rows may share a categoria. */
const SEED_ROWS: SeedRow[] = [
  // --- Aluguel (two landlords) ---------------------------------------------
  { name: 'Aluguel - Marcos Antonio Pelisson', categoria: 'Aluguel', payeeName: 'MARCOS ANTONIO PELISSON', payeeCnpjCpf: '33034206968', dueDay: 5, kind: RecurrenceKind.FIXED, amount: 14500.0 },
  { name: 'Aluguel - Sandro Furlan Bochi', categoria: 'Aluguel', payeeName: 'SANDRO FURLAN BOCHI', payeeCnpjCpf: '70564949949', dueDay: 5, kind: RecurrenceKind.VARIABLE, amount: 8500.0 },
  // --- Distribuição de Lucro (two partners) --------------------------------
  { name: 'Distribuição de Lucro - Genivaldo Rodrigues', categoria: 'Distribuição de Lucro', payeeName: 'Genivaldo Rodrigues', payeeCnpjCpf: '07332960923', dueDay: 10, kind: RecurrenceKind.VARIABLE, amount: 17375.91 },
  { name: 'Distribuição de Lucro - Sergio Rodrigues', categoria: 'Distribuição de Lucro', payeeName: 'Sergio Rodrigues', payeeCnpjCpf: '06856214995', dueDay: 15, kind: RecurrenceKind.FIXED, amount: 10000.0 },
  // --- Folha de Pagamento (two payroll runs, no single payee) --------------
  { name: 'Folha de Pagamento - Pagamento (dia 5)', categoria: 'Folha de Pagamento', payeeName: null, payeeCnpjCpf: null, dueDay: 5, kind: RecurrenceKind.VARIABLE, amount: 34673.26 },
  { name: 'Folha de Pagamento - 2ª Parcela (dia 15)', categoria: 'Folha de Pagamento', payeeName: null, payeeCnpjCpf: null, dueDay: 15, kind: RecurrenceKind.VARIABLE, amount: 22553.34 },
  // --- Energia Elétrica (two utilities) ------------------------------------
  { name: 'Energia Elétrica - COPEL', categoria: 'Energia Elétrica', payeeName: 'COPEL DISTRIBUIÇÃO', payeeCnpjCpf: '04368898000106', dueDay: 25, kind: RecurrenceKind.VARIABLE, amount: 2256.07 },
  { name: 'Energia Elétrica - Monte Sião Cooperativa', categoria: 'Energia Elétrica', payeeName: 'Monte Sião Coop. de Energia', payeeCnpjCpf: '35710362000150', dueDay: 26, kind: RecurrenceKind.VARIABLE, amount: 1737.41 },
  // --- Internet / Telefone (phone vs. internet) ----------------------------
  { name: 'Telefone - Claro', categoria: 'Internet / Telefone', payeeName: 'CLARO S/A', payeeCnpjCpf: '40432544000147', dueDay: 2, kind: RecurrenceKind.VARIABLE, amount: 210.27 },
  { name: 'Internet - PRTurbo', categoria: 'Internet / Telefone', payeeName: 'PRTURBO INTERNET WIRELESS', payeeCnpjCpf: '08890343000180', dueDay: 10, kind: RecurrenceKind.FIXED, amount: 99.0 },
  // --- Água -----------------------------------------------------------------
  { name: 'Água - SAMAE Ibiporá', categoria: 'Água', payeeName: 'SAMAE IBIPORÁ', payeeCnpjCpf: '78079639000100', dueDay: 11, kind: RecurrenceKind.VARIABLE, amount: 880.04 },
  // --- Contabilidade --------------------------------------------------------
  { name: 'Contabilidade - Consiga', categoria: 'Contabilidade', payeeName: 'CONSIGA CONTABILIDADE E CONSULTORIA LTDA', payeeCnpjCpf: '08950450000157', dueDay: 5, kind: RecurrenceKind.FIXED, amount: 2225.0 },
  // --- Monitoramento --------------------------------------------------------
  { name: 'Monitoramento - PJBank', categoria: 'Monitoramento', payeeName: 'PJBANK PAGAMENTOS SA', payeeCnpjCpf: '18191228000171', dueDay: 11, kind: RecurrenceKind.FIXED, amount: 650.0 },
  // --- Vale Transporte ------------------------------------------------------
  { name: 'Vale Transporte', categoria: 'Vale Transporte', payeeName: 'Transp. Coletivo Rolândia', payeeCnpjCpf: '84814029000105', dueDay: 26, kind: RecurrenceKind.VARIABLE, amount: 310.7 },
  // --- Vale Alimentação -----------------------------------------------------
  { name: 'Vale Alimentação - Nutricard', categoria: 'Vale Alimentação', payeeName: 'Nutricard', payeeCnpjCpf: '09051290000258', dueDay: 3, kind: RecurrenceKind.VARIABLE, amount: 6536.67 },
];

const onlyDigits = (v: string | null): string | null => (v ? v.replace(/\D/g, '') || null : null);

async function main(): Promise<void> {
  const logger = new Logger('SeedRecurrentPayables');
  const prisma = new PrismaClient();
  const service = new RecurrentPayableService(prisma as never);

  try {
    // --- Resolve every categoria name → id -----------------------------------
    const names = [...new Set(SEED_ROWS.map(r => r.categoria))];
    const categories = await prisma.transactionCategory.findMany({
      where: { name: { in: names } },
      select: { id: true, name: true },
    });
    const categoryIdByName = new Map(categories.map(c => [c.name, c.id]));
    const missing = names.filter(n => !categoryIdByName.has(n));
    if (missing.length > 0) {
      throw new Error(`Categorias não encontradas: ${missing.join(', ')}`);
    }

    const newNames = new Set(SEED_ROWS.map(r => r.name));

    // --- 1. DELETE the old single-per-category [SEED-RECURRING] templates that
    //        are NOT in the new split set (occurrences first, then template). ---
    const stale = await prisma.recurrentPayable.findMany({
      where: {
        description: { contains: SEED_TAG },
        name: { notIn: [...newNames] },
      },
      select: { id: true, name: true },
    });
    let deletedTemplates = 0;
    let deletedOccurrences = 0;
    for (const t of stale) {
      const occ = await prisma.recurrentPayableOccurrence.deleteMany({
        where: { recurrentPayableId: t.id },
      });
      deletedOccurrences += occ.count;
      await prisma.recurrentPayable.delete({ where: { id: t.id } });
      deletedTemplates++;
      logger.log(`DELETE stale template "${t.name}" (${t.id}) + ${occ.count} occurrence(s).`);
    }

    // --- 2. Upsert the 15 split templates. Match an existing template by name,
    //        or by categoryId + payeeCnpj as a backstop; on a match, reconcile its
    //        core spec fields (so a template carried over from the old
    //        single-per-category pass — e.g. the bare-named "Vale Transporte" —
    //        lands on the exact spec values). Otherwise create it. ---------------
    let created = 0;
    let reconciled = 0;
    let unchanged = 0;
    for (const row of SEED_ROWS) {
      const categoryId = categoryIdByName.get(row.categoria)!;
      const payeeCnpjCpf = onlyDigits(row.payeeCnpjCpf);
      const isCnpj = payeeCnpjCpf != null && payeeCnpjCpf.length === 14;
      const isFixed = row.kind === RecurrenceKind.FIXED;

      // Canonical field set every template of this row must hold.
      const spec = {
        name: row.name,
        description: `${SEED_TAG} ${row.categoria} — ${row.payeeName ?? 'sem beneficiário'}.`,
        payeeName: row.payeeName,
        payeeCnpj: payeeCnpjCpf,
        categoryId,
        amountKind: row.kind,
        // FIXED → known amount on fixedAmount; VARIABLE → seed estimate on
        // estimatedAmount (so computeEstimate never falls back to the shared
        // whole-category 3-month average).
        fixedAmount: isFixed ? new Prisma.Decimal(row.amount) : null,
        estimatedAmount: isFixed ? null : new Prisma.Decimal(row.amount),
        frequency: 'MONTHLY' as const,
        frequencyCount: 1,
        dueDayOfMonth: row.dueDay,
        daysOfWeek: [] as number[],
        paymentMethod: null,
        // NF auto-linking only makes sense for a real 14-digit CNPJ emitter.
        expectsNf: isCnpj,
        isActive: true,
      };

      const existing = await prisma.recurrentPayable.findFirst({
        where: {
          OR: [
            { name: row.name },
            ...(payeeCnpjCpf ? [{ categoryId, payeeCnpj: payeeCnpjCpf }] : []),
          ],
        },
      });

      if (existing) {
        const differs =
          existing.name !== spec.name ||
          existing.description !== spec.description ||
          existing.payeeName !== spec.payeeName ||
          existing.payeeCnpj !== spec.payeeCnpj ||
          existing.categoryId !== spec.categoryId ||
          existing.amountKind !== spec.amountKind ||
          String(existing.fixedAmount ?? '') !== String(spec.fixedAmount ?? '') ||
          String(existing.estimatedAmount ?? '') !== String(spec.estimatedAmount ?? '') ||
          existing.dueDayOfMonth !== spec.dueDayOfMonth ||
          existing.expectsNf !== spec.expectsNf ||
          existing.isActive !== spec.isActive;
        if (differs) {
          await prisma.recurrentPayable.update({ where: { id: existing.id }, data: spec });
          reconciled++;
          logger.log(`UPDATE "${row.name}" → ${existing.id} — reconciled to spec.`);
        } else {
          unchanged++;
          logger.log(`OK    "${row.name}" — already at spec (${existing.id}).`);
        }
        continue;
      }

      const payable = await prisma.recurrentPayable.create({
        data: { ...spec, nextRun: new Date() },
      });
      created++;
      logger.log(
        `CREATE "${row.name}" → ${payable.id}  [${row.kind}] ` +
          `amount=${row.amount} dueDay=${row.dueDay} ` +
          `payee=${payeeCnpjCpf ?? '—'} expectsNf=${isCnpj}`,
      );
    }

    // --- Drop any future (> current competence) [SEED-RECURRING] occurrences a
    //     prior pass materialized ahead of the horizon, so every seeded template
    //     uniformly holds just the current, actionable month. Idempotent. -------
    const competence = service.currentCompetence();
    const futureCleared = await prisma.recurrentPayableOccurrence.deleteMany({
      where: {
        competence: { gt: competence },
        recurrentPayable: { description: { contains: SEED_TAG } },
      },
    });
    if (futureCleared.count > 0) {
      logger.log(`Cleared ${futureCleared.count} future occurrence(s) beyond ${competence}.`);
    }

    // --- 3. Materialize the current competence so every template has an
    //        actionable Contas a Pagar row now (idempotent per due date). -------
    const rows = await service.ensureCurrentOccurrenceRows(competence);
    const occurrencesTotal = await prisma.recurrentPayableOccurrence.count();

    logger.log('──────────────────────────────────────────────');
    logger.log(`Stale templates deleted : ${deletedTemplates} (+${deletedOccurrences} occurrence(s))`);
    logger.log(`Split templates created : ${created}`);
    logger.log(`Split templates updated : ${reconciled}`);
    logger.log(`Split templates unchanged: ${unchanged}`);
    logger.log(`Occurrences materialized for ${competence}: ${rows.length}`);
    logger.log(`Occurrences total (all competences): ${occurrencesTotal}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
