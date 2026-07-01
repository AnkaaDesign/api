import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  FiscalDocumentOperation,
  FiscalDocumentSource,
  FiscalDocumentStatus,
  FiscalDocumentType,
  NfseStatus,
  OrderStatus,
  Prisma,
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
  /** True when the document was newly inserted. */
  created: boolean;
  /** True when an EXISTING document's status/material fields changed on
   *  re-import (e.g. AUTHORIZED → CANCELLED). When both created and updated are
   *  false, the re-import was a true no-op duplicate. */
  updated: boolean;
}

@Injectable()
export class SiegIngestionService {
  private readonly logger = new Logger(SiegIngestionService.name);
  /** Mirrors SiegXmlParserService.DEFAULT_COMPANY_CNPJ so a SAIDA note's emitter
   *  can be confirmed as our own company before linking to its NfseDocument. */
  private static readonly DEFAULT_COMPANY_CNPJ = '13636938000144';
  private readonly companyCnpj: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
  ) {
    this.companyCnpj = onlyDigits(
      this.config.get<string>('COMPANY_CNPJ') || SiegIngestionService.DEFAULT_COMPANY_CNPJ,
    );
  }

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
      select: {
        id: true,
        accessKey: true,
        status: true,
        cStat: true,
        xMotivo: true,
        totalValue: true,
        cancelledAt: true,
        protocolNumber: true,
      },
    });
    if (existing) {
      const becameCancelled =
        parsed.status === FiscalDocumentStatus.CANCELLED &&
        existing.status !== FiscalDocumentStatus.CANCELLED;

      // Did anything MATERIAL change vs the stored copy? Status is the field the
      // user cares about most (authorized → cancelled), but we also treat a
      // changed protocol, motivo, total or cancellation timestamp as a real
      // update so the re-import is reported as "atualizada" rather than a silent
      // "duplicada".
      const changed =
        existing.status !== parsed.status ||
        existing.cStat !== (parsed.cStat ?? null) ||
        existing.xMotivo !== (parsed.xMotivo ?? null) ||
        existing.protocolNumber !== (parsed.protocolNumber ?? null) ||
        Number(existing.totalValue) !== Number(parsed.totalValue) ||
        (existing.cancelledAt?.getTime() ?? null) !== (parsed.cancelledAt?.getTime() ?? null);

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

      // Resolve (or refresh) the billing link for SAIDA NFS-e. Done outside the
      // transaction (read-only) so a late-arriving emission record is picked up
      // on re-import. Only set when found — never clear an existing link to null
      // (the emission might be created after this re-import runs).
      const nfseDocumentId = await this.resolveNfseDocumentId(parsed);

      await this.prisma.$transaction(async tx => {
        // Refresh header fields. A late-arriving cancellation (cStat 101 /
        // cancNFe) flips status/cancelledAt here.
        await tx.fiscalDocument.update({
          where: { id: existing.id },
          data: {
            ...this.mapHeaderFields(parsed),
            ...(nfseDocumentId ? { nfseDocumentId } : {}),
          },
        });

        if (parsed.items && parsed.items.length > 0) {
          await tx.fiscalDocumentItem.deleteMany({
            where: { fiscalDocumentId: existing.id },
          });
          await tx.fiscalDocumentItem.createMany({
            data: parsed.items.map(it => ({
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
            data: parsed.orderCodes.map(code => ({
              fiscalDocumentId: existing.id,
              code,
            })),
            skipDuplicates: true,
          });
          // Resolve each order code to its purchase Order and connect the M2M
          // backbone (FiscalDocument.orders), so a reconciled NF can flow back to
          // its order. Conservative: only links on a confident, unique match.
          await this.resolveOrderLinks(
            tx,
            existing.id,
            parsed.emitCnpj,
            Number(parsed.totalValue) || 0,
            parsed.issueDate ?? null,
          );
        }

        // A void NF must not stay matched to a payment. Reverse its open matches
        // and return any transaction left with no open matches to PENDING so the
        // matcher can re-link a corrected NF.
        if (becameCancelled) {
          await this.reverseMatchesForDocument(tx, existing.id);
        }
      });

      if (becameCancelled) {
        this.logger.log(
          `Fiscal document ${existing.accessKey} cancelled on re-import — reversed its open reconciliation matches.`,
        );
      }
      return {
        id: existing.id,
        accessKey: existing.accessKey,
        created: false,
        updated: changed,
      };
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

    const nfseDocumentId = await this.resolveNfseDocumentId(parsed);

    const created = await this.prisma.fiscalDocument.create({
      data: {
        accessKey: parsed.accessKey,
        source,
        siegId: siegId ?? null,
        rawXmlFileId,
        nfseDocumentId: nfseDocumentId ?? undefined,
        ...this.mapHeaderFields(parsed),
        items:
          parsed.items && parsed.items.length > 0
            ? { create: parsed.items.map(it => this.mapItemFields(it)) }
            : undefined,
        orderCodes:
          parsed.orderCodes && parsed.orderCodes.length > 0
            ? { create: parsed.orderCodes.map(code => ({ code })) }
            : undefined,
      },
    });

    // Resolve the freshly-created order codes to their purchase Orders and connect
    // the M2M backbone. Best-effort — a resolution failure must never fail the import.
    if (parsed.orderCodes && parsed.orderCodes.length > 0) {
      try {
        await this.resolveOrderLinks(
          this.prisma,
          created.id,
          parsed.emitCnpj,
          Number(parsed.totalValue) || 0,
          parsed.issueDate ?? null,
        );
      } catch (err) {
        this.logger.warn(`Order-code resolution failed for ${created.accessKey}: ${err}`);
      }
    }

    this.events.emit('fiscal-document.created', {
      id: created.id,
      accessKey: created.accessKey,
    });

    return {
      id: created.id,
      accessKey: created.accessKey,
      created: true,
      updated: false,
    };
  }

  /**
   * Applies a CANCELLATION event (parsed from a `procEventoNFe` XML) to an
   * already-imported NF: flips it to CANCELLED and reverses any open
   * reconciliation matches (returning fully-freed transactions to PENDING).
   * Cancellations arrive as a separate document from the NF-e itself, so this
   * is how a manual re-upload of the cancellation reflects the new status.
   *
   * Returns 'not_found' when the referenced NF hasn't been imported yet,
   * 'unchanged' when it was already cancelled, or 'cancelled' on success.
   */
  async applyCancellation(
    accessKey: string,
    protocol?: string | null,
  ): Promise<'cancelled' | 'unchanged' | 'not_found'> {
    const existing = await this.prisma.fiscalDocument.findUnique({
      where: { accessKey },
      select: { id: true, status: true },
    });
    if (!existing) return 'not_found';
    if (existing.status === FiscalDocumentStatus.CANCELLED) return 'unchanged';

    await this.prisma.$transaction(async tx => {
      await tx.fiscalDocument.update({
        where: { id: existing.id },
        data: {
          status: FiscalDocumentStatus.CANCELLED,
          cancelledAt: new Date(),
          cStat: '101',
          xMotivo: 'Cancelamento registrado (evento importado)',
          protocolNumber: protocol ?? undefined,
        },
      });
      await this.reverseMatchesForDocument(tx, existing.id);
    });

    this.logger.log(
      `Cancellation event applied to ${accessKey} — status set to CANCELLED and open matches reversed.`,
    );
    return 'cancelled';
  }

  /**
   * Reverses every open (non-reversed) reconciliation match pointing at a fiscal
   * document and returns any transaction thereby left with no open match to
   * PENDING. Shared by the re-import cancellation path and applyCancellation.
   */
  private async reverseMatchesForDocument(
    tx: Prisma.TransactionClient,
    fiscalDocumentId: string,
  ): Promise<void> {
    const open = await tx.reconciliationMatch.findMany({
      where: { fiscalDocumentId, reversedAt: null },
      select: { transactionId: true },
    });
    if (open.length === 0) return;
    await tx.reconciliationMatch.updateMany({
      where: { fiscalDocumentId, reversedAt: null },
      data: { reversedAt: new Date() },
    });
    const txIds = [
      ...new Set(open.map(m => m.transactionId).filter((id): id is string => Boolean(id))),
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

  /**
   * For a SAIDA (outgoing/emitted) NFS-e issued by our own company, finds the
   * NfseDocument it was generated from so the imported FiscalDocument can carry
   * a direction-aware "vinculada" link to its billing (Invoice/Task). Matches by
   * `NfseDocument.nfseNumber === Number(parsed.nfNumber)`, preferring an
   * AUTHORIZED emission, and only when the parsed document is an NFSE whose
   * emitter is our company. Returns null when no link applies (any ENTRADA doc,
   * a non-NFSE, a foreign emitter, an unparseable number, or no emission found).
   */
  private async resolveNfseDocumentId(parsed: ParsedFiscalDocument): Promise<string | null> {
    if (parsed.operationType !== FiscalDocumentOperation.SAIDA) return null;
    if (parsed.docType !== FiscalDocumentType.NFSE) return null;
    if (onlyDigits(parsed.emitCnpj ?? '') !== this.companyCnpj) return null;
    const num = Number(parsed.nfNumber);
    if (!Number.isFinite(num) || num <= 0) return null;

    const candidates = await this.prisma.nfseDocument.findMany({
      where: { nfseNumber: num },
      select: { id: true, status: true },
    });
    if (candidates.length === 0) return null;
    // Prefer an AUTHORIZED emission; fall back to the first record otherwise (a
    // cancelled emission is still the durable billing anchor of the note).
    const authorized = candidates.find(c => c.status === NfseStatus.AUTHORIZED);
    const chosenId = (authorized ?? candidates[0]).id;

    // nfseDocumentId is @unique — never steal a link already held by ANOTHER
    // FiscalDocument (would throw on write). Allow re-asserting the same link.
    const holder = await this.prisma.fiscalDocument.findUnique({
      where: { nfseDocumentId: chosenId },
      select: { accessKey: true },
    });
    if (holder && holder.accessKey !== parsed.accessKey) return null;
    return chosenId;
  }

  /**
   * Public entry point for the backfill: resolve the order-code join rows of an
   * already-imported FiscalDocument to their purchase Orders and connect the M2M
   * backbone. Loads the doc header and delegates to `resolveOrderLinks`.
   */
  async resolveOrderLinksForDocument(fiscalDocumentId: string): Promise<number> {
    const doc = await this.prisma.fiscalDocument.findUnique({
      where: { id: fiscalDocumentId },
      select: { id: true, emitCnpj: true, totalValue: true, issueDate: true },
    });
    if (!doc) return 0;
    return this.resolveOrderLinks(
      this.prisma,
      doc.id,
      doc.emitCnpj,
      Number(doc.totalValue) || 0,
      doc.issueDate ?? null,
    );
  }

  /**
   * Resolves a fiscal document's `#Ped:` order codes to their purchase Order and
   * populates the Order↔NF backbone (FiscalDocumentOrderCode.orderId + the
   * FiscalDocument.orders M2M), enabling a reconciled NF to flow back to its order.
   *
   * IMPORTANT — the `#Ped:` code is the SUPPLIER'S own sales-order reference (e.g.
   * Farben's "C34673"), NOT our Order.orderNumber (a small local sequence, mostly
   * null). There is therefore no deterministic code→order column; matching is a
   * conservative heuristic that only links on a confident, UNIQUE match:
   *   - supplier guard: the order's supplier CNPJ shares the same 8-digit root
   *     (raiz) as the NF emitter (covers matriz/filial branches of one company);
   *   - value guard: the order's payable total is within 1% of the NF total;
   *   - date guard: the order's createdAt OR forecast is within 60 days of the NF
   *     issue date;
   *   - uniqueness: exactly one candidate order satisfies all guards;
   *   - scope guard: only single-code documents are auto-resolved — a consolidated
   *     invoice listing several codes maps to several distinct supplier POs that a
   *     doc-level value match cannot split, so those are left unresolved.
   * Anything short of a unique match leaves `orderId` null (idempotent, re-runnable).
   * Returns the number of code rows newly resolved.
   */
  private async resolveOrderLinks(
    db: Pick<Prisma.TransactionClient, 'order' | 'fiscalDocument' | 'fiscalDocumentOrderCode'>,
    fiscalDocumentId: string,
    emitCnpj: string | null,
    totalValue: number,
    issueDate: Date | null,
  ): Promise<number> {
    const codes = await db.fiscalDocumentOrderCode.findMany({
      where: { fiscalDocumentId },
      select: { id: true, code: true, orderId: true },
    });
    if (codes.length === 0) return 0;
    // Scope guard: only single-code documents are auto-resolved (see docstring).
    if (codes.length !== 1) return 0;
    const codeRow = codes[0];
    if (codeRow.orderId) return 0; // already resolved — idempotent

    const root = onlyDigits(emitCnpj ?? '').slice(0, 8);
    if (root.length < 8 || totalValue <= 0) return 0;

    // Candidate orders: same supplier CNPJ raiz, not cancelled. Compute each order's
    // payable total with the SAME convention as OrderService.computeOrderPayableTotal
    // (totalOverride wins; else items price×qty + ICMS/IPI − discount% on goods
    // subtotal + freight).
    const candidates = await db.order.findMany({
      where: {
        status: { not: OrderStatus.CANCELLED },
        supplier: { cnpjNormalized: { startsWith: root } },
      },
      select: {
        id: true,
        createdAt: true,
        forecast: true,
        freight: true,
        discount: true,
        totalOverride: true,
        items: { select: { orderedQuantity: true, price: true, icms: true, ipi: true } },
      },
    });

    const DAY = 86_400_000;
    const withinDate = (d: Date | null): boolean =>
      !!d && !!issueDate && Math.abs(d.getTime() - issueDate.getTime()) <= 60 * DAY;

    const matches = candidates.filter(o => {
      const total = computeOrderPayableTotal(o);
      if (total <= 0) return false;
      if (Math.abs(total - totalValue) > 0.01 * totalValue) return false;
      return withinDate(o.createdAt) || withinDate(o.forecast);
    });

    if (matches.length !== 1) return 0; // no confident, unique match — leave null

    const orderId = matches[0].id;
    await db.fiscalDocumentOrderCode.update({
      where: { id: codeRow.id },
      data: { orderId },
    });
    await db.fiscalDocument.update({
      where: { id: fiscalDocumentId },
      data: { orders: { connect: { id: orderId } } },
    });
    return 1;
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

/** Strips all non-digit characters from a CNPJ/CPF string for robust compares. */
function onlyDigits(value: string): string {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Order payable total, mirroring OrderService.computeOrderPayableTotal: a manual
 * grand-total override wins; otherwise items (price×qty + ICMS/IPI) − discount% on
 * the goods subtotal + freight. Used to value-match an NF against its purchase order.
 */
function computeOrderPayableTotal(order: {
  freight?: number | null;
  discount?: number | null;
  totalOverride?: number | null;
  items: Array<{ orderedQuantity: number; price: number; icms?: number | null; ipi?: number | null }>;
}): number {
  if (order.totalOverride != null) {
    return Math.max(0, Math.round(order.totalOverride * 100) / 100);
  }
  let itemsTotal = 0;
  let goodsSubtotal = 0;
  for (const item of order.items) {
    const subtotal = item.orderedQuantity * item.price;
    goodsSubtotal += subtotal;
    itemsTotal += subtotal * (1 + (item.icms || 0) / 100 + (item.ipi || 0) / 100);
  }
  const discount = order.discount || 0;
  const discountAmount = discount > 0 ? goodsSubtotal * (discount / 100) : 0;
  const total = itemsTotal - discountAmount + (order.freight || 0);
  return Math.max(0, Math.round(total * 100) / 100);
}
