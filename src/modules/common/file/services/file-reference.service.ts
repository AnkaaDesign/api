import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import { FilesStorageService, type FilesFolderMapping } from './files-storage.service';

/**
 * THE single answer to "is anything using this File?".
 *
 * Why this exists
 * ---------------
 * On 2026-06-07 a maintenance sweep deleted 146 File rows from /srv/files/Fotos/ as
 * "orphans". 32 of them were the approved layout of a live, BUDGET_APPROVED quote.
 * Two independent defects had to line up:
 *
 *   1. The files were in a generic folder (an upload sent the unknown context
 *      "quote-layout" — the mapping key is "quote-layouts" — so getFolderPath fell
 *      back to MIME routing and dropped them at the storage root).
 *   2. The reference check could not SEE the reference. "What points at this file?"
 *      was answered by enumerating foreign keys that reference File.id. The
 *      quote-layout link is not one of those: it is File.quoteLayoutId, a column ON
 *      File pointing OUT at TaskQuote. Every inbound-FK-only check therefore reports
 *      "unreferenced" for every quote layout in the database, in any folder.
 *
 * Defect 1 only decided WHICH files were looked at. Defect 2 is what made a
 * referenced file deletable, and it is the one that generalises: the same blind spot
 * applies to any future relation modelled as a column on File.
 *
 * The rules this service encodes
 * ------------------------------
 *  · Inbound references are read from the LIVE FK catalog (information_schema), never
 *    from a hand-maintained list. A relation added by a migration is covered the day
 *    it ships — nobody has to remember to update a constant.
 *  · Outbound references (columns on File itself) are checked explicitly. There is
 *    exactly one today, quoteLayoutId; OUTBOUND_REFERENCES is where any future one goes.
 *  · The folder a file lives in is NEVER an input. Placement is a display concern;
 *    letting it inform a delete decision is what turned a routing typo into data loss.
 *  · It fails CLOSED. Any error resolving references means "referenced" — a file we
 *    cannot prove is unused is never deleted.
 */

/** Columns on File that point OUT at another table. Invisible to the inbound FK catalog. */
const OUTBOUND_REFERENCES: ReadonlyArray<{
  column: string;
  targetTable: string;
  context: keyof FilesFolderMapping;
  label: string;
}> = [
  {
    column: 'quoteLayoutId',
    targetTable: 'TaskQuote',
    context: 'quote-layouts',
    label: 'layout aprovado de orçamento',
  },
];

/**
 * Tables whose rows are DERIVED from a File rather than uses of it. A reference from
 * here must not keep the file alive — deleting the file is precisely what should clean
 * these up (they are all onDelete: Cascade).
 */
const DERIVED_TABLES: ReadonlySet<string> = new Set(['thumbnail_jobs']);

/**
 * Inbound reference → the storage context that reference implies, plus a pt-BR label
 * for error messages.
 *
 * `context: null` means "this reference is real and blocks deletion, but implies no
 * canonical folder" — the file is never moved on account of it. That is the safe
 * default for anything not listed here too: unknown reference ⇒ protected, not placed.
 */
const INBOUND_REFERENCES: Readonly<
  Record<string, { context: keyof FilesFolderMapping | null; label: string }>
> = {
  // --- Task (Clientes/{cliente}/…) ---
  'Layout.fileId': { context: 'tasksLayouts', label: 'layout de tarefa' },
  '_TASK_BUDGETS.A': { context: 'taskBudgets', label: 'orçamento de tarefa' },
  '_TASK_INVOICES.A': { context: 'taskInvoices', label: 'nota fiscal de tarefa' },
  '_TASK_RECEIPTS.A': { context: 'taskReceipts', label: 'comprovante de tarefa' },
  '_TASK_BANK_SLIPS.A': { context: 'taskBankSlips', label: 'boleto de tarefa' },
  '_TASK_REIMBURSEMENTS.A': { context: 'taskReimbursements', label: 'reembolso de tarefa' },
  '_TASK_INVOICE_REIMBURSEMENTS.A': {
    context: 'taskNfeReimbursements',
    label: 'nota fiscal de reembolso de tarefa',
  },
  '_TASK_BASE_FILES.A': { context: 'taskBaseFiles', label: 'arquivo base de tarefa' },
  '_TASK_PROJECT_FILES.A': { context: 'taskProjectFiles', label: 'projeto de tarefa' },
  '_TASK_CHECKIN_FILES.A': { context: 'taskCheckinFiles', label: 'check-in de tarefa' },
  '_TASK_CHECKOUT_FILES.A': { context: 'taskCheckoutFiles', label: 'check-out de tarefa' },
  '_SERVICE_ORDER_CHECKIN_FILES.A': {
    context: 'serviceOrderCheckinFiles',
    label: 'check-in de ordem de serviço',
  },
  '_SERVICE_ORDER_CHECKOUT_FILES.A': {
    context: 'serviceOrderCheckoutFiles',
    label: 'check-out de ordem de serviço',
  },
  '_OBSERVATIONS_FILES.A': { context: 'observations', label: 'observação' },
  '_InstallmentReceipts.A': {
    context: 'installmentReceipts',
    label: 'comprovante de parcela',
  },
  'Cut.fileId': { context: 'cutFiles', label: 'recorte (plotter)' },
  'ImplementMeasure.photoId': {
    context: 'implementMeasurePhotos',
    label: 'foto de medida do implemento',
  },
  'Truck.vinPlateId': { context: 'truckVinPlate', label: 'plaqueta de chassi' },
  'Customer.logoId': { context: 'customerLogo', label: 'logo de cliente' },

  // --- Airbrushing (Clientes/{cliente}/Aerografias/…) ---
  '_AIRBRUSHING_INVOICES.B': {
    context: 'airbrushingInvoices',
    label: 'nota fiscal de aerografia',
  },
  '_AIRBRUSHING_RECEIPTS.B': {
    context: 'airbrushingReceipts',
    label: 'comprovante de aerografia',
  },

  // --- Supplier (Fornecedores/{fornecedor}/…) ---
  'Supplier.logoId': { context: 'supplierLogo', label: 'logo de fornecedor' },
  '_ORDER_RECEIPTS.A': { context: 'orderReceipts', label: 'comprovante de pedido' },

  // --- User (Colaboradores/{colaborador}/…) ---
  'User.avatarId': { context: 'userAvatar', label: 'foto de perfil' },
  '_FileToWarning.A': { context: 'warning', label: 'advertência' },
  'PpeDeliverySignature.signedDocumentId': {
    context: 'signedPpeDocuments',
    label: 'EPI assinado',
  },

  // --- Root-level operations ---
  '_EXTERNAL_OPERATION_INVOICES.B': {
    context: 'externalOperationInvoices',
    label: 'nota fiscal de retirada externa',
  },
  '_EXTERNAL_OPERATION_RECEIPTS.B': {
    context: 'externalOperationReceipts',
    label: 'comprovante de retirada externa',
  },
  '_EXTERNAL_OPERATION_REIMBURSEMENTS.B': {
    context: 'externalOperationReimbursements',
    label: 'reembolso de retirada externa',
  },
  '_EXTERNAL_OPERATION_INVOICE_REIMBURSEMENTS.B': {
    context: 'externalOperationNfeReimbursements',
    label: 'nota fiscal de reembolso de retirada externa',
  },

  // --- Protected, but with no canonical folder of their own ---
  // These are real uses: they block deletion. They are simply never a reason to MOVE
  // a file, so the organizer leaves them wherever they are.
  // Documento de pessoa -> pasta da pessoa. Todos estes tinham `context: null`, o que os
  // protegia da exclusão mas deixava o organizador sem nada a fazer: subiam como
  // 'documents' (Auxiliares/) e ficavam lá para sempre.
  'AdmissionDocument.fileId': { context: 'admissionDocuments', label: 'documento de admissão' },
  'AdmissionDocument.signedFileId': {
    context: 'admissionDocuments',
    label: 'documento de admissão assinado',
  },
  'TerminationDocument.fileId': {
    context: 'terminationDocuments',
    label: 'documento de rescisão',
  },
  'MedicalExam.fileId': { context: 'medicalExams', label: 'ASO / exame médico' },
  'UserBenefit.declarationFileId': {
    context: 'benefitDocuments',
    label: 'declaração de benefício',
  },
  'WarningSignature.signedDocumentId': { context: 'warning', label: 'advertência assinada' },
  'PpeDelivery.deliveryDocumentId': {
    context: 'signedPpeDocuments',
    label: 'documento de entrega de EPI',
  },
  '_FileToLeave.A': { context: 'leaveDocuments', label: 'afastamento' },
  'BankSlip.pdfFileId': { context: 'taskBankSlips', label: 'PDF de boleto' },
  'BankTransaction.rawFileId': { context: 'bankStatements', label: 'extrato bancário importado' },
  'FiscalDocument.rawXmlFileId': { context: 'fiscalDocumentXml', label: 'XML de documento fiscal' },
  // Sem pasta canônica declarada: continuam protegidos, nunca movidos.
  'WorkAccidentReport.fileId': { context: null, label: 'CAT / acidente de trabalho' },
  'Fispq.pdfFileId': { context: null, label: 'FISPQ' },
  'WasteCertificate.pdfFileId': { context: null, label: 'certificado de resíduo' },
  'WasteCertificate.signedFileId': {
    context: null,
    label: 'certificado de resíduo assinado',
  },
  // O PDF do orçamento persistido para assinatura. Tem pasta canônica desde que o
  // contexto budgetSignatures existe — é o que permite ao organizador recolher os que o
  // sanitizador antigo do serviço de assinatura espalhou numa pasta de cliente paralela.
  'SignatureEnvelope.originalFileId': {
    context: 'budgetSignatures',
    label: 'orçamento enviado para assinatura',
  },
  'SignatureEnvelope.finalFileId': {
    context: 'budgetSignatures',
    label: 'orçamento assinado',
  },
  'TaskQuoteCustomerConfig.customerSignatureId': {
    context: null,
    label: 'assinatura do cliente no orçamento',
  },
};

export interface FileReference {
  /** Table holding the reference. `File` for outbound columns. */
  table: string;
  column: string;
  /** Storage context this reference implies, or null when it implies no canonical folder. */
  context: keyof FilesFolderMapping | null;
  /** Human-readable pt-BR description, for error messages shown to users. */
  label: string;
}

/** A reference to ignore while checking — used when tearing down the very owner that holds it. */
export interface ReferenceExclusion {
  table: string;
  /** Column whose value identifies the owner being torn down (e.g. 'A' on a join table). */
  ownerColumn: string;
  ownerId: string;
}

@Injectable()
export class FileReferenceService implements OnModuleInit {
  private readonly logger = new Logger(FileReferenceService.name);
  private inboundColumns: Array<{ table: string; column: string }> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly filesStorageService: FilesStorageService,
  ) {}

  /**
   * Report FK columns the catalog knows about but this service has no entry for.
   *
   * Such a column still PROTECTS the file (unknown ⇒ referenced ⇒ undeletable), so
   * this is not a correctness hole — but it means a new relation has no canonical
   * folder, and the organizer will leave its files wherever they land. Surfacing it at
   * boot is how that gets noticed in days instead of in a post-mortem.
   */
  async onModuleInit(): Promise<void> {
    try {
      const columns = await this.getInboundReferenceColumns();
      const unmapped = columns
        .map(c => `${c.table}.${c.column}`)
        .filter(key => !(key in INBOUND_REFERENCES));

      if (unmapped.length > 0) {
        this.logger.warn(
          `[FileReference] ${unmapped.length} FK(s) para File.id sem mapeamento de contexto: ` +
            `${unmapped.join(', ')}. Os arquivos continuam protegidos contra exclusão, mas não ` +
            `têm pasta canônica — adicione-os em INBOUND_REFERENCES para que o organizador os arquive.`,
        );
      } else {
        this.logger.log(
          `[FileReference] ${columns.length} referências de entrada mapeadas + ` +
            `${OUTBOUND_REFERENCES.length} de saída.`,
        );
      }
    } catch (error: any) {
      this.logger.error(`[FileReference] Falha ao validar o catálogo de FKs: ${error.message}`);
    }
  }

  /**
   * Every FK column in the schema that points at File.id, read from the live catalog.
   *
   * Derived, not declared: this is the property that keeps the check from going stale.
   * Cached for the process lifetime — the schema only changes on deploy.
   */
  async getInboundReferenceColumns(
    tx?: PrismaTransaction,
  ): Promise<Array<{ table: string; column: string }>> {
    if (this.inboundColumns) return this.inboundColumns;

    const client: any = tx ?? this.prisma;
    const rows = await client.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND ccu.table_name = 'File'
        AND ccu.column_name = 'id'
    `;

    this.inboundColumns = rows
      .map(r => ({ table: r.table_name, column: r.column_name }))
      .filter(c => !DERIVED_TABLES.has(c.table));

    return this.inboundColumns;
  }

  /**
   * Everything currently using this file.
   *
   * Throws on failure rather than returning a partial list: a caller that swallowed a
   * short list would read it as "unreferenced". `hasReferences` is the forgiving
   * wrapper, and it fails closed.
   */
  async getReferences(
    fileId: string,
    options: { transaction?: PrismaTransaction; exclude?: ReferenceExclusion[] } = {},
  ): Promise<FileReference[]> {
    const client: any = options.transaction ?? this.prisma;
    const found: FileReference[] = [];

    // Outbound first — the cheap single-row read, and the one every inbound-only
    // check in this codebase's history has missed.
    const self = await client.file.findUnique({
      where: { id: fileId },
      select: Object.fromEntries(OUTBOUND_REFERENCES.map(r => [r.column, true])),
    });
    if (self) {
      for (const ref of OUTBOUND_REFERENCES) {
        if (self[ref.column]) {
          found.push({
            table: 'File',
            column: ref.column,
            context: ref.context,
            label: ref.label,
          });
        }
      }
    }

    const columns = await this.getInboundReferenceColumns(options.transaction);

    for (const { table, column } of columns) {
      // Identifiers come from the catalog, never from user input.
      let sql = `SELECT 1 FROM "${table}" WHERE "${column}" = $1`;
      const params: any[] = [fileId];

      const exclusion = options.exclude?.find(e => e.table === table);
      if (exclusion) {
        sql += ` AND "${exclusion.ownerColumn}" IS DISTINCT FROM $2`;
        params.push(exclusion.ownerId);
      }

      const hit: unknown[] = await client.$queryRawUnsafe(`${sql} LIMIT 1`, ...params);
      if (hit.length > 0) {
        const mapped = INBOUND_REFERENCES[`${table}.${column}`];
        found.push({
          table,
          column,
          context: mapped?.context ?? null,
          label: mapped?.label ?? `${table}.${column}`,
        });
      }
    }

    return found;
  }

  /**
   * Is this file in use? Fails CLOSED — any error answers "yes".
   *
   * A file we cannot prove is unused must never be deleted. That asymmetry is the whole
   * point: the cost of a false "referenced" is a file that lingers; the cost of a false
   * "unreferenced" is the June incident.
   */
  async hasReferences(
    fileId: string,
    options: { transaction?: PrismaTransaction; exclude?: ReferenceExclusion[] } = {},
  ): Promise<boolean> {
    try {
      const refs = await this.getReferences(fileId, options);
      return refs.length > 0;
    } catch (error: any) {
      this.logger.error(
        `[FileReference] Verificação de referências falhou para ${fileId}: ${error.message}. ` +
          `Tratando como REFERENCIADO (o arquivo é preservado).`,
      );
      return true;
    }
  }

  /** pt-BR summary of what is holding a file, for user-facing errors. */
  describeReferences(refs: FileReference[]): string {
    const labels = [...new Set(refs.map(r => r.label))];
    if (labels.length === 0) return '';
    if (labels.length === 1) return labels[0];
    return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`;
  }

  /**
   * The context a file's own references say it belongs to.
   *
   * This is the inversion that matters for placement: the organizer used to guess a
   * file's context from the folder it was already in, so a file misfiled into a generic
   * folder had no detectable context and was skipped forever. Asking the reference
   * instead means a file can be pulled back from ANY folder, including the ones that
   * carry no meaning.
   *
   * Returns null when nothing references the file, or when every reference is one of the
   * `context: null` kinds — in both cases there is no canonical folder and the file must
   * be left exactly where it is.
   */
  async resolveCanonicalContext(
    fileId: string,
    transaction?: PrismaTransaction,
  ): Promise<keyof FilesFolderMapping | null> {
    try {
      const refs = await this.getReferences(fileId, { transaction });
      const withContext = refs.filter(r => r.context !== null);
      if (withContext.length === 0) return null;

      const distinct = [...new Set(withContext.map(r => r.context))] as Array<
        keyof FilesFolderMapping
      >;
      if (distinct.length === 1) return distinct[0];

      // Vários contextos não significam conflito. Um mesmo arquivo é rotineiramente
      // layout de tarefa E layout de orçamento ('tasksLayouts' + 'quote-layouts'), e os
      // dois apontam para a MESMA pasta ('Layouts'). Comparar a chave do contexto trataria
      // isso como ambíguo e deixaria o arquivo parado — a auditoria de 2026-08-04 achou 19
      // arquivos exatamente nesse caso, todos presos em pasta genérica.
      //
      // O que precisa bater é o destino, não o rótulo.
      const folders = this.filesStorageService.getFolderMapping();
      const destinations = [...new Set(distinct.map(c => folders[c]))];
      if (destinations.length === 1) return distinct[0];

      // Destinos realmente diferentes: mover satisfaria um dono e quebraria o outro.
      // Preservar é a escolha segura — o arquivo continua protegido contra exclusão.
      this.logger.debug(
        `[FileReference] ${fileId} é usado por contextos com destinos distintos ` +
          `(${distinct.map(c => `${String(c)}→${folders[c]}`).join(', ')}) — mantido onde está.`,
      );
      return null;
    } catch (error: any) {
      this.logger.error(
        `[FileReference] Não foi possível resolver o contexto de ${fileId}: ${error.message}`,
      );
      return null;
    }
  }
}
