/**
 * backfill-fiscal-order-codes.ts
 * ---------------------------------------------------------------------------
 * One-off backfill that re-ingests NFe XMLs from a LOCAL FOLDER (not from each
 * doc's stored rawXmlFile.path) so the `infCpl` and the new `#Ped:` order-code
 * join rows (FiscalDocumentOrderCode) get populated on documents that were
 * imported before that code existed.
 *
 * Why a folder source: the standard `backfill-fiscal-xml.ts` reads each doc's
 * stored `rawXmlFile.path`, which on this environment points to a different host
 * and is absent on disk — every doc would be skipped as missingFile. The real
 * XMLs are available locally (e.g. extracted from a SIEG/manual zip), so we
 * parse them directly and call the SAME SiegIngestionService.upsert used by the
 * importer. upsert matches the already-present accessKey and REFRESHES header
 * (incl. infCpl) + items + order codes — fully idempotent, never duplicates,
 * never touches ReconciliationMatch.
 *
 * Run in dev:
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     src/scripts/backfill-fiscal-order-codes.ts [/path/to/xml/folder]
 *
 * Default folder: /tmp/farben_nfs
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { FiscalDocumentSource } from '@prisma/client';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { AppModule } from '../app.module';
import { SiegXmlParserService } from '../modules/integrations/sieg/sieg-xml-parser.service';
import { SiegIngestionService } from '../modules/integrations/sieg/sieg-ingestion.service';

async function main(): Promise<void> {
  const logger = new Logger('FiscalOrderCodeBackfill');
  const folder = process.argv[2] || '/tmp/farben_nfs';
  logger.log(`Starting order-code backfill from folder: ${folder}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const parser = app.get(SiegXmlParserService);
    const ingestion = app.get(SiegIngestionService);

    let entries: string[];
    try {
      entries = (await fs.readdir(folder)).filter((f) => f.toLowerCase().endsWith('.xml'));
    } catch (err) {
      logger.error(`Cannot read folder ${folder}: ${err}`);
      process.exitCode = 1;
      return;
    }

    logger.log(`Found ${entries.length} XML file(s).`);

    let processed = 0;
    let updated = 0;
    let created = 0;
    let withOrderCodes = 0;
    let totalCodes = 0;
    let parseFailed = 0;

    for (const name of entries) {
      processed += 1;
      const filePath = path.join(folder, name);
      let xml: string;
      try {
        xml = await fs.readFile(filePath, 'utf8');
      } catch {
        parseFailed += 1;
        continue;
      }

      const parsed = parser.parse(xml);
      if (!parsed) {
        parseFailed += 1;
        logger.warn(`  · ${name} — parse failed`);
        continue;
      }

      const codes = parsed.orderCodes ?? [];
      if (codes.length > 0) {
        withOrderCodes += 1;
        totalCodes += codes.length;
      }

      const res = await ingestion.upsert(parsed, FiscalDocumentSource.MANUAL_UPLOAD);
      if (res.created) created += 1;
      else updated += 1;
    }

    logger.log(
      `Done. processed=${processed} created=${created} updated=${updated} ` +
        `parseFailed=${parseFailed} docsWithOrderCodes=${withOrderCodes} totalCodes=${totalCodes}`,
    );
  } catch (err) {
    logger.error(`Backfill failed: ${err instanceof Error ? err.stack : err}`);
    exitCode = 1;
  } finally {
    await app.close();
    process.exitCode = exitCode;
  }
}

void main();
