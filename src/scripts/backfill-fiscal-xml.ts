/**
 * backfill-fiscal-xml.ts
 * ---------------------------------------------------------------------------
 * One-off backfill that populates the rich FiscalDocument / FiscalDocumentItem
 * columns added for the reconciliation detail pages (protocol, authorization
 * date, emit/dest addresses + IE, ICMSTot totals, per-item taxes/NCM/CFOP, and
 * the NFSe ISS/aliquota/município/serviço fields).
 *
 * It does NOT re-implement any parsing: it re-reads each document's stored raw
 * XML from disk, runs the SAME SiegXmlParserService used by the SIEG importer
 * and the manual upload flow, and calls SiegIngestionService.upsert — which now
 * refreshes header fields + items for an already-existing accessKey. Because
 * upsert is keyed by accessKey and only ever overwrites the projection columns,
 * the script is fully idempotent: re-running re-parses and re-writes the same
 * values, never creating duplicates and never touching ReconciliationMatch rows.
 *
 * Documents whose rawXmlFile is missing on disk are skipped and logged.
 *
 * Run in dev:   npx ts-node src/scripts/backfill-fiscal-xml.ts
 * Run in prod:  NODE_ENV=production node dist/scripts/backfill-fiscal-xml.js
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { FiscalDocumentSource } from '@prisma/client';
import { promises as fs } from 'node:fs';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { SiegXmlParserService } from '../modules/integrations/sieg/sieg-xml-parser.service';
import { SiegIngestionService } from '../modules/integrations/sieg/sieg-ingestion.service';

const BATCH_SIZE = 200;

async function main(): Promise<void> {
  const logger = new Logger('FiscalXmlBackfill');
  logger.log(
    `Starting fiscal-document XML backfill (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'})`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  let exitCode = 0;
  try {
    const prisma = app.get(PrismaService);
    const parser = app.get(SiegXmlParserService);
    const ingestion = app.get(SiegIngestionService);

    const total = await prisma.fiscalDocument.count({
      where: { rawXmlFileId: { not: null } },
    });
    logger.log(`Found ${total} fiscal document(s) with a stored raw XML.`);
    if (total === 0) {
      logger.log('Nothing to do.');
      return;
    }

    let processed = 0;
    let updated = 0;
    let missingFile = 0;
    let parseFailed = 0;

    for (let skip = 0; skip < total; skip += BATCH_SIZE) {
      const docs = await prisma.fiscalDocument.findMany({
        where: { rawXmlFileId: { not: null } },
        select: {
          id: true,
          accessKey: true,
          source: true,
          siegId: true,
          rawXmlFile: { select: { path: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: BATCH_SIZE,
      });

      for (const doc of docs) {
        processed += 1;
        const filePath = doc.rawXmlFile?.path;
        if (!filePath) {
          missingFile += 1;
          continue;
        }

        let xml: string;
        try {
          xml = await fs.readFile(filePath, 'utf8');
        } catch {
          missingFile += 1;
          logger.warn(`  · ${doc.accessKey} — XML file not found at ${filePath}`);
          continue;
        }

        const parsed = parser.parse(xml);
        if (!parsed) {
          parseFailed += 1;
          logger.warn(`  · ${doc.accessKey} — re-parse failed`);
          continue;
        }

        // upsert finds the existing doc by accessKey and refreshes header + items.
        await ingestion.upsert(
          parsed,
          (doc.source as FiscalDocumentSource) ?? FiscalDocumentSource.MANUAL_UPLOAD,
          doc.siegId ?? undefined,
        );
        updated += 1;
      }

      logger.log(`  …processed ${Math.min(skip + BATCH_SIZE, total)}/${total}`);
    }

    logger.log(
      `Done. processed=${processed} updated=${updated} missingFile=${missingFile} parseFailed=${parseFailed}`,
    );
  } catch (err) {
    exitCode = 1;
    new Logger('FiscalXmlBackfill').error(`Backfill failed: ${err}`);
  } finally {
    await app.close();
    process.exit(exitCode);
  }
}

void main();
