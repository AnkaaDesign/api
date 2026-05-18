/**
 * One-time script to backfill FiscalDocumentItem rows for existing
 * FiscalDocument records that were ingested before the items table existed.
 *
 * Strategy
 * --------
 * Iterate every FiscalDocument that:
 *   - has a rawXmlFileId (i.e. the raw XML is still on disk), AND
 *   - has zero FiscalDocumentItem rows attached.
 *
 * For each one, read the XML file off disk, re-parse with
 * SiegXmlParserService, and bulk-insert the parsed items via
 * `prisma.fiscalDocumentItem.createMany`.
 *
 * Usage
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-fiscal-document-items.ts [--dry-run|--execute] [--limit=N]
 *
 * Notes
 * - The parser ignores documents whose XML can no longer be classified; those
 *   are logged and skipped (no row is created).
 * - Re-running the script is safe: documents that already have items are
 *   skipped by the `items: { none: {} }` filter.
 * - The script does NOT touch the FiscalDocument row itself — only items.
 */

import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { SiegXmlParserService } from '../src/modules/integrations/sieg/sieg-xml-parser.service';

const prisma = new PrismaClient();

interface Args {
  dryRun: boolean;
  limit: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1] || '0', 10)) : 0;
  return { dryRun, limit };
}

async function main() {
  const { dryRun, limit } = parseArgs();

  // We instantiate the parser standalone (no Nest DI). It only reads
  // COMPANY_CNPJ off ConfigService, so a barebones wrapper around process.env
  // is enough for this script.
  const configService = {
    get: (key: string) => process.env[key],
  } as unknown as ConfigService;
  const parser = new SiegXmlParserService(configService);

  console.log(
    `[backfill] mode=${dryRun ? 'DRY-RUN' : 'EXECUTE'}${limit ? ` limit=${limit}` : ''}`,
  );

  const candidates = await prisma.fiscalDocument.findMany({
    where: {
      rawXmlFileId: { not: null },
      items: { none: {} },
    },
    select: {
      id: true,
      accessKey: true,
      docType: true,
      rawXmlFile: { select: { path: true } },
    },
    take: limit || undefined,
    orderBy: { createdAt: 'asc' },
  });

  console.log(`[backfill] ${candidates.length} fiscal documents need items.`);

  const counters = { processed: 0, created: 0, parseFailed: 0, fileMissing: 0, noItems: 0 };

  for (const doc of candidates) {
    counters.processed += 1;
    const xmlPath = doc.rawXmlFile?.path;
    if (!xmlPath) {
      counters.fileMissing += 1;
      continue;
    }
    let xml: string;
    try {
      xml = await fs.readFile(xmlPath, 'utf8');
    } catch (err) {
      console.warn(`[backfill] read failed for ${doc.accessKey}: ${(err as Error).message}`);
      counters.fileMissing += 1;
      continue;
    }

    const parsed = parser.parse(xml);
    if (!parsed) {
      console.warn(`[backfill] parse failed for ${doc.accessKey} (${doc.docType})`);
      counters.parseFailed += 1;
      continue;
    }
    if (!parsed.items || parsed.items.length === 0) {
      counters.noItems += 1;
      continue;
    }

    if (dryRun) {
      console.log(
        `[backfill] DRY-RUN ${doc.accessKey} would create ${parsed.items.length} item(s)`,
      );
      counters.created += parsed.items.length;
      continue;
    }

    const result = await prisma.fiscalDocumentItem.createMany({
      data: parsed.items.map((it) => ({
        fiscalDocumentId: doc.id,
        code: it.code,
        description: it.description,
        quantity: it.quantity,
        unit: it.unit,
        unitValue: it.unitValue,
        totalValue: it.totalValue,
      })),
    });
    counters.created += result.count;
    if (counters.processed % 50 === 0) {
      console.log(
        `[backfill] progress: ${counters.processed}/${candidates.length} (${counters.created} items created)`,
      );
    }
  }

  console.log('[backfill] done', counters);
  if (dryRun) {
    console.log('[backfill] Re-run with --execute to apply changes.');
  }
}

main()
  .catch((err) => {
    console.error('[backfill] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
