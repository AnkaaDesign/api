import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  FiscalDocumentSource,
  FiscalDocumentStatus,
  ReconciliationSource,
  ReconciliationStatus,
} from '@prisma/client';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ParsedFiscalDocument } from './types/sieg.types';

export interface IngestedFiscalDocument {
  id: string;
  accessKey: string;
  created: boolean;
}

@Injectable()
export class SiegIngestionService {
  private readonly logger = new Logger(SiegIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Persists a parsed fiscal document, skipping duplicates by accessKey.
   * Writes the raw XML to disk under `uploads/fiscal-documents/` and registers a File row.
   */
  async upsert(
    parsed: ParsedFiscalDocument,
    source: FiscalDocumentSource = FiscalDocumentSource.SIEG_API,
    siegId?: string,
  ): Promise<IngestedFiscalDocument> {
    const existing = await this.prisma.fiscalDocument.findUnique({
      where: { accessKey: parsed.accessKey },
      select: { id: true, accessKey: true, status: true },
    });
    if (existing) {
      const becameCancelled =
        parsed.status === FiscalDocumentStatus.CANCELLED &&
        existing.status !== FiscalDocumentStatus.CANCELLED;

      // Re-import rebuilds the item rows, which would otherwise WIPE the cached
      // item categories. Snapshot the existing categorizations (keyed by
      // code+description) so we can re-apply them to the rebuilt lines — MANUAL
      // choices must survive (a human set them), and AUTO ones are kept too so an
      // unchanged line keeps its category instead of going null until the next
      // classify run. Genuinely new/changed lines start null and get classified
      // when the document is (re)matched.
      const preserved = new Map<
        string,
        {
          categoryId: string | null;
          categoryConfidence: number | null;
          categorySource: ReconciliationSource | null;
        }
      >();
      if (parsed.items && parsed.items.length > 0) {
        const prior = await this.prisma.fiscalDocumentItem.findMany({
          where: { fiscalDocumentId: existing.id, categoryId: { not: null } },
          select: {
            code: true,
            description: true,
            categoryId: true,
            categoryConfidence: true,
            categorySource: true,
          },
        });
        for (const it of prior) {
          preserved.set(this.itemFingerprint(it.code, it.description), {
            categoryId: it.categoryId,
            categoryConfidence: it.categoryConfidence,
            categorySource: it.categorySource,
          });
        }
      }

      await this.prisma.$transaction(async (tx) => {
        // Refresh header fields. A late-arriving cancellation (cStat 101 /
        // cancNFe) flips status/cancelledAt here.
        await tx.fiscalDocument.update({
          where: { id: existing.id },
          data: this.mapHeaderFields(parsed),
        });

        if (parsed.items && parsed.items.length > 0) {
          await tx.fiscalDocumentItem.deleteMany({
            where: { fiscalDocumentId: existing.id },
          });
          await tx.fiscalDocumentItem.createMany({
            data: parsed.items.map((it) => ({
              fiscalDocumentId: existing.id,
              ...this.mapItemFields(it),
            })),
          });
          if (preserved.size > 0) {
            const fresh = await tx.fiscalDocumentItem.findMany({
              where: { fiscalDocumentId: existing.id },
              select: { id: true, code: true, description: true },
            });
            for (const f of fresh) {
              const keep = preserved.get(this.itemFingerprint(f.code, f.description));
              if (keep?.categoryId) {
                await tx.fiscalDocumentItem.update({
                  where: { id: f.id },
                  data: {
                    categoryId: keep.categoryId,
                    categoryConfidence: keep.categoryConfidence,
                    categorySource: keep.categorySource,
                  },
                });
              }
            }
          }
        }

        // Refresh order codes (delete-then-create) so re-parsing an improved
        // infCpl repopulates the join rows. Always clear, even when none were
        // parsed, so a correction that removes a code is reflected.
        await tx.fiscalDocumentOrderCode.deleteMany({
          where: { fiscalDocumentId: existing.id },
        });
        if (parsed.orderCodes && parsed.orderCodes.length > 0) {
          await tx.fiscalDocumentOrderCode.createMany({
            data: parsed.orderCodes.map((code) => ({
              fiscalDocumentId: existing.id,
              code,
            })),
            skipDuplicates: true,
          });
        }

        // A void NF must not stay matched to a payment. Reverse its open matches
        // and return any transaction left with no open matches to PENDING so the
        // matcher can re-link a corrected NF.
        if (becameCancelled) {
          const open = await tx.reconciliationMatch.findMany({
            where: { fiscalDocumentId: existing.id, reversedAt: null },
            select: { transactionId: true },
          });
          if (open.length > 0) {
            await tx.reconciliationMatch.updateMany({
              where: { fiscalDocumentId: existing.id, reversedAt: null },
              data: { reversedAt: new Date() },
            });
            const txIds = [
              ...new Set(
                open
                  .map((m) => m.transactionId)
                  .filter((id): id is string => Boolean(id)),
              ),
            ];
            for (const tId of txIds) {
              const remaining = await tx.reconciliationMatch.count({
                where: { transactionId: tId, reversedAt: null },
              });
              if (remaining === 0) {
                await tx.bankTransaction.update({
                  where: { id: tId },
                  data: {
                    reconciliationStatus: ReconciliationStatus.PENDING,
                    reconciliationSource: null,
                  },
                });
              }
            }
          }
        }
      });

      if (becameCancelled) {
        this.logger.log(
          `Fiscal document ${existing.accessKey} cancelled on re-import — reversed its open reconciliation matches.`,
        );
      }
      return { id: existing.id, accessKey: existing.accessKey, created: false };
    }

    let rawXmlFileId: string | null = null;
    try {
      const uploadDir = path.join(process.cwd(), 'uploads', 'fiscal-documents');
      await fs.mkdir(uploadDir, { recursive: true });
      const filename = `${parsed.accessKey}.xml`;
      const filePath = path.join(uploadDir, filename);
      await fs.writeFile(filePath, parsed.rawXml, 'utf8');
      const fileRecord = await this.prisma.file.create({
        data: {
          filename,
          originalName: filename,
          path: filePath,
          mimetype: 'application/xml',
          size: Buffer.byteLength(parsed.rawXml, 'utf8'),
        },
      });
      rawXmlFileId = fileRecord.id;
    } catch (err) {
      this.logger.warn(`Failed to persist raw XML for ${parsed.accessKey}: ${err}`);
    }

    const created = await this.prisma.fiscalDocument.create({
      data: {
        accessKey: parsed.accessKey,
        source,
        siegId: siegId ?? null,
        rawXmlFileId,
        ...this.mapHeaderFields(parsed),
        items:
          parsed.items && parsed.items.length > 0
            ? { create: parsed.items.map((it) => this.mapItemFields(it)) }
            : undefined,
        orderCodes:
          parsed.orderCodes && parsed.orderCodes.length > 0
            ? { create: parsed.orderCodes.map((code) => ({ code })) }
            : undefined,
      },
    });

    this.events.emit('fiscal-document.created', {
      id: created.id,
      accessKey: created.accessKey,
    });

    return { id: created.id, accessKey: created.accessKey, created: true };
  }

  /**
   * Maps the parsed header into the FiscalDocument column set shared by the
   * create and re-import paths. `source`/`siegId`/`rawXmlFileId`/`accessKey`
   * are handled by the caller (they are set only on create).
   */
  /**
   * Stable key for matching an item across a re-import (code may be null, so it
   * is combined with the description). Used to carry categorizations forward.
   */
  private itemFingerprint(code: string | null, description: string): string {
    return `${code ?? ''} ${description}`;
  }

  private mapHeaderFields(parsed: ParsedFiscalDocument) {
    return {
      docType: parsed.docType,
      operationType: parsed.operationType,
      status: parsed.status,
      issueDate: parsed.issueDate,
      totalValue: parsed.totalValue,
      emitCnpj: parsed.emitCnpj,
      emitName: parsed.emitName,
      destCnpj: parsed.destCnpj,
      destCpf: parsed.destCpf,
      destName: parsed.destName,
      nfNumber: parsed.nfNumber,
      paymentMethods: (parsed.paymentMethods ?? null) as any,
      cancelledAt: parsed.cancelledAt ?? null,
      // Rich XML-derived columns
      series: parsed.series ?? null,
      model: parsed.model ?? null,
      naturezaOperacao: parsed.naturezaOperacao ?? null,
      infCpl: parsed.infCpl ?? null,
      protocolNumber: parsed.protocolNumber ?? null,
      authorizationDate: parsed.authorizationDate ?? null,
      cStat: parsed.cStat ?? null,
      xMotivo: parsed.xMotivo ?? null,
      dateInferred: parsed.dateInferred ?? false,
      emitIE: parsed.emitIE ?? null,
      emitAddress: (parsed.emitAddress ?? null) as any,
      destIE: parsed.destIE ?? null,
      destEmail: parsed.destEmail ?? null,
      destAddress: (parsed.destAddress ?? null) as any,
      totals: (parsed.totals ?? null) as any,
      issValue: parsed.issValue ?? null,
      issRetained: parsed.issRetained ?? null,
      issRate: parsed.issRate ?? null,
      baseCalculo: parsed.baseCalculo ?? null,
      valorLiquido: parsed.valorLiquido ?? null,
      valorServicos: parsed.valorServicos ?? null,
      codigoTributacaoMunicipio: parsed.codigoTributacaoMunicipio ?? null,
      municipioPrestacao: parsed.municipioPrestacao ?? null,
      itemListaServico: parsed.itemListaServico ?? null,
    };
  }

  /** Maps a parsed line item into the FiscalDocumentItem column set. */
  private mapItemFields(it: ParsedFiscalDocument['items'][number]) {
    return {
      code: it.code,
      description: it.description,
      quantity: it.quantity,
      unit: it.unit,
      unitValue: it.unitValue,
      totalValue: it.totalValue,
      ncm: it.ncm ?? null,
      cfop: it.cfop ?? null,
      cest: it.cest ?? null,
      ean: it.ean ?? null,
      cst: it.cst ?? null,
      discount: it.discount ?? null,
      freight: it.freight ?? null,
      taxes: (it.taxes ?? null) as any,
    };
  }
}
