import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import {
  FiscalDocumentType,
  ReconciliationRunStatus,
  ReconciliationRunTrigger,
} from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SiegService } from './sieg.service';
import { SiegXmlParserService } from './sieg-xml-parser.service';
import { SiegIngestionService } from './sieg-ingestion.service';
import { SIEG_XML_TYPE_MAP, SiegDownloadParams } from './types/sieg.types';

@Injectable()
export class SiegScheduler {
  private readonly logger = new Logger(SiegScheduler.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly siegService: SiegService,
    private readonly parser: SiegXmlParserService,
    private readonly ingestion: SiegIngestionService,
  ) {}

  /**
   * Daily pull at 03:00 São Paulo time. No-op when SIEG_API_KEY is unset.
   */
  @Cron('0 3 * * *', { timeZone: 'America/Sao_Paulo' })
  async runDailyFetch(): Promise<void> {
    if (!this.siegService.isEnabled()) {
      this.logger.debug('SIEG disabled (no API key); skipping daily fetch');
      return;
    }
    if (this.isRunning) {
      this.logger.warn('SIEG daily fetch already running; skipping overlap');
      return;
    }

    const companyCnpj = this.config.get<string>('COMPANY_CNPJ');
    if (!companyCnpj) {
      this.logger.warn('COMPANY_CNPJ not configured; skipping SIEG fetch');
      return;
    }

    const lookback = this.config.get<number>('RECONCILIATION_LOOKBACK_DAYS', 90);
    const dateEnd = new Date();
    const dateStart = new Date(dateEnd.getTime() - lookback * 86_400_000);

    await this.fetchRange(dateStart, dateEnd, companyCnpj, ReconciliationRunTrigger.SCHEDULED);
  }

  /**
   * Manually-triggered range fetch. Used by the admin controller endpoint.
   */
  async fetchRange(
    dateStart: Date,
    dateEnd: Date,
    companyCnpj: string,
    trigger: ReconciliationRunTrigger,
    triggeredById?: string,
    xmlTypeFilter?: FiscalDocumentType,
    cnpjEmit?: string,
    cnpjDest?: string,
  ): Promise<{ runId: string; created: number; skipped: number }> {
    this.isRunning = true;
    const run = await this.prisma.reconciliationRun.create({
      data: {
        trigger,
        status: ReconciliationRunStatus.RUNNING,
        dateStart,
        dateEnd,
        triggeredById: triggeredById ?? null,
      },
    });

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];
    const docTypes: FiscalDocumentType[] = xmlTypeFilter
      ? [xmlTypeFilter]
      : [
          FiscalDocumentType.NFE,
          FiscalDocumentType.NFSE,
          FiscalDocumentType.CTE,
          FiscalDocumentType.NFCE,
        ];

    const perspectives: Array<Partial<SiegDownloadParams>> = [];
    if (cnpjEmit || cnpjDest) {
      perspectives.push({ cnpjEmit, cnpjDest });
    } else {
      perspectives.push({ cnpjEmit: companyCnpj });
      perspectives.push({ cnpjDest: companyCnpj });
    }

    try {
      for (const docType of docTypes) {
        for (const persp of perspectives) {
          const params: Omit<SiegDownloadParams, 'skip' | 'take'> = {
            dateStart: this.formatDate(dateStart),
            dateEnd: this.formatDate(dateEnd),
            xmlType: SIEG_XML_TYPE_MAP[docType],
            ...persp,
          };

          try {
            for await (const item of this.siegService.downloadAllXmls(params)) {
              const parsed = this.parser.parse(item.xml);
              if (!parsed) {
                skipped += 1;
                continue;
              }
              const result = await this.ingestion.upsert(parsed, undefined, item.id);
              if (result.created) created += 1;
              else skipped += 1;
            }
          } catch (err) {
            const msg = `${docType}/${JSON.stringify(persp)}: ${(err as Error).message}`;
            this.logger.error(msg);
            errors.push(msg);
          }
        }
      }

      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status:
            errors.length > 0
              ? ReconciliationRunStatus.PARTIAL
              : ReconciliationRunStatus.SUCCEEDED,
          finishedAt: new Date(),
          stats: { created, skipped, errors },
          errorMessage: errors.length > 0 ? errors.join('\n').slice(0, 2000) : null,
        },
      });
    } catch (err) {
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: ReconciliationRunStatus.FAILED,
          finishedAt: new Date(),
          errorMessage: (err as Error).message,
        },
      });
      throw err;
    } finally {
      this.isRunning = false;
    }

    return { runId: run.id, created, skipped };
  }

  private formatDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}
