import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BankStatementImportStatus,
  BankStatementSource,
  Prisma,
  ReconciliationRunStatus,
  ReconciliationRunTrigger,
} from '@prisma/client';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { OfxParserService } from './ofx-parser.service';
import { ReconciliationMatcherService } from './reconciliation-matcher.service';
import { ImportSummary } from './types/reconciliation.types';

const MAX_OFX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB safety cap

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
   * Parses an uploaded OFX file, creates a BankStatement + BankTransaction rows,
   * then triggers auto-matching. Multer file is consumed and the temp file moved
   * into the long-term uploads folder.
   */
  async importOfx(
    file: Express.Multer.File,
    userId: string | undefined,
  ): Promise<ImportSummary> {
    if (!file) throw new BadRequestException('Arquivo OFX não enviado');
    if (file.size > MAX_OFX_SIZE_BYTES) {
      throw new BadRequestException(`Arquivo excede o tamanho máximo de ${MAX_OFX_SIZE_BYTES} bytes`);
    }

    const buffer = await fs.readFile(file.path);
    const parsed = this.ofxParser.parse(buffer);

    // Persist the raw OFX to long-term storage and create File row
    const rawFileId = await this.persistRawFile(file.path, file.originalname, buffer.length);

    const ownerCnpj = this.config.get<string>('COMPANY_CNPJ', '');
    let totalCredits = new Prisma.Decimal(0);
    let totalDebits = new Prisma.Decimal(0);
    for (const t of parsed.transactions) {
      if (t.amount >= 0) totalCredits = totalCredits.plus(t.amount);
      else totalDebits = totalDebits.plus(Math.abs(t.amount));
    }

    const run = await this.prisma.reconciliationRun.create({
      data: {
        trigger: ReconciliationRunTrigger.IMPORT,
        status: ReconciliationRunStatus.RUNNING,
        triggeredById: userId ?? null,
        dateStart: parsed.periodStart,
        dateEnd: parsed.periodEnd,
      },
    });

    const statement = await this.prisma.bankStatement.create({
      data: {
        source: BankStatementSource.OFX_SICREDI,
        bankCode: parsed.bankCode,
        bankName: parsed.bankName,
        agency: parsed.agency,
        accountNumber: parsed.accountNumber,
        ownerCnpj,
        rawFileId,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        openingBalance: parsed.openingBalance ?? undefined,
        closingBalance: parsed.closingBalance ?? undefined,
        transactionCount: parsed.transactions.length,
        totalCredits,
        totalDebits,
        status: BankStatementImportStatus.PARSING,
        uploadedById: userId ?? null,
      },
    });

    try {
      await this.prisma.bankTransaction.createMany({
        data: parsed.transactions.map(t => ({
          statementId: statement.id,
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
        })),
        skipDuplicates: true,
      });

      await this.prisma.bankStatement.update({
        where: { id: statement.id },
        data: { status: BankStatementImportStatus.MATCHING },
      });

      const autoMatched = await this.matcher.matchStatement(statement.id);

      await this.prisma.bankStatement.update({
        where: { id: statement.id },
        data: {
          status: BankStatementImportStatus.COMPLETED,
          matchedCount: autoMatched,
        },
      });

      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: ReconciliationRunStatus.SUCCEEDED,
          finishedAt: new Date(),
          stats: {
            statementId: statement.id,
            transactionCount: parsed.transactions.length,
            autoMatched,
          },
          statementId: statement.id,
        },
      });

      return {
        statementId: statement.id,
        transactionCount: parsed.transactions.length,
        matchedCount: autoMatched,
        autoMatchedCount: autoMatched,
        unmatchedCount: parsed.transactions.length - autoMatched,
        totalCredits: Number(totalCredits),
        totalDebits: Number(totalDebits),
      };
    } catch (err) {
      await this.prisma.bankStatement.update({
        where: { id: statement.id },
        data: {
          status: BankStatementImportStatus.FAILED,
          errorMessage: (err as Error).message.slice(0, 500),
        },
      });
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: ReconciliationRunStatus.FAILED,
          finishedAt: new Date(),
          errorMessage: (err as Error).message,
        },
      });
      throw err;
    }
  }

  private async persistRawFile(
    tempPath: string,
    originalName: string,
    size: number,
  ): Promise<string> {
    const dir = path.join(process.cwd(), 'uploads', 'bank-statements');
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, `${Date.now()}-${originalName}`);
    await fs.copyFile(tempPath, target);
    await fs.unlink(tempPath).catch(() => undefined);

    const file = await this.prisma.file.create({
      data: {
        filename: path.basename(target),
        originalName,
        path: target,
        mimetype: 'application/x-ofx',
        size,
      },
    });
    return file.id;
  }
}
