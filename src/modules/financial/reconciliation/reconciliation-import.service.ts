import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ReconciliationRunStatus,
  ReconciliationRunTrigger,
} from '@prisma/client';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import unzipper from 'unzipper';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { OfxParserService } from './ofx-parser.service';
import { ReconciliationMatcherService } from './reconciliation-matcher.service';
import {
  ImportSummary,
  OfxImportFileResult,
  ParsedOfxStatement,
} from './types/reconciliation.types';

const MAX_OFX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per OFX entry
const MAX_ZIP_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB per ZIP

interface OfxEntry {
  buffer: Buffer;
  fileName: string;
}

@Injectable()
export class ReconciliationImportService {
  private readonly logger = new Logger(ReconciliationImportService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly ofxParser: OfxParserService,
    private readonly matcher: ReconciliationMatcherService,
  ) {}

  /**
   * Ingests one or more OFX uploads. Each upload may be a raw .ofx/.qfx file or
   * a .zip containing many OFX entries. Re-importing the same OFX is a no-op:
   * BankTransaction has a unique constraint on (bankCode, agency, accountNumber,
   * fitId), so `createMany({ skipDuplicates: true })` silently drops repeats.
   *
   * Returns per-file accounting (parsed/inserted/duplicates) plus a global
   * auto-match count for the newly-inserted rows.
   */
  async importOfx(
    files: Express.Multer.File[],
    userId: string | undefined,
  ): Promise<ImportSummary> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Envie ao menos um arquivo OFX ou ZIP');
    }

    const summary: ImportSummary = {
      filesProcessed: 0,
      transactionsParsed: 0,
      transactionsInserted: 0,
      duplicatesSkipped: 0,
      autoMatchedCount: 0,
      totalCredits: 0,
      totalDebits: 0,
      files: [],
      failedFiles: [],
    };

    const newlyInsertedIds: string[] = [];
    const periodBounds: { start?: Date; end?: Date } = {};

    const run = await this.prisma.reconciliationRun.create({
      data: {
        trigger: ReconciliationRunTrigger.IMPORT,
        status: ReconciliationRunStatus.RUNNING,
        triggeredById: userId ?? null,
      },
    });

    try {
      for (const file of files) {
        try {
          const entries = await this.expandToOfxEntries(file);
          for (const entry of entries) {
            const fileResult = await this.processOfxEntry(entry, userId);
            summary.files.push(fileResult);
            summary.filesProcessed += 1;
            if (fileResult.error) continue;

            for (const stmt of fileResult.statements) {
              summary.transactionsParsed += stmt.parsed;
              summary.transactionsInserted += stmt.inserted;
              summary.duplicatesSkipped += stmt.duplicates;
              if (!periodBounds.start || stmt.periodStart < periodBounds.start)
                periodBounds.start = stmt.periodStart;
              if (!periodBounds.end || stmt.periodEnd > periodBounds.end)
                periodBounds.end = stmt.periodEnd;
            }

            for (const id of fileResult._insertedIds ?? []) newlyInsertedIds.push(id);
            delete fileResult._insertedIds; // strip internal field before returning to API
          }
        } catch (err) {
          this.logger.error(`Failed to ingest ${file.originalname}: ${(err as Error).message}`);
          summary.failedFiles.push(file.originalname);
          summary.files.push({
            fileName: file.originalname,
            statements: [],
            error: (err as Error).message,
          });
        } finally {
          await fs.unlink(file.path).catch(() => undefined);
        }
      }

      // Aggregate credits/debits across all inserted rows in one pass.
      if (newlyInsertedIds.length > 0) {
        const sums = await this.prisma.bankTransaction.groupBy({
          by: ['type'],
          where: { id: { in: newlyInsertedIds } },
          _sum: { amount: true },
        });
        for (const row of sums) {
          const total = Math.abs(Number(row._sum.amount ?? 0));
          if (row.type === 'CREDIT') summary.totalCredits += total;
          else summary.totalDebits += total;
        }
      }

      // Auto-match newly inserted transactions.
      let autoMatched = 0;
      for (const id of newlyInsertedIds) {
        const tx = await this.prisma.bankTransaction.findUnique({
          where: { id },
          select: {
            id: true,
            postedAt: true,
            amount: true,
            type: true,
            counterpartyCnpjCpf: true,
            counterpartyName: true,
            memo: true,
            bankSlipId: true,
            matchStatus: true,
          },
        });
        if (!tx) continue;
        const ok = await this.matcher.matchTransaction(tx as any);
        if (ok) autoMatched += 1;
      }
      summary.autoMatchedCount = autoMatched;

      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: ReconciliationRunStatus.SUCCEEDED,
          finishedAt: new Date(),
          dateStart: periodBounds.start ?? null,
          dateEnd: periodBounds.end ?? null,
          stats: {
            filesProcessed: summary.filesProcessed,
            transactionsInserted: summary.transactionsInserted,
            duplicatesSkipped: summary.duplicatesSkipped,
            autoMatched,
          },
        },
      });
    } catch (err) {
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: ReconciliationRunStatus.FAILED,
          finishedAt: new Date(),
          errorMessage: (err as Error).message.slice(0, 500),
        },
      });
      throw err;
    }

    return summary;
  }

  /**
   * Expands a multer upload into one or more OFX entries. ZIP archives are
   * walked and their .ofx/.qfx entries returned individually so each can be
   * processed (and persisted) on its own.
   */
  private async expandToOfxEntries(file: Express.Multer.File): Promise<OfxEntry[]> {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.zip') {
      if (file.size > MAX_ZIP_SIZE_BYTES) {
        throw new Error(`ZIP "${file.originalname}" excede ${MAX_ZIP_SIZE_BYTES} bytes`);
      }
      const directory = await unzipper.Open.file(file.path);
      const entries: OfxEntry[] = [];
      for (const e of directory.files) {
        if (e.type !== 'File') continue;
        const lower = e.path.toLowerCase();
        if (!lower.endsWith('.ofx') && !lower.endsWith('.qfx')) continue;
        const buffer = await e.buffer();
        if (buffer.byteLength > MAX_OFX_SIZE_BYTES) {
          this.logger.warn(`Skipping oversize OFX entry: ${e.path}`);
          continue;
        }
        entries.push({ buffer, fileName: e.path });
      }
      if (entries.length === 0) {
        throw new Error(`ZIP "${file.originalname}" não contém arquivos .ofx ou .qfx`);
      }
      return entries;
    }

    if (ext !== '.ofx' && ext !== '.qfx') {
      throw new Error(`Tipo de arquivo não suportado: ${file.originalname}`);
    }
    if (file.size > MAX_OFX_SIZE_BYTES) {
      throw new Error(`Arquivo "${file.originalname}" excede ${MAX_OFX_SIZE_BYTES} bytes`);
    }
    const buffer = await fs.readFile(file.path);
    return [{ buffer, fileName: file.originalname }];
  }

  /**
   * Parses one OFX entry, persists its raw bytes, inserts transactions with
   * dedup, and returns the per-file accounting. Internal `_insertedIds` field
   * lets the caller drive the auto-match pass without re-querying.
   */
  private async processOfxEntry(
    entry: OfxEntry,
    userId: string | undefined,
  ): Promise<OfxImportFileResult & { _insertedIds?: string[] }> {
    const parsed = this.ofxParser.parse(entry.buffer);
    const rawFileId = await this.persistRawFile(entry);
    const ownerCnpj = this.config.get<string>('COMPANY_CNPJ') || parsed.ownerCnpj || null;

    const { inserted, duplicates, insertedIds } = await this.insertTransactions(
      parsed,
      rawFileId,
      ownerCnpj,
      userId,
    );

    return {
      fileName: entry.fileName,
      statements: [
        {
          bankCode: parsed.bankCode,
          bankName: parsed.bankName,
          agency: parsed.agency,
          accountNumber: parsed.accountNumber,
          periodStart: parsed.periodStart,
          periodEnd: parsed.periodEnd,
          parsed: parsed.transactions.length,
          inserted,
          duplicates,
        },
      ],
      _insertedIds: insertedIds,
    };
  }

  private async insertTransactions(
    parsed: ParsedOfxStatement,
    rawFileId: string,
    ownerCnpj: string | null,
    userId: string | undefined,
  ): Promise<{ inserted: number; duplicates: number; insertedIds: string[] }> {
    if (parsed.transactions.length === 0) {
      return { inserted: 0, duplicates: 0, insertedIds: [] };
    }

    const rows: Prisma.BankTransactionCreateManyInput[] = parsed.transactions.map(t => ({
      bankCode: parsed.bankCode,
      bankName: parsed.bankName,
      agency: parsed.agency,
      accountNumber: parsed.accountNumber,
      ownerCnpj,
      fitId: t.fitId,
      postedAt: t.postedAt,
      amount: t.amount,
      type: t.type,
      subtype: t.subtype,
      rawTrnType: t.rawTrnType,
      memo: t.memo,
      counterpartyCnpjCpf: t.counterpartyCnpjCpf,
      counterpartyName: t.counterpartyName,
      runningBalance: t.runningBalance ?? undefined,
      rawFileId,
      uploadedById: userId ?? null,
    }));

    // createMany with skipDuplicates returns the count of NEW rows inserted; the
    // unique index (bankCode, agency, accountNumber, fitId) silently drops
    // anything already in the table.
    const result = await this.prisma.bankTransaction.createMany({
      data: rows,
      skipDuplicates: true,
    });
    const inserted = result.count;
    const duplicates = parsed.transactions.length - inserted;

    // Inserted rows are the only ones tagged with this rawFileId — duplicates
    // keep their original rawFileId from the first import that ingested them.
    const insertedRows = await this.prisma.bankTransaction.findMany({
      where: { rawFileId },
      select: { id: true },
    });

    return { inserted, duplicates, insertedIds: insertedRows.map(r => r.id) };
  }

  private async persistRawFile(entry: OfxEntry): Promise<string> {
    const dir = path.join(process.cwd(), 'uploads', 'bank-transactions');
    await fs.mkdir(dir, { recursive: true });
    const safeName = path.basename(entry.fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const target = path.join(dir, `${Date.now()}-${safeName}`);
    await fs.writeFile(target, entry.buffer);

    const file = await this.prisma.file.create({
      data: {
        filename: path.basename(target),
        originalName: entry.fileName,
        path: target,
        mimetype: 'application/x-ofx',
        size: entry.buffer.byteLength,
      },
    });
    return file.id;
  }
}
