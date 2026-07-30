/**
 * Audit (and optionally repair) the D-1 due-date drift between our records and Sicredi.
 *
 * Root cause: the BOLETO_SYNC job parsed Sicredi's `dataVencimento` with `new Date(...)`.
 * For a bare "yyyy-MM-dd" that is UTC midnight, which renders as the PREVIOUS day in
 * São Paulo (UTC-3). The job then compared that SP-rendered day against our stored
 * noon-UTC day, saw a "difference", and wrote the date back one day earlier — cascading
 * it to the Installment too. The shift is one-shot per slip: once stored as D-1 the
 * comparison agrees, so the record silently stabilises on the wrong date.
 *
 * Sicredi is the authority — the boleto in the customer's hands carries its date.
 * This script pulls `dataVencimento` for every registered slip, compares CALENDAR DAYS
 * with no timezone conversion, and (with --apply) realigns BankSlip + Installment to
 * Sicredi, re-deriving the OVERDUE/PENDING/ACTIVE status from the corrected date.
 *
 * Run:
 *   NODE_ENV=production npx ts-node -r tsconfig-paths/register src/scripts/audit-boleto-due-dates.ts
 *   NODE_ENV=production npx ts-node -r tsconfig-paths/register src/scripts/audit-boleto-due-dates.ts --apply
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { SicrediService } from '../modules/integrations/sicredi/sicredi.service';
import { TaskQuoteStatusCascadeService } from '../modules/production/task-quote/task-quote-status-cascade.service';
import { BANK_SLIP_STATUS, INSTALLMENT_STATUS } from '../constants';
import {
  bankDateToYMD,
  formatDueDateYMD,
  parseDueDateYMD,
  todayInSaoPauloAtNoonUtc,
} from '../utils/due-date.util';

const APPLY = process.argv.includes('--apply');

/**
 * Report output. Goes straight to stdout rather than through the Nest logger, whose
 * level is turned down to keep the app-context boot noise out of the report.
 */
// eslint-disable-next-line no-console
const out = (message: string): void => console.log(message);

interface Row {
  nossoNumero: string;
  customer: string;
  task: string;
  parcela: number;
  storedYMD: string;
  sicrediYMD: string;
  driftDays: number;
  rawSicredi: string;
  situacao: string;
  slipStatus: string;
  instStatus: string;
  slipId: string;
  instId: string;
  invoiceId: string | null;
  storedTimeUtc: string;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const sicredi = app.get(SicrediService);

    // Every slip actually registered at Sicredi (TMP-* were never registered).
    const slips = await prisma.bankSlip.findMany({
      where: { nossoNumero: { not: { startsWith: 'TMP-' } } },
      select: {
        id: true,
        nossoNumero: true,
        dueDate: true,
        status: true,
        installment: {
          select: {
            id: true,
            number: true,
            dueDate: true,
            status: true,
            invoiceId: true,
            invoice: {
              select: {
                task: { select: { name: true } },
                customer: { select: { fantasyName: true } },
              },
            },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    out(`Querying Sicredi for ${slips.length} registered boleto(s)...`);

    const drifted: Row[] = [];
    const aligned: Row[] = [];
    const unreadable: string[] = [];
    const failed: string[] = [];
    const rawFormats = new Map<string, number>();

    for (const slip of slips) {
      let data: { dataVencimento: string; situacao: string };
      try {
        data = (await sicredi.queryBoleto(slip.nossoNumero)) as any;
      } catch (error) {
        failed.push(`${slip.nossoNumero}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      const raw = data?.dataVencimento;
      // Record the shape Sicredi actually returns — this is what the old parser tripped on.
      if (raw) {
        const shape = String(raw).replace(/\d/g, '#');
        rawFormats.set(shape, (rawFormats.get(shape) ?? 0) + 1);
      }

      const sicrediYMD = bankDateToYMD(raw);
      if (!sicrediYMD) {
        unreadable.push(`${slip.nossoNumero}: dataVencimento=${JSON.stringify(raw)}`);
        continue;
      }

      const storedYMD = formatDueDateYMD(slip.dueDate);
      const row: Row = {
        nossoNumero: slip.nossoNumero,
        customer: slip.installment?.invoice?.customer?.fantasyName ?? '?',
        task: slip.installment?.invoice?.task?.name ?? '?',
        parcela: slip.installment?.number ?? 0,
        storedYMD,
        sicrediYMD,
        driftDays: Math.round(
          (parseDueDateYMD(sicrediYMD).getTime() - parseDueDateYMD(storedYMD).getTime()) / 86400000,
        ),
        rawSicredi: String(raw),
        situacao: data?.situacao ?? '?',
        slipStatus: slip.status,
        instStatus: slip.installment?.status ?? '?',
        slipId: slip.id,
        instId: slip.installment?.id ?? '',
        invoiceId: slip.installment?.invoiceId ?? null,
        storedTimeUtc: slip.dueDate.toISOString().slice(11, 19),
      };

      (storedYMD === sicrediYMD ? aligned : drifted).push(row);
    }

    // ── Report ────────────────────────────────────────────────────────────
    out('');
    out('══════════════════ dataVencimento formats returned by Sicredi ══════════════════');
    for (const [shape, count] of rawFormats) out(`  ${shape}  ×${count}`);

    out('');
    out(`══════════════════ RESULT: ${drifted.length} drifted / ${aligned.length} aligned ══════════════════`);

    if (drifted.length) {
      const byDrift = new Map<number, number>();
      for (const r of drifted) byDrift.set(r.driftDays, (byDrift.get(r.driftDays) ?? 0) + 1);
      const histogram = [...byDrift.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([d, c]) => `${d > 0 ? '+' : ''}${d}d×${c}`)
        .join('  ');
      out(`  drift histogram (days, Sicredi − stored): ${histogram}`);
      out('');
      for (const r of drifted) {
        out(
          `  ${r.nossoNumero}  stored=${r.storedYMD} (${r.storedTimeUtc}Z)  sicredi=${r.sicrediYMD}  ` +
            `${r.driftDays > 0 ? '+' : ''}${r.driftDays}d  raw="${r.rawSicredi}"  ` +
            `slip=${r.slipStatus} parcela=${r.instStatus} situacao=${r.situacao}  ` +
            `| ${r.customer} — ${r.task} p${r.parcela}`,
        );
      }
    }

    // Slips whose stored value breaks the noon-UTC convention are latent D-1 renders
    // in the UI even when the calendar day currently matches.
    const badConvention = [...drifted, ...aligned].filter((r) => r.storedTimeUtc !== '12:00:00');
    if (badConvention.length) {
      out('');
      out(`══════════════════ ${badConvention.length} slip(s) NOT stored at noon UTC ══════════════════`);
      for (const r of badConvention) {
        out(`  ${r.nossoNumero}  ${r.storedYMD} at ${r.storedTimeUtc}Z  | ${r.customer} — ${r.task}`);
      }
    }

    if (unreadable.length) {
      out('');
      out(`Unparseable dataVencimento (${unreadable.length}):`);
      unreadable.forEach((u) => out(`  ${u}`));
    }
    if (failed.length) {
      out('');
      out(`Sicredi query failures (${failed.length}):`);
      failed.forEach((f) => out(`  ${f}`));
    }

    // ── Repair policy ─────────────────────────────────────────────────────
    // Only |1 day| drift is the D-1 parser bug. Anything larger has a different cause
    // (a real due-date change made at the bank, or the April spreadsheet import) and is
    // NOT auto-corrected — rewriting a settled record for an unrelated reason would
    // falsify financial history. Those are reported for a human decision.
    const dMinus1 = drifted.filter((r) => Math.abs(r.driftDays) === 1);
    const otherDrift = drifted.filter((r) => Math.abs(r.driftDays) !== 1);
    // Calendar day already correct, but stored at midnight UTC — renders as D-1 in any
    // SP-timezone view and trips the overdue sweep. Fix the time, keep the day.
    const timeOnly = badConvention.filter((r) => !drifted.includes(r));

    if (otherDrift.length) {
      out('');
      out(
        `══════════════════ ${otherDrift.length} slip(s) drift by MORE than 1 day — NOT auto-corrected ══════════════════`,
      );
      out('  (different root cause: bank-side due-date change or the April import)');
      for (const r of otherDrift) {
        out(
          `  ${r.nossoNumero}  stored=${r.storedYMD}  sicredi=${r.sicrediYMD}  ` +
            `${r.driftDays > 0 ? '+' : ''}${r.driftDays}d  slip=${r.slipStatus} parcela=${r.instStatus} ` +
            `situacao=${r.situacao}  | ${r.customer} — ${r.task} p${r.parcela}`,
        );
      }
    }

    const toFix = [...dMinus1, ...timeOnly];
    if (!toFix.length) {
      out('');
      out('Nothing to repair — every slip matches Sicredi and uses the noon-UTC convention.');
      return;
    }

    const today = todayInSaoPauloAtNoonUtc();
    out('');
    out(
      `══════════════════ ${APPLY ? 'APPLYING' : 'DRY-RUN'}: ${dMinus1.length} date realign + ` +
        `${timeOnly.length} time normalise ══════════════════`,
    );

    // Invoices whose quote status must be re-derived once the dates are truthful.
    const invoiceIdsToCascade = new Set<string>();

    for (const r of toFix) {
      const target = parseDueDateYMD(r.sicrediYMD);
      const isPast = target < today;

      // Re-derive status from the corrected date. Never touch a settled record:
      // PAID/CANCELLED outcomes are facts, not date-derived.
      const slipSettled =
        r.slipStatus === BANK_SLIP_STATUS.PAID || r.slipStatus === BANK_SLIP_STATUS.CANCELLED;
      const instSettled =
        r.instStatus === INSTALLMENT_STATUS.PAID || r.instStatus === INSTALLMENT_STATUS.CANCELLED;

      let newSlipStatus: string | null = null;
      if (!slipSettled) {
        const want = isPast ? BANK_SLIP_STATUS.OVERDUE : BANK_SLIP_STATUS.ACTIVE;
        if (r.slipStatus !== want && (r.slipStatus === BANK_SLIP_STATUS.OVERDUE || r.slipStatus === BANK_SLIP_STATUS.ACTIVE)) {
          newSlipStatus = want;
        }
      }

      let newInstStatus: string | null = null;
      if (!instSettled) {
        const want = isPast ? INSTALLMENT_STATUS.OVERDUE : INSTALLMENT_STATUS.PENDING;
        if (r.instStatus !== want && (r.instStatus === INSTALLMENT_STATUS.OVERDUE || r.instStatus === INSTALLMENT_STATUS.PENDING)) {
          newInstStatus = want;
        }
      }

      out(
        `  ${r.nossoNumero}  ${r.storedYMD} → ${r.sicrediYMD}` +
          (newSlipStatus ? `  slip ${r.slipStatus}→${newSlipStatus}` : '') +
          (newInstStatus ? `  parcela ${r.instStatus}→${newInstStatus}` : '') +
          (slipSettled || instSettled ? '  [settled — status kept]' : '') +
          `  | ${r.customer} — ${r.task} p${r.parcela}`,
      );

      if (r.invoiceId) invoiceIdsToCascade.add(r.invoiceId);

      if (!APPLY) continue;

      await prisma.$transaction(async (tx) => {
        await tx.bankSlip.update({
          where: { id: r.slipId },
          data: { dueDate: target, ...(newSlipStatus ? { status: newSlipStatus as any } : {}) },
        });
        if (r.instId) {
          await tx.installment.update({
            where: { id: r.instId },
            data: { dueDate: target, ...(newInstStatus ? { status: newInstStatus as any } : {}) },
          });
        }
      });
    }

    // ── Re-derive quote statuses ──────────────────────────────────────────
    // A quote sitting at DUE only because a parcela was wrongly past-due must fall back
    // to UPCOMING/PARTIAL now that the dates are truthful. The cascade recomputes
    // Invoice + TaskQuote from the corrected installments.
    out('');
    out(
      `══════════════════ ${APPLY ? 'CASCADING' : 'WOULD CASCADE'} quote status for ` +
        `${invoiceIdsToCascade.size} invoice(s) ══════════════════`,
    );

    if (APPLY) {
      const cascade = app.get(TaskQuoteStatusCascadeService);
      let cascadeErrors = 0;
      for (const invoiceId of invoiceIdsToCascade) {
        try {
          await cascade.cascadeFromInvoice(invoiceId);
        } catch (error) {
          cascadeErrors++;
          out(
            `  cascade failed for invoice ${invoiceId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      out(
        `  cascaded ${invoiceIdsToCascade.size - cascadeErrors}/${invoiceIdsToCascade.size} invoice(s)`,
      );
    }

    out('');
    out(
      APPLY
        ? `Done — ${dMinus1.length} date(s) realigned, ${timeOnly.length} time(s) normalised, ` +
            `${otherDrift.length} larger drift(s) left for review.`
        : 'DRY-RUN complete. Re-run with --apply to write.',
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
