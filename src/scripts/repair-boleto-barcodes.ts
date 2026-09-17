/**
 * Audit (and optionally repair) boletos whose BARCODE encodes a due date different from
 * the one we store.
 *
 * Root cause: the due date lives in two places — `BankSlip.dueDate` AND the "fator de
 * vencimento" in positions 6-9 of the 44-digit barcode. `PUT /invoices/:id/boleto/due-date`
 * (and the BOLETO_SYNC job) moved the column and left the barcode alone, because
 * `barcode`/`digitableLine` were only ever written at boleto CREATION. The stale line
 * then reaches the customer twice over: the "copiar linha digitável" button hands it out,
 * and `GET /boleto/pdf` fetches the PDF from Sicredi USING it as the lookup key.
 *
 * Both write paths are fixed (see `rebuildBoletoCodesForDueDate`); this script cleans up
 * the slips that already drifted.
 *
 * Sicredi is the authority on which date is real, so every candidate is verified against
 * `queryBoleto` before anything is written:
 *
 *   · Sicredi agrees with our dueDate   → the BARCODE is stale. Rebuilt (with --apply).
 *   · Sicredi agrees with the barcode   → our COLUMN is wrong. NOT touched — that is the
 *                                         D-1 class of bug; run audit-boleto-due-dates.ts.
 *   · Sicredi says a third date         → NOT touched, reported for a human.
 *
 * Closed slips (PAID/CANCELLED) are reported but skipped: nobody will pay that line again,
 * and rewriting it only muddies the reconciliation trail. Pass --include-closed to force.
 *
 * Run (the secrets live in .env.production, which systemd injects only into the service):
 *   set -a; . .env.production; set +a
 *   NODE_ENV=production npx ts-node -r tsconfig-paths/register src/scripts/repair-boleto-barcodes.ts
 *   NODE_ENV=production npx ts-node -r tsconfig-paths/register src/scripts/repair-boleto-barcodes.ts --apply
 *
 * Booting AppModule makes this a second production instance; the scheduler guard in
 * AppModule disables the 72 cron jobs for a script entrypoint — the boot must log
 * "Entrypoint é script (…) — 72 job(s) agendado(s) desligado(s)".
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { SicrediService } from '../modules/integrations/sicredi/sicredi.service';
import { BANK_SLIP_STATUS } from '../constants';
import { bankDateToYMD, formatDueDateYMD } from '../utils/due-date.util';
import {
  barcodeDueDateYMD,
  isValidBarcodeShape,
  rebuildBoletoCodesForDueDate,
} from '../utils/boleto-barcode.util';

const APPLY = process.argv.includes('--apply');
const INCLUDE_CLOSED = process.argv.includes('--include-closed');

/** Report output — straight to stdout, bypassing the Nest logger turned down below. */
// eslint-disable-next-line no-console
const out = (message: string): void => console.log(message);

interface Candidate {
  slipId: string;
  nossoNumero: string;
  seuNumero: string | null;
  customer: string;
  parcela: number | null;
  status: string;
  barcode: string;
  barcodeYMD: string;
  storedYMD: string;
  driftDays: number;
}

const dayDiff = (a: string, b: string): number =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

const isClosed = (status: string): boolean =>
  status === BANK_SLIP_STATUS.PAID || status === BANK_SLIP_STATUS.CANCELLED;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const sicredi = app.get(SicrediService);

    const slips = await prisma.bankSlip.findMany({
      where: { nossoNumero: { not: { startsWith: 'TMP-' } }, barcode: { not: null } },
      select: {
        id: true,
        nossoNumero: true,
        seuNumero: true,
        barcode: true,
        digitableLine: true,
        dueDate: true,
        status: true,
        installment: {
          select: {
            number: true,
            invoice: { select: { customer: { select: { fantasyName: true } } } },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    const candidates: Candidate[] = [];
    const unreadable: string[] = [];

    for (const slip of slips) {
      if (!isValidBarcodeShape(slip.barcode)) {
        unreadable.push(`${slip.nossoNumero}: barcode=${JSON.stringify(slip.barcode)}`);
        continue;
      }
      const barcodeYMD = barcodeDueDateYMD(slip.barcode);
      if (!barcodeYMD) {
        unreadable.push(`${slip.nossoNumero}: fator fora da faixa em "${slip.barcode}"`);
        continue;
      }
      const storedYMD = formatDueDateYMD(slip.dueDate);
      if (barcodeYMD === storedYMD) continue;

      candidates.push({
        slipId: slip.id,
        nossoNumero: slip.nossoNumero,
        seuNumero: slip.seuNumero,
        customer: slip.installment?.invoice?.customer?.fantasyName ?? '?',
        parcela: slip.installment?.number ?? null,
        status: slip.status,
        barcode: slip.barcode as string,
        barcodeYMD,
        storedYMD,
        driftDays: dayDiff(storedYMD, barcodeYMD),
      });
    }

    out('');
    out(
      `Checked ${slips.length} slip(s) with a barcode — ${candidates.length} encode a different ` +
        `due date than the one stored.`,
    );
    if (unreadable.length > 0) {
      out('');
      out(`── ${unreadable.length} unreadable barcode(s), skipped ──`);
      unreadable.forEach((u) => out(`  ${u}`));
    }
    if (candidates.length === 0) {
      out('\nNothing to repair.');
      return;
    }

    // ── Verify each candidate against the bank before writing ────────────────
    out('');
    out('Confirming with Sicredi which date is real...');

    const staleBarcode: Candidate[] = [];
    const staleColumn: Candidate[] = [];
    const disagree: Array<Candidate & { sicrediYMD: string }> = [];
    const skippedClosed: Candidate[] = [];
    const failed: string[] = [];

    for (const c of candidates) {
      if (isClosed(c.status) && !INCLUDE_CLOSED) {
        skippedClosed.push(c);
        continue;
      }
      let sicrediYMD: string | null;
      try {
        const data = (await sicredi.queryBoleto(c.nossoNumero)) as { dataVencimento: string };
        sicrediYMD = bankDateToYMD(data?.dataVencimento);
      } catch (error) {
        failed.push(
          `${c.nossoNumero}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (!sicrediYMD) {
        failed.push(`${c.nossoNumero}: dataVencimento ilegível`);
        continue;
      }

      if (sicrediYMD === c.storedYMD) staleBarcode.push(c);
      else if (sicrediYMD === c.barcodeYMD) staleColumn.push(c);
      else disagree.push({ ...c, sicrediYMD });

      // Courtesy delay between Sicredi calls, as in the other boleto jobs.
      await new Promise((res) => setTimeout(res, 80));
    }

    const line = (c: Candidate): string =>
      `  ${c.nossoNumero}  ${(c.seuNumero ?? '-').padEnd(10)} barra ${c.barcodeYMD} → ` +
      `${c.storedYMD} [${c.driftDays >= 0 ? '+' : ''}${c.driftDays}d]  ${c.status.padEnd(9)} ` +
      `| ${c.customer}${c.parcela ? ` p${c.parcela}` : ''}`;

    out('');
    out(
      `══════ ${APPLY ? 'REBUILDING' : 'WOULD REBUILD'} ${staleBarcode.length} barcode(s) ` +
        `— Sicredi confirms our stored date ══════`,
    );
    for (const c of staleBarcode) {
      const rebuilt = rebuildBoletoCodesForDueDate(c.barcode, c.storedYMD);
      if (!rebuilt) {
        failed.push(`${c.nossoNumero}: reconstrução falhou`);
        continue;
      }
      out(line(c));
      if (!APPLY) continue;
      await prisma.bankSlip.update({
        where: { id: c.slipId },
        data: { barcode: rebuilt.barcode, digitableLine: rebuilt.digitableLine },
      });
    }

    if (staleColumn.length > 0) {
      out('');
      out(
        `══════ ${staleColumn.length} slip(s) NOT touched — Sicredi matches the BARCODE, so the ` +
          `stored dueDate is the wrong one ══════`,
      );
      out('  (that is the D-1 class — run src/scripts/audit-boleto-due-dates.ts)');
      staleColumn.forEach((c) => out(line(c)));
    }

    if (disagree.length > 0) {
      out('');
      out(`══════ ${disagree.length} slip(s) NOT touched — Sicredi says a THIRD date ══════`);
      disagree.forEach((c) =>
        out(`${line(c)}  | Sicredi diz ${c.sicrediYMD}`),
      );
    }

    if (skippedClosed.length > 0) {
      out('');
      out(
        `══════ ${skippedClosed.length} closed slip(s) skipped (PAID/CANCELLED) — ` +
          `pass --include-closed to rebuild them anyway ══════`,
      );
      skippedClosed.forEach((c) => out(line(c)));
    }

    if (failed.length > 0) {
      out('');
      out(`══════ ${failed.length} failure(s) ══════`);
      failed.forEach((f) => out(`  ${f}`));
    }

    out('');
    out(
      APPLY
        ? `Done — ${staleBarcode.length} barcode(s) + linha(s) digitável(is) rebuilt.`
        : 'DRY-RUN complete. Re-run with --apply to write.',
    );
  } finally {
    // `app.close()` hangs for real here (Redis/Baileys), and a `process.exit` after an
    // await that never resolves is worth nothing — so it gets a timebox.
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 15_000))]).catch(
      () => undefined,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
