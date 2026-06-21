/**
 * Backfill the direction-aware "vinculada" link for already-imported SAIDA
 * (outgoing/emitted) NFS-e FiscalDocuments: set FiscalDocument.nfseDocumentId to
 * the NfseDocument the note was generated from, matched by
 * `NfseDocument.nfseNumber === Number(FiscalDocument.nfNumber)` and scoped to our
 * own company as emitter (emitCnpj === COMPANY_CNPJ). Prefers an AUTHORIZED
 * emission; never steals a link already held by another FiscalDocument (the FK is
 * @unique). Idempotent — re-running only fills still-null links.
 *
 * Run (local):
 *   BACKUP_PATH=/tmp/ankaa-backup npx ts-node -r tsconfig-paths/register --transpile-only \
 *     src/scripts/backfill-saida-fiscaldoc-nfse-link.ts [--apply]
 *
 * DRY-RUN by default; pass --apply to write.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FiscalDocumentOperation,
  FiscalDocumentType,
  NfseStatus,
} from '@prisma/client';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';

const DEFAULT_COMPANY_CNPJ = '13636938000144';
const APPLY = process.argv.includes('--apply');

function onlyDigits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

async function main(): Promise<void> {
  const logger = new Logger('BackfillSaidaNfseLink');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const config = app.get(ConfigService);
    const companyCnpj = onlyDigits(config.get<string>('COMPANY_CNPJ') || DEFAULT_COMPANY_CNPJ);
    logger.log(`Company CNPJ: ${companyCnpj}  (mode: ${APPLY ? 'APPLY' : 'DRY-RUN'})`);

    // All SAIDA NFSE docs still missing the link.
    const docs = await prisma.fiscalDocument.findMany({
      where: {
        operationType: FiscalDocumentOperation.SAIDA,
        docType: FiscalDocumentType.NFSE,
        nfseDocumentId: null,
      },
      select: { id: true, accessKey: true, emitCnpj: true, nfNumber: true, status: true },
    });
    logger.log(`SAIDA NFSE docs without link: ${docs.length}`);

    // NfseDocument ids already claimed by some FiscalDocument (FK is @unique).
    const claimedRows = await prisma.fiscalDocument.findMany({
      where: { nfseDocumentId: { not: null } },
      select: { nfseDocumentId: true },
    });
    const claimed = new Set(claimedRows.map(r => r.nfseDocumentId as string));

    let linked = 0;
    let skippedForeign = 0;
    let skippedBadNumber = 0;
    let skippedNoEmission = 0;
    let skippedTaken = 0;
    const examples: string[] = [];

    for (const doc of docs) {
      if (onlyDigits(doc.emitCnpj) !== companyCnpj) {
        skippedForeign += 1;
        continue;
      }
      const num = Number(doc.nfNumber);
      if (!Number.isFinite(num) || num <= 0) {
        skippedBadNumber += 1;
        continue;
      }
      const candidates = await prisma.nfseDocument.findMany({
        where: { nfseNumber: num },
        select: { id: true, status: true, invoiceId: true, taskId: true },
      });
      if (candidates.length === 0) {
        skippedNoEmission += 1;
        continue;
      }
      const authorized = candidates.find(c => c.status === NfseStatus.AUTHORIZED);
      const chosen = authorized ?? candidates[0];
      if (claimed.has(chosen.id)) {
        skippedTaken += 1;
        continue;
      }

      claimed.add(chosen.id);
      linked += 1;
      if (examples.length < 25) {
        examples.push(
          `NF ${doc.nfNumber} → NfseDocument ${chosen.id} [${chosen.status}` +
            `${chosen.invoiceId ? ', invoice' : ''}${chosen.taskId ? ', task' : ''}]`,
        );
      }

      if (APPLY) {
        await prisma.fiscalDocument.update({
          where: { id: doc.id },
          data: { nfseDocumentId: chosen.id },
        });
      }
    }

    logger.log(`\n=== SUMMARY (${APPLY ? 'APPLIED' : 'DRY-RUN'}) ===`);
    logger.log(`${APPLY ? 'Linked' : 'Would link'}: ${linked}`);
    logger.log(`Skipped — foreign emitter: ${skippedForeign}`);
    logger.log(`Skipped — bad/empty nfNumber: ${skippedBadNumber}`);
    logger.log(`Skipped — no NfseDocument with that number: ${skippedNoEmission}`);
    logger.log(`Skipped — NfseDocument already linked to another doc: ${skippedTaken}`);
    logger.log(`\nExamples:`);
    examples.forEach(e => logger.log(`  ✓ ${e}`));
  } finally {
    await app.close();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
