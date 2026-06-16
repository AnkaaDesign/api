import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SicrediService } from './sicredi.service';
import { SicrediAuthService } from './sicredi-auth.service';
import { SicrediWebhookService } from './sicredi-webhook.service';
import { TaskQuoteStatusCascadeService } from '@modules/production/task-quote/task-quote-status-cascade.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { BANK_SLIP_STATUS, INSTALLMENT_STATUS, INVOICE_STATUS } from '@constants';

const MAX_WEBHOOK_RETRIES = 3;
const DEFAULT_WEBHOOK_URL = 'https://api.ankaadesign.com.br/webhooks/sicredi';

/**
 * Scheduler for Sicredi boleto lifecycle management.
 *
 * Runs four daily jobs:
 * 1. Boleto Creation (6 AM) - Creates boletos for upcoming installments
 * 2. Boleto Reconciliation (10 AM) - Reconciles paid boletos from Sicredi
 * 3. Boleto Overdue Check (7 AM) - Marks overdue boletos
 * 4. Webhook Retry (11 AM) - Retries failed webhook events (up to 3 attempts)
 *
 * On startup (production only):
 * - Ensures a webhook contract is registered with Sicredi for payment events
 */
@Injectable()
export class SicrediBoletoScheduler implements OnModuleInit {
  private readonly logger = new Logger(SicrediBoletoScheduler.name);
  private isProcessingCreation = false;
  private isProcessingReconciliation = false;
  private isProcessingOverdue = false;
  private isProcessingWebhookRetry = false;
  private isProcessingDueNotifications = false;
  private isProcessingDueSync = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sicrediService: SicrediService,
    private readonly authService: SicrediAuthService,
    private readonly webhookService: SicrediWebhookService,
    private readonly cascadeService: TaskQuoteStatusCascadeService,
    private readonly configService: ConfigService,
    private readonly notificationDispatchService: NotificationDispatchService,
    private readonly events: EventEmitter2,
  ) {}

  // ─── Webhook Contract Auto-Registration ─────────────────────────────────────

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log('[WEBHOOK_CONTRACT] Skipping webhook contract check in dev mode');
      return;
    }

    // Delay slightly to allow the auth service to initialize
    setTimeout(() => this.ensureWebhookContract(), 5000);
  }

  /**
   * Ensure a webhook contract is registered with Sicredi for receiving payment events.
   * Queries existing contracts and registers/updates as needed.
   */
  private async ensureWebhookContract(): Promise<void> {
    const expectedUrl = this.configService.get<string>('SICREDI_WEBHOOK_URL', DEFAULT_WEBHOOK_URL);

    this.logger.log(`[WEBHOOK_CONTRACT] Checking webhook contract (expected URL: ${expectedUrl})`);

    try {
      const contractsRaw = await this.sicrediService.queryWebhookContracts();

      // Sicredi may return an array directly OR wrap it in { contratos:[...] } / { items:[...] }
      const contracts: any[] = Array.isArray(contractsRaw)
        ? contractsRaw
        : Array.isArray(contractsRaw?.contratos)
          ? contractsRaw.contratos
          : Array.isArray(contractsRaw?.items)
            ? contractsRaw.items
            : [];

      this.logger.log(
        `[WEBHOOK_CONTRACT] Found ${contracts.length} existing contract(s)`,
      );

      if (contracts.length > 0) {
        // Look for a contract with the correct URL and ATIVO status
        const activeMatch = contracts.find(
          (c: any) =>
            c.url === expectedUrl && c.contratoStatus === 'ATIVO' && c.urlStatus === 'ATIVO',
        );

        if (activeMatch) {
          this.logger.log(
            `[WEBHOOK_CONTRACT] Active contract already exists (id=${activeMatch.idContrato || activeMatch.id}, url=${activeMatch.url})`,
          );
          return;
        }

        // Look for any contract we can update (wrong URL, INATIVO, etc.)
        const updatable = contracts.find(
          (c: any) =>
            c.url !== expectedUrl || c.contratoStatus !== 'ATIVO' || c.urlStatus !== 'ATIVO',
        );

        if (updatable) {
          const contractId = updatable.idContrato || updatable.id;
          this.logger.log(
            `[WEBHOOK_CONTRACT] Updating contract ${contractId}: ` +
              `url=${updatable.url} → ${expectedUrl}, ` +
              `contratoStatus=${updatable.contratoStatus} → ATIVO, ` +
              `urlStatus=${updatable.urlStatus} → ATIVO`,
          );

          const result = await this.sicrediService.updateWebhookContract(contractId, {
            url: expectedUrl,
            urlStatus: 'ATIVO',
            contratoStatus: 'ATIVO',
          });

          this.logger.log(
            `[WEBHOOK_CONTRACT] Contract updated successfully: ${JSON.stringify(result)}`,
          );
          return;
        }
      }

      // No contracts exist — register a new one
      this.logger.log(
        `[WEBHOOK_CONTRACT] No matching contract found, registering new contract with URL: ${expectedUrl}`,
      );

      const result = await this.sicrediService.registerWebhookContract(expectedUrl);
      this.logger.log(
        `[WEBHOOK_CONTRACT] Contract registered successfully: ${JSON.stringify(result)}`,
      );
    } catch (error) {
      // Never crash the app if Sicredi is unreachable
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[WEBHOOK_CONTRACT] Failed to ensure webhook contract: ${message}`);
      if (error instanceof Error && error.stack) {
        this.logger.error(`[WEBHOOK_CONTRACT] Stack: ${error.stack}`);
      }
    }
  }

  // ─── Job 1: Boleto Creation ─────────────────────────────────────────────────

  @Cron('0 6 * * *', {
    name: 'sicredi-boleto-creation',
    timeZone: 'America/Sao_Paulo',
  })
  async createBoletos(): Promise<void> {
    if (this.isProcessingCreation) {
      this.logger.warn('Boleto creation already in progress, skipping');
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(
        '[BOLETO_CREATE] Skipping scheduled boleto creation in dev mode (only triggered on internal approval)',
      );
      return;
    }

    this.isProcessingCreation = true;

    try {
      this.logger.log('[BOLETO_CREATE] ====== Starting boleto creation job ======');

      // ── Recover bank slips stuck in REGISTERING ──────────────────────────────
      // A bank slip gets stuck when a Sicredi API call succeeds but the subsequent
      // DB update fails (DB connection drop, timeout, etc.).  The slip stays in
      // REGISTERING forever and is never retried by the normal flow.  Reset any
      // slip that has been REGISTERING for more than 10 minutes to ERROR so it
      // gets retried in this same job run.
      const stuckThreshold = new Date(Date.now() - 10 * 60 * 1000);
      const stuckResult = await this.prisma.bankSlip.updateMany({
        where: {
          status: BANK_SLIP_STATUS.REGISTERING,
          updatedAt: { lt: stuckThreshold },
        },
        data: {
          status: BANK_SLIP_STATUS.ERROR,
          errorMessage: 'Registro travado — redefinido automaticamente para nova tentativa',
          errorCount: { increment: 1 },
        },
      });
      if (stuckResult.count > 0) {
        this.logger.warn(
          `[BOLETO_CREATE] Recovered ${stuckResult.count} stuck REGISTERING bank slip(s) → ERROR for retry`,
        );
      }
      // ─────────────────────────────────────────────────────────────────────────

      const now = new Date();
      // Normalise to end-of-day UTC so installments stored at noon UTC on the 5th
      // day are included even though the cron fires at 09:00 UTC (06:00 SP).
      const fiveDaysFromNow = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 5, 23, 59, 59, 999),
      );
      this.logger.log(
        `[BOLETO_CREATE] Looking for installments due by ${fiveDaysFromNow.toISOString().split('T')[0]}`,
      );

      // Find installments that are PENDING, due within 5 days,
      // and either have no BankSlip or have a BankSlip with ERROR/CREATING status (< 3 retries).
      // Exclude customer configs / external withdrawals where generateBankSlip = false
      // (customer pays via transfer/PIX).
      // customPaymentText is a display-only label and does NOT affect boleto creation.
      const installments = await this.prisma.installment.findMany({
        where: {
          status: INSTALLMENT_STATUS.PENDING,
          dueDate: { lte: fiveDaysFromNow },
          AND: [
            {
              // Either a quote customerConfig or an external withdrawal backs this
              // installment — in both cases generateBankSlip must not be disabled.
              OR: [
                { customerConfig: { generateBankSlip: { not: false } } },
                { externalOperation: { generateBankSlip: { not: false } } },
              ],
            },
            {
              // H3b: never register boletos before a required NFS-e is AUTHORIZED —
              // boleto lines/seuNumero embed the NFS-e number (contract rule, mirrors
              // the readyForBoleto gate in the billing pipelines). Allowed when the
              // backer explicitly disabled NFS-e (generateInvoice=false) or when an
              // AUTHORIZED NfseDocument exists for the invoice.
              OR: [
                { customerConfig: { generateInvoice: false } },
                { externalOperation: { generateInvoice: false } },
                { invoice: { nfseDocuments: { some: { status: 'AUTHORIZED' } } } },
              ],
            },
            {
              OR: [
                { bankSlip: { is: null } },
                {
                  bankSlip: {
                    status: { in: [BANK_SLIP_STATUS.ERROR, BANK_SLIP_STATUS.CREATING] },
                    errorCount: { lt: 3 },
                  },
                },
              ],
            },
          ],
        },
        include: {
          bankSlip: true,
          invoice: {
            include: {
              customer: {
                select: {
                  id: true,
                  fantasyName: true,
                  corporateName: true,
                  cnpj: true,
                  cpf: true,
                  address: true,
                  city: true,
                  state: true,
                  zipCode: true,
                  phones: true,
                  email: true,
                },
              },
              task: {
                select: {
                  id: true,
                  name: true,
                  serialNumber: true,
                  truck: {
                    select: {
                      plate: true,
                      chassisNumber: true,
                      category: true,
                      implementType: true,
                    },
                  },
                },
              },
              // The boleto's seuNumero AND informativo must reference the SAME, CURRENT NF.
              // Pick the LAST not-yet-cancelled emitted note (highest número): when a note was
              // cancelled and re-emitted, the latest valid one wins — never a cancelled attempt.
              nfseDocuments: {
                where: { nfseNumber: { not: null }, status: { not: 'CANCELLED' } },
                select: { elotechNfseId: true, nfseNumber: true },
                orderBy: { nfseNumber: 'desc' },
                take: 1,
              },
              customerConfig: {
                select: {
                  generateInvoice: true,
                  orderNumber: true,
                  customerId: true,
                  quote: {
                    select: {
                      services: {
                        select: { description: true, invoiceToCustomerId: true },
                        orderBy: { position: 'asc' },
                      },
                    },
                  },
                },
              },
              externalOperation: {
                select: {
                  id: true,
                  generateInvoice: true,
                  services: {
                    select: { description: true },
                    orderBy: { position: 'asc' },
                  },
                  items: {
                    select: {
                      withdrawedQuantity: true,
                      item: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });

      this.logger.log(
        `[BOLETO_CREATE] Found ${installments.length} installment(s) needing boleto creation`,
      );

      if (installments.length > 0) {
        this.logger.log(`[BOLETO_CREATE] Installments detail:`);
        for (const inst of installments) {
          this.logger.log(
            `[BOLETO_CREATE]   - id=${inst.id}, amount=${inst.amount}, dueDate=${inst.dueDate}, ` +
              `bankSlip=${inst.bankSlip ? `status=${inst.bankSlip.status}, errorCount=${inst.bankSlip.errorCount}` : 'NONE'}, ` +
              `customer=${inst.invoice?.customer?.fantasyName || 'N/A'} (${inst.invoice?.customer?.cnpj || 'N/A'}), ` +
              `task=${inst.invoice?.task?.name || 'N/A'} #${inst.invoice?.task?.serialNumber || 'N/A'}`,
          );
        }
      }

      let created = 0;
      let errors = 0;

      const { codigoBeneficiario } = this.authService.config;
      this.logger.log(
        `[BOLETO_CREATE] Sicredi config: codigoBeneficiario=${codigoBeneficiario}, apiUrl=${this.authService.config.apiUrl}`,
      );

      for (const installment of installments) {
        try {
          // ── Atomic claim: prevent concurrent processing ────────────
          // Transition from CREATING/ERROR → REGISTERING atomically.
          // If another process already claimed it, skip.
          if (installment.bankSlip) {
            const claimed = await this.prisma.bankSlip.updateMany({
              where: {
                id: installment.bankSlip.id,
                status: { in: [BANK_SLIP_STATUS.CREATING, BANK_SLIP_STATUS.ERROR] },
              },
              data: { status: BANK_SLIP_STATUS.REGISTERING },
            });

            if (claimed.count === 0) {
              this.logger.warn(
                `[BOLETO_CREATE] BankSlip ${installment.bankSlip.id} already claimed by another process (status=${installment.bankSlip.status}), skipping`,
              );
              continue;
            }
          }

          const customer = installment.invoice?.customer;
          if (!customer) {
            this.logger.warn(
              `[BOLETO_CREATE] Installment ${installment.id} has no customer, skipping`,
            );
            if (installment.bankSlip) {
              await this.prisma.bankSlip.update({
                where: { id: installment.bankSlip.id },
                data: { status: BANK_SLIP_STATUS.ERROR, errorMessage: 'No customer linked' },
              });
            }
            continue;
          }

          // ── Customer data validation ──────────────────────────────────
          const cleanCnpj = (customer.cnpj || '').replace(/\D/g, '');
          const cleanCpf = (customer.cpf || '').replace(/\D/g, '');
          const customerDocument = cleanCnpj.length === 14 ? cleanCnpj : cleanCpf;
          const tipoPessoa = cleanCnpj.length === 14 ? 'PESSOA_JURIDICA' : 'PESSOA_FISICA';
          const customerName = customer.corporateName || customer.fantasyName || '';

          if ((customerDocument.length !== 14 && customerDocument.length !== 11) || !customerName) {
            const validationMsg = `Customer "${customer.fantasyName || customer.id}" has invalid document (CNPJ=${cleanCnpj}, CPF=${cleanCpf}) or missing name`;
            this.logger.error(
              `[BOLETO_CREATE] ${validationMsg} — skipping installment ${installment.id}`,
            );

            if (installment.bankSlip) {
              await this.prisma.bankSlip.update({
                where: { id: installment.bankSlip.id },
                data: {
                  status: BANK_SLIP_STATUS.ERROR,
                  errorMessage: `Validation failed: ${validationMsg}`,
                  errorCount: { increment: 1 },
                },
              });
            } else {
              await this.prisma.bankSlip.create({
                data: {
                  installmentId: installment.id,
                  nossoNumero: `ERR-${installment.id.slice(0, 8)}`,
                  type: 'NORMAL',
                  amount: installment.amount,
                  dueDate: installment.dueDate,
                  status: BANK_SLIP_STATUS.ERROR,
                  errorMessage: `Validation failed: ${validationMsg}`,
                  errorCount: 1,
                },
              });
            }
            errors++;
            continue;
          }
          // ── End customer data validation ──────────────────────────────

          const dueDate = new Date(installment.dueDate);
          // Sicredi rejects past due dates — clamp to today (São Paulo) if needed
          const nowSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
          nowSP.setHours(0, 0, 0, 0);
          const effectiveDueDate = dueDate < nowSP ? nowSP : dueDate;
          const formattedDueDate = `${effectiveDueDate.getFullYear()}-${String(effectiveDueDate.getMonth() + 1).padStart(2, '0')}-${String(effectiveDueDate.getDate()).padStart(2, '0')}`;

          this.logger.log(
            `[BOLETO_CREATE] Creating boleto for installment ${installment.id}: ` +
              `customer=${customer.fantasyName}, document=${customerDocument} (${tipoPessoa}), amount=${installment.amount}, dueDate=${formattedDueDate}`,
          );

          // Create boleto via Sicredi API
          const boletoResponse = await this.sicrediService.createBoleto({
            codigoBeneficiario,
            tipoCobranca: 'NORMAL',
            pagador: {
              tipoPessoa,
              documento: customerDocument,
              nome: customerName,
              endereco: customer.address || undefined,
              cidade: customer.city || undefined,
              uf: customer.state || undefined,
              cep: customer.zipCode?.replace(/\D/g, '') || undefined,
              telefone: customer.phones?.[0]?.replace(/\D/g, '') || undefined,
              email: customer.email || undefined,
            },
            especieDocumento: 'DUPLICATA_MERCANTIL_INDICACAO',
            seuNumero: this.buildSeuNumero(installment),
            informativos: this.buildBoletoLines(installment),
            dataVencimento: formattedDueDate,
            valor: Number(installment.amount.toFixed(2)),
          });

          // Download PDF
          let pdfBuffer: Buffer | null = null;
          try {
            pdfBuffer = await this.sicrediService.downloadBoletoPdf(boletoResponse.linhaDigitavel);
          } catch (pdfError) {
            this.logger.warn(
              `Failed to download PDF for boleto ${boletoResponse.nossoNumero}: ${pdfError}`,
            );
          }

          // Get the QR code from either field name the API might return
          const pixQrCode = boletoResponse.qrCode || boletoResponse.codigoQrCode || null;

          // Store PDF if downloaded
          let pdfFileId: string | null = null;
          if (pdfBuffer) {
            try {
              const fs = await import('node:fs/promises');
              const path = await import('node:path');
              const uploadDir = path.join(process.cwd(), 'uploads', 'boleto');
              await fs.mkdir(uploadDir, { recursive: true });
              const filename = `boleto-${boletoResponse.nossoNumero}.pdf`;
              const filePath = path.join(uploadDir, filename);
              await fs.writeFile(filePath, pdfBuffer);
              const file = await this.prisma.file.create({
                data: {
                  filename,
                  originalName: filename,
                  path: filePath,
                  mimetype: 'application/pdf',
                  size: pdfBuffer.length,
                },
              });
              pdfFileId = file.id;
              this.logger.log(
                `[BOLETO_CREATE] PDF stored: ${filePath} (${pdfBuffer.length} bytes)`,
              );
            } catch (pdfStoreError) {
              this.logger.warn(
                `[BOLETO_CREATE] Failed to store PDF for boleto ${boletoResponse.nossoNumero}: ${pdfStoreError}`,
              );
            }
          }

          // Upsert BankSlip record
          const seuNumero = this.buildSeuNumero(installment);
          if (installment.bankSlip) {
            await this.prisma.bankSlip.update({
              where: { id: installment.bankSlip.id },
              data: {
                nossoNumero: boletoResponse.nossoNumero,
                seuNumero,
                barcode: boletoResponse.codigoBarras,
                digitableLine: boletoResponse.linhaDigitavel,
                pixQrCode,
                txid: boletoResponse.txid || null,
                status: BANK_SLIP_STATUS.ACTIVE,
                errorMessage: null,
                errorCount: 0,
                lastSyncAt: new Date(),
                ...(pdfFileId && { pdfFileId }),
              },
            });
          } else {
            await this.prisma.bankSlip.create({
              data: {
                installmentId: installment.id,
                nossoNumero: boletoResponse.nossoNumero,
                seuNumero,
                barcode: boletoResponse.codigoBarras,
                digitableLine: boletoResponse.linhaDigitavel,
                pixQrCode,
                txid: boletoResponse.txid || null,
                type: 'NORMAL',
                amount: installment.amount,
                dueDate: installment.dueDate,
                status: BANK_SLIP_STATUS.ACTIVE,
                lastSyncAt: new Date(),
                ...(pdfFileId && { pdfFileId }),
              },
            });
          }

          created++;
          this.logger.log(
            `[BOLETO_CREATE] Boleto created for installment ${installment.id}: ` +
              `nossoNumero=${boletoResponse.nossoNumero}, codigoBarras=${boletoResponse.codigoBarras}, ` +
              `pixQrCode=${pixQrCode ? 'YES' : 'NO'}, txid=${boletoResponse.txid || 'N/A'}`,
          );

          // Notify (LOW) that a boleto was registered and is now ACTIVE at Sicredi.
          if (installment.invoice?.id) {
            await this.dispatchBankSlipCreatedNotification(
              installment.invoice.id,
              boletoResponse.nossoNumero,
              Number(installment.amount),
              new Date(installment.dueDate),
            );
          }
        } catch (error) {
          errors++;
          const errorMessage = error instanceof Error ? error.message : String(error);

          this.logger.error(
            `[BOLETO_CREATE] Failed to create boleto for installment ${installment.id}: ${errorMessage}`,
          );
          if (error instanceof Error && error.stack) {
            this.logger.error(`[BOLETO_CREATE] Stack: ${error.stack}`);
          }
          // Log the full error response if it's an HTTP error
          if ((error as any)?.response?.data) {
            this.logger.error(
              `[BOLETO_CREATE] Sicredi response: ${JSON.stringify((error as any).response.data)}`,
            );
          }

          // Update or create BankSlip with ERROR status
          if (installment.bankSlip) {
            await this.prisma.bankSlip.update({
              where: { id: installment.bankSlip.id },
              data: {
                status: BANK_SLIP_STATUS.ERROR,
                errorMessage,
                errorCount: { increment: 1 },
              },
            });
          } else {
            await this.prisma.bankSlip.create({
              data: {
                installmentId: installment.id,
                nossoNumero: `ERR-${installment.id.slice(0, 8)}`,
                type: 'NORMAL',
                amount: installment.amount,
                dueDate: installment.dueDate,
                status: BANK_SLIP_STATUS.ERROR,
                errorMessage,
                errorCount: 1,
              },
            });
          }
        }
      }

      this.logger.log(
        `[BOLETO_CREATE] ====== Boleto creation job completed. Created: ${created}, Errors: ${errors} ======`,
      );

      // ── Check for permanently failed boletos (errorCount >= 3) ────
      try {
        const permanentlyFailed = await this.prisma.bankSlip.findMany({
          where: {
            status: BANK_SLIP_STATUS.ERROR,
            errorCount: { gte: 3 },
          },
          include: {
            installment: {
              include: {
                invoice: {
                  include: {
                    customer: {
                      select: { id: true, fantasyName: true },
                    },
                  },
                },
              },
            },
          },
        });

        if (permanentlyFailed.length > 0) {
          this.logger.warn(
            `[BOLETO_CREATE] WARNING: ${permanentlyFailed.length} boleto(s) have permanently failed (errorCount >= 3). Manual intervention required.`,
          );
          for (const slip of permanentlyFailed) {
            const custName = slip.installment?.invoice?.customer?.fantasyName || 'Unknown';
            const instId = slip.installment?.id || 'N/A';
            this.logger.warn(
              `[BOLETO_CREATE]   - BankSlip=${slip.id}, installmentId=${instId}, customer="${custName}", errorCount=${slip.errorCount}, lastError="${slip.errorMessage || 'N/A'}"`,
            );

            // Notify FINANCIAL/ADMIN that this boleto permanently failed to register
            // at Sicredi (errorCount >= 3) and needs manual intervention. Guard against
            // re-notifying: only emit when the failure was reached in this run is not
            // tracked — we emit best-effort per slip; downstream config dedupes by entity.
            if (slip.installment?.invoice?.id) {
              await this.dispatchBankSlipRegistrationFailedNotification(
                slip.installment.invoice.id,
                slip.id,
                slip.errorMessage,
              );
            }
          }
        }
      } catch (summaryError) {
        this.logger.error(
          `[BOLETO_CREATE] Failed to query permanently failed boletos: ${summaryError}`,
        );
      }
    } catch (error) {
      this.logger.error(`[BOLETO_CREATE] Fatal error during boleto creation job: ${error}`);
      if (error instanceof Error) this.logger.error(`[BOLETO_CREATE] Stack: ${error.stack}`);
    } finally {
      this.isProcessingCreation = false;
    }
  }

  /**
   * Build the seuNumero field for a Sicredi boleto.
   * Priority: NfSe number (if enabled + authorized) → truck plate → installment ID fragment.
   * Max 10 alphanumeric chars per API spec.
   * The installment number is always embedded so each boleto on the same invoice
   * has a unique seuNumero even when they share the same NFSe or truck plate.
   */
  private buildSeuNumero(installment: any): string {
    // Withdrawal-backed invoices carry the NFS-e flag on the withdrawal itself;
    // task-backed invoices carry it on the customer config.
    const generateInvoice = installment.invoice?.externalOperationId
      ? installment.invoice?.externalOperation?.generateInvoice !== false
      : installment.invoice?.customerConfig?.generateInvoice !== false;
    const authorizedNfse = installment.invoice?.nfseDocuments?.[0];
    const truckPlate = installment.invoice?.task?.truck?.plate;
    // Installment numbers are 1-7 (single digit) — always 1 char.
    const num = String(installment.number ?? 1);

    if (generateInvoice && authorizedNfse?.nfseNumber) {
      // NF + last 8 digits of NFS-e number = 10 chars max. No installment suffix —
      // matches invoice-generation.service.ts so seuNumero is consistent on initial
      // registration and scheduler retries.
      const nfseStr = String(authorizedNfse.nfseNumber).slice(-(10 - 2));
      return `NF${nfseStr}`;
    }
    if (truckPlate) {
      const plateClean = truckPlate.replace(/[^A-Za-z0-9]/g, '');
      return (plateClean.slice(0, 10 - num.length) + num).slice(0, 10);
    }
    // UUID fragment is already unique per installment — no suffix needed.
    return installment.id.replace(/-/g, '').substring(0, 10);
  }

  /**
   * Build informativo lines for a Sicredi boleto (INFORMATIVO box on PDF).
   * Format matches the NfSe discriminacao.
   */
  private buildInformativo(installment: any): string[] | undefined {
    return this.buildBoletoLines(installment);
  }

  /**
   * Shared line builder for informativo and mensagem fields.
   * Up to 5 lines of ≤ 80 chars each.
   */
  /**
   * Shared line builder used for both informativos and mensagens fields.
   * Returns up to 5 structured lines of ≤80 chars, or undefined if no content.
   *
   * Output format (each item = one line in the boleto PDF):
   *   Pedido: 4564619 - NF 3039
   *   Veiculo: Caminhao / Carga Seca
   *   Serie: 456489 | Placa: RHN8D02 | Chassi: AS451620151A65155
   *   Pintura Parcial
   */
  private buildBoletoLines(installment: any): string[] | undefined {
    const parts: string[] = [];

    const authorizedNfse = installment.invoice?.nfseDocuments?.[0];

    // External-operation-backed invoice ("Operação Externa"): no truck/order — lines are
    // the NF number (when authorized) followed by service descriptions and item lines.
    const withdrawal = installment.invoice?.externalOperation;
    if (installment.invoice?.externalOperationId && withdrawal) {
      if (authorizedNfse?.nfseNumber) {
        parts.push(`NF ${authorizedNfse.nfseNumber}`);
      }

      const descriptions: string[] = [
        ...((withdrawal.services ?? []) as any[]).map((s: any) => s.description as string),
        ...((withdrawal.items ?? []) as any[]).map(
          (i: any) => `${i.item?.name ?? 'Item'} - ${i.withdrawedQuantity} un`,
        ),
      ];
      if (descriptions.length > 0 && descriptions[0]) {
        descriptions[0] = descriptions[0].charAt(0).toUpperCase() + descriptions[0].slice(1);
      }
      const remainingEw = 5 - parts.length;
      if (descriptions.length > 0 && remainingEw > 0) {
        parts.push(...this.buildServiceLines(descriptions, remainingEw, 80));
      }

      this.logger.log(
        `[BOLETO_INFORMATIVO] (withdrawal) lines=${parts.length} content=${JSON.stringify(parts)}`,
      );
      return parts.length > 0 ? parts : undefined;
    }

    const orderNumber = installment.invoice?.customerConfig?.orderNumber;
    const task = installment.invoice?.task;
    const truck = task?.truck;
    const customerId = installment.invoice?.customerConfig?.customerId;

    // Line 1: "Pedido: XXXXX - NF YYYY"
    const nfPart = authorizedNfse?.nfseNumber ? `NF ${authorizedNfse.nfseNumber}` : null;
    const pedidoPart = orderNumber ? `Pedido: ${orderNumber}` : null;
    if (pedidoPart && nfPart) {
      parts.push(`${pedidoPart} - ${nfPart}`);
    } else if (pedidoPart) {
      parts.push(pedidoPart);
    } else if (nfPart) {
      parts.push(nfPart);
    }

    // Lines 2-3: Vehicle description
    // Line 2: "Referente aos servicos no veiculo Caminhao Carga Seca"
    // Line 3: "N.º serie: X, chassi: Z" or "Placa: Y, chassi: Z"
    const category = this.translateTruckCategory(truck?.category);
    const implement = this.translateImplementType(truck?.implementType);
    const vehicleType = [category, implement].filter(Boolean).join(' ');

    const identifiers: string[] = [];
    if (task?.serialNumber) identifiers.push(`N.º serie: ${task.serialNumber}`);
    else if (truck?.plate) identifiers.push(`Placa: ${truck.plate}`);
    if (task?.serialNumber && truck?.plate) identifiers.push(`placa: ${truck.plate}`);
    if (truck?.chassisNumber) identifiers.push(`chassi: ${truck.chassisNumber}`);
    const idStr = identifiers.join(', ');

    if (vehicleType || idStr) {
      parts.push(`Referente aos servicos no veiculo ${vehicleType}`.trimEnd().substring(0, 80));
      if (idStr) parts.push(idStr.substring(0, 80));
    }

    // Remaining lines: services for this customer (first letter uppercase)
    const allServices: any[] = installment.invoice?.customerConfig?.quote?.services || [];
    const services = allServices.filter(
      (s: any) => !s.invoiceToCustomerId || s.invoiceToCustomerId === customerId,
    );
    const remaining = 5 - parts.length;
    if (services.length > 0 && remaining > 0) {
      const descriptions = services.map((s: any) => s.description as string);
      if (descriptions.length > 0 && descriptions[0]) {
        descriptions[0] = descriptions[0].charAt(0).toUpperCase() + descriptions[0].slice(1);
      }
      const serviceLines = this.buildServiceLines(descriptions, remaining, 80);
      parts.push(...serviceLines);
    }

    this.logger.log(`[BOLETO_INFORMATIVO] lines=${parts.length} content=${JSON.stringify(parts)}`);
    return parts.length > 0 ? parts : undefined;
  }

  /** Pack service descriptions into at most maxLines lines, each ≤ maxChars chars. */
  private buildServiceLines(descriptions: string[], maxLines: number, maxChars: number): string[] {
    const lines: string[] = [];
    let current = '';
    for (const desc of descriptions) {
      if (lines.length >= maxLines) break;
      const item = desc.substring(0, maxChars);
      if (current === '') {
        current = item;
      } else if (current.length + 2 + item.length <= maxChars) {
        current += `, ${item}`;
      } else {
        lines.push(current);
        if (lines.length >= maxLines) break;
        current = item;
      }
    }
    if (current && lines.length < maxLines) {
      lines.push(current);
    }
    return lines;
  }

  private translateTruckCategory(category?: string | null): string | null {
    const map: Record<string, string> = {
      MINI: 'Mini',
      VUC: 'VUC',
      THREE_QUARTER: '3/4',
      RIGID: 'Toco',
      TRUCK: 'Truck',
      SEMI_TRAILER: 'Semirreboque',
      SEMI_TRAILER_2_AXLES: 'Semirreboque 2 Eixos',
      B_DOUBLE_FRONT: 'Bitrem Compartimento Frontal',
      B_DOUBLE_REAR: 'Bitrem Compartimento Traseiro',
      BITRUCK: 'Bitruck',
    };
    return category ? (map[category] ?? category) : null;
  }

  private translateImplementType(implement?: string | null): string | null {
    const map: Record<string, string> = {
      DRY_CARGO: 'Carga Seca',
      REFRIGERATED: 'Refrigerado',
      INSULATED: 'Isoplastic',
      CURTAIN_SIDE: 'Sider',
      TANK: 'Tanque',
      FLATBED: 'Carroceria',
    };
    return implement ? (map[implement] ?? implement) : null;
  }

  // ─── Job 2: Boleto Reconciliation ───────────────────────────────────────────

  @Cron('0 10 * * *', {
    name: 'sicredi-boleto-reconciliation',
    timeZone: 'America/Sao_Paulo',
  })
  async reconcileBoletos(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log('[BOLETO_RECONCILE] Skipping boleto reconciliation in dev mode');
      return;
    }

    // Check the last 14 days — covers API downtime up to 2 weeks and weekend gaps.
    // Previously 3 days, which was insufficient when the API restarted after extended downtime.
    const toDate = new Date();
    toDate.setDate(toDate.getDate() - 1); // Yesterday (payments settle overnight)
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 14);

    try {
      const result = await this.runReconciliationForRange(fromDate, toDate, '[BOLETO_RECONCILE]');
      this.logger.log(
        `[BOLETO_RECONCILE] Scheduled reconciliation completed. Reconciled: ${result.reconciled}/${result.total} across ${result.datesChecked.length} days`,
      );
    } catch (error) {
      if ((error as Error).message === 'Reconciliation already in progress') {
        this.logger.warn('[BOLETO_RECONCILE] Skipping: another reconciliation is already running');
      } else {
        this.logger.error('[BOLETO_RECONCILE] Error during boleto reconciliation job:', error);
      }
    }
  }

  /**
   * Manually trigger boleto reconciliation for an explicit date range.
   * Called from the admin API endpoint — safe to run concurrently with retries
   * because it shares the same in-progress guard as the scheduled job.
   *
   * @param fromDate Start of range (inclusive). Defaults to 14 days ago.
   * @param toDate   End of range (inclusive). Defaults to yesterday.
   */
  async triggerManualReconciliation(
    fromDate?: Date,
    toDate?: Date,
  ): Promise<{ reconciled: number; total: number; datesChecked: string[] }> {
    const end = toDate ?? (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; })();
    const start = fromDate ?? (() => { const d = new Date(); d.setDate(d.getDate() - 14); return d; })();

    this.logger.log(
      `[RECONCILE_MANUAL] Triggered for range ${start.toISOString().split('T')[0]} → ${end.toISOString().split('T')[0]}`,
    );

    const result = await this.runReconciliationForRange(start, end, '[RECONCILE_MANUAL]');

    // After reconciling payments, also sync due dates and seuNumero from Sicredi.
    // This ensures that any due-date changes made directly in Sicredi's portal are
    // immediately reflected in our installments and quote statuses — not just during
    // the nightly 9 AM cron.
    // Skip if the scheduled 9 AM sync is already running to avoid concurrent API flood.
    if (!this.isProcessingDueSync) {
      this.runSyncAllActiveBankSlips()
        .then(r =>
          this.logger.log(
            `[RECONCILE_MANUAL] Post-reconciliation sync done — checked: ${r.checked}, due-date changes: ${r.dueDateChanges}, seuNumero changes: ${r.seuNumeroChanges}, errors: ${r.errors}`,
          ),
        )
        .catch(err =>
          this.logger.error(`[RECONCILE_MANUAL] Post-reconciliation date sync failed: ${err}`),
        );
    } else {
      this.logger.log(
        '[RECONCILE_MANUAL] Scheduled 9 AM sync already in progress — skipping post-reconciliation date sync',
      );
    }

    return result;
  }

  /**
   * Core reconciliation logic shared by the scheduled job and manual trigger.
   * Iterates day-by-day over the given range, queries Sicredi for paid boletos,
   * and updates local records. Guarded by isProcessingReconciliation to prevent
   * concurrent runs (scheduled + manual cannot overlap).
   */
  /**
   * Parse Sicredi date strings from the reconciliation API.
   * Handles both dd/MM/yyyy (returned by /liquidados/dia) and ISO 8601.
   * Returns null if the value cannot be parsed.
   */
  private parseSicrediDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    // dd/MM/yyyy — used by some Sicredi endpoints
    const ddmmyyyy = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
      return new Date(`${yyyy}-${mm}-${dd}T00:00:00-03:00`);
    }
    // "yyyy-MM-dd HH:mm:ss" — used by /liquidados/dia (space-separated, no T/Z)
    const spaceTs = value.match(/^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2}$/);
    if (spaceTs) {
      return new Date(`${spaceTs[1]}T00:00:00-03:00`);
    }
    // ISO 8601 or any other parseable format
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  private async runReconciliationForRange(
    fromDate: Date,
    toDate: Date,
    logPrefix: string,
  ): Promise<{ reconciled: number; total: number; datesChecked: string[] }> {
    if (this.isProcessingReconciliation) {
      throw new Error('Reconciliation already in progress');
    }

    this.isProcessingReconciliation = true;

    try {
      this.logger.log(`${logPrefix} Starting reconciliation...`);

      const seenNossoNumeros = new Set<string>();
      const paidBoletos: Array<import('./dto').PaidBoletoDto> = [];
      const datesChecked: string[] = [];

      // Walk day-by-day from fromDate to toDate (inclusive)
      const current = new Date(fromDate);
      current.setHours(0, 0, 0, 0);
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);

      while (current <= end) {
        const formattedDate = `${String(current.getDate()).padStart(2, '0')}/${String(current.getMonth() + 1).padStart(2, '0')}/${current.getFullYear()}`;
        datesChecked.push(formattedDate);

        try {
          const dailyPaid = await this.sicrediService.queryPaidBoletos(formattedDate);
          this.logger.log(
            `${logPrefix} Found ${dailyPaid.length} paid boleto(s) from ${formattedDate}`,
          );

          for (const boleto of dailyPaid) {
            if (!seenNossoNumeros.has(boleto.nossoNumero)) {
              seenNossoNumeros.add(boleto.nossoNumero);
              paidBoletos.push(boleto);
            }
          }
        } catch (dayError) {
          this.logger.error(
            `${logPrefix} Failed to query paid boletos for ${formattedDate}: ${dayError}`,
          );
          // Continue to next day — one day's API failure must not abort the entire range
        }

        current.setDate(current.getDate() + 1);
      }

      this.logger.log(
        `${logPrefix} Total unique paid boletos across ${datesChecked.length} day(s): ${paidBoletos.length}`,
      );

      let reconciled = 0;

      for (const paidBoleto of paidBoletos) {
        try {
          const bankSlip = await this.prisma.bankSlip.findUnique({
            where: { nossoNumero: paidBoleto.nossoNumero },
            include: { installment: { include: { invoice: true } } },
          });

          if (!bankSlip) {
            this.logger.warn(
              `${logPrefix} No BankSlip found for nossoNumero=${paidBoleto.nossoNumero}, skipping`,
            );
            continue;
          }

          if (bankSlip.status === BANK_SLIP_STATUS.PAID) {
            this.logger.log(`${logPrefix} BankSlip ${bankSlip.id} already PAID, skipping`);
            continue;
          }

          // Sicredi /liquidados/dia uses different field names than expected by the DTO:
          //   Amount: valorLiquidado (actual) | valorLiquidacao | valor
          //   Date:   dataPagamento (actual) | dataLiquidacao | dataCredito
          const rawAmount =
            (paidBoleto as any).valorLiquidado ??
            paidBoleto.valorLiquidacao ??
            (paidBoleto as any).valor;
          const paidAmount = rawAmount != null ? Number(rawAmount) : undefined;
          const rawDate =
            (paidBoleto as any).dataPagamento ??
            paidBoleto.dataLiquidacao ??
            (paidBoleto as any).dataCredito;
          const paidAt = this.parseSicrediDate(rawDate);

          if (!paidAt) {
            this.logger.warn(
              `${logPrefix} Cannot parse paidAt for nossoNumero=${paidBoleto.nossoNumero} ` +
              `(dataLiquidacao=${paidBoleto.dataLiquidacao}, raw=${JSON.stringify(paidBoleto)}), skipping`,
            );
            continue;
          }

          const invoiceId = bankSlip.installment?.invoice?.id;

          await this.prisma.$transaction(async tx => {
            await tx.bankSlip.update({
              where: { id: bankSlip.id },
              data: {
                status: BANK_SLIP_STATUS.PAID,
                ...(paidAmount != null && { paidAmount }),
                paidAt,
                lastSyncAt: new Date(),
              },
            });

            if (bankSlip.installment) {
              await tx.installment.update({
                where: { id: bankSlip.installment.id },
                data: {
                  status: INSTALLMENT_STATUS.PAID,
                  ...(paidAmount != null && { paidAmount }),
                  paidAt,
                  paymentMethod: 'BANK_SLIP',
                },
              });
            }

            if (invoiceId) {
              await this.updateInvoiceStatusTx(tx, invoiceId);
            }
          });

          if (invoiceId) {
            await this.cascadeService.cascadeFromInvoice(invoiceId);
          }

          await this.dispatchBankSlipPaidNotification(
            bankSlip.id,
            invoiceId,
            paidAmount ?? 0,
            bankSlip.dueDate,
          );

          // Bridge to bank-statement reconciliation (OFX-imported transactions)
          this.events.emit('banking.bankslip.paid', {
            bankSlipId: bankSlip.id,
            paidAt,
            paidAmount: paidAmount ?? 0,
          });

          reconciled++;
          this.logger.log(
            `${logPrefix} Reconciled boleto ${paidBoleto.nossoNumero} - paid ${paidAmount ?? 'N/A'} on ${paidAt.toISOString()}`,
          );
        } catch (error) {
          this.logger.error(
            `${logPrefix} Failed to reconcile boleto ${paidBoleto.nossoNumero}: ${error}`,
          );
        }
      }

      this.logger.log(
        `${logPrefix} Reconciliation completed. Reconciled: ${reconciled}/${paidBoletos.length}`,
      );

      return { reconciled, total: paidBoletos.length, datesChecked };
    } finally {
      this.isProcessingReconciliation = false;
    }
  }

  // ─── Job 3: Boleto Overdue Check ───────────────────────────────────────────

  @Cron('0 7 * * *', {
    name: 'sicredi-boleto-overdue-check',
    timeZone: 'America/Sao_Paulo',
  })
  async checkOverdueBoletos(): Promise<void> {
    if (this.isProcessingOverdue) {
      this.logger.warn('Boleto overdue check already in progress, skipping');
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      this.logger.log('Skipping boleto overdue check in dev mode');
      return;
    }

    this.isProcessingOverdue = true;

    try {
      this.logger.log('Starting boleto overdue check...');

      // Compute SP-midnight (UTC-3) expressed as a UTC Date.
      // Brazil abolished DST in 2019, so SP is a constant UTC-3 year-round.
      // toLocaleString with en-CA yields "YYYY-MM-DD" in SP wall-clock time.
      const SP_OFFSET = '-03:00';
      const spDateParts = new Date().toLocaleString('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const today = new Date(`${spDateParts}T00:00:00${SP_OFFSET}`);

      // Find ACTIVE bank slips with dueDate before today
      const overdueBankSlips = await this.prisma.bankSlip.findMany({
        where: {
          status: BANK_SLIP_STATUS.ACTIVE,
          dueDate: { lt: today },
        },
        include: {
          installment: {
            include: {
              invoice: true,
            },
          },
        },
      });

      this.logger.log(`Found ${overdueBankSlips.length} overdue bank slip(s)`);

      let updated = 0;

      for (const bankSlip of overdueBankSlips) {
        try {
          // Update BankSlip to OVERDUE
          await this.prisma.bankSlip.update({
            where: { id: bankSlip.id },
            data: { status: BANK_SLIP_STATUS.OVERDUE },
          });

          // Update Installment to OVERDUE
          if (bankSlip.installment) {
            await this.prisma.installment.update({
              where: { id: bankSlip.installment.id },
              data: { status: INSTALLMENT_STATUS.OVERDUE },
            });

            // Update Invoice status and cascade to TaskQuote
            if (bankSlip.installment.invoice) {
              await this.updateInvoiceStatus(bankSlip.installment.invoice.id);
              await this.cascadeService.cascadeFromInvoice(bankSlip.installment.invoice.id);

              // Notify FINANCIAL/ADMIN that the boleto is now overdue.
              await this.dispatchBankSlipOverdueNotification(
                bankSlip.installment.invoice.id,
                bankSlip.id,
                bankSlip.nossoNumero,
                bankSlip.dueDate,
                Number(bankSlip.amount),
              );
            }
          }

          updated++;
        } catch (error) {
          this.logger.error(`Failed to update overdue bank slip ${bankSlip.id}: ${error}`);
        }
      }

      this.logger.log(
        `Boleto overdue check completed. Updated: ${updated}/${overdueBankSlips.length}`,
      );
    } catch (error) {
      this.logger.error('Error during boleto overdue check:', error);
    } finally {
      this.isProcessingOverdue = false;
    }
  }

  // ─── Job 4: Webhook Event Retry ─────────────────────────────────────────────

  @Cron('0 11 * * *', {
    name: 'sicredi-webhook-retry',
    timeZone: 'America/Sao_Paulo',
  })
  async retryFailedWebhookEvents(): Promise<void> {
    if (this.isProcessingWebhookRetry) {
      this.logger.warn('[WEBHOOK_RETRY] Webhook retry already in progress, skipping');
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      this.logger.log('[WEBHOOK_RETRY] Skipping webhook retry in dev mode');
      return;
    }

    this.isProcessingWebhookRetry = true;

    try {
      this.logger.log('[WEBHOOK_RETRY] ====== Starting webhook retry job ======');

      // Find all FAILED webhook events that haven't exceeded the retry limit
      const failedEvents = await this.prisma.sicrediWebhookEvent.findMany({
        where: {
          status: 'FAILED',
          retryCount: { lt: MAX_WEBHOOK_RETRIES },
        },
        orderBy: { createdAt: 'asc' },
      });

      this.logger.log(
        `[WEBHOOK_RETRY] Found ${failedEvents.length} failed event(s) eligible for retry`,
      );

      if (failedEvents.length === 0) {
        this.logger.log('[WEBHOOK_RETRY] ====== No events to retry ======');
        return;
      }

      let retried = 0;
      let succeeded = 0;
      let failed = 0;

      for (const event of failedEvents) {
        retried++;
        this.logger.log(
          `[WEBHOOK_RETRY] Retrying event ${event.idEventoWebhook} ` +
            `(nossoNumero=${event.nossoNumero}, movimento=${event.movimento}, ` +
            `retryCount=${event.retryCount}, lastError="${event.errorMessage || 'N/A'}")`,
        );

        const result = await this.webhookService.retryFailedEvent(event.id);

        if (result.success) {
          succeeded++;
          this.logger.log(`[WEBHOOK_RETRY] Event ${event.idEventoWebhook} succeeded on retry`);
        } else {
          failed++;
          this.logger.warn(
            `[WEBHOOK_RETRY] Event ${event.idEventoWebhook} failed again: ${result.error}`,
          );
        }
      }

      this.logger.log(
        `[WEBHOOK_RETRY] ====== Webhook retry job completed. ` +
          `Retried: ${retried}, Succeeded: ${succeeded}, Failed: ${failed} ======`,
      );

      // Check for events that have now exhausted all retries
      const exhaustedEvents = await this.prisma.sicrediWebhookEvent.findMany({
        where: {
          status: 'FAILED',
          retryCount: { gte: MAX_WEBHOOK_RETRIES },
        },
      });

      if (exhaustedEvents.length > 0) {
        this.logger.error(
          `[WEBHOOK_RETRY] CRITICAL: ${exhaustedEvents.length} webhook event(s) have exhausted all ${MAX_WEBHOOK_RETRIES} retries. Manual intervention required:`,
        );
        for (const event of exhaustedEvents) {
          this.logger.error(
            `[WEBHOOK_RETRY]   - idEventoWebhook=${event.idEventoWebhook}, ` +
              `nossoNumero=${event.nossoNumero}, movimento=${event.movimento}, ` +
              `retryCount=${event.retryCount}, lastError="${event.errorMessage || 'N/A'}"`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`[WEBHOOK_RETRY] Fatal error during webhook retry job: ${error}`);
      if (error instanceof Error) {
        this.logger.error(`[WEBHOOK_RETRY] Stack: ${error.stack}`);
      }
    } finally {
      this.isProcessingWebhookRetry = false;
    }
  }

  // ─── Job 5: Bank Slip Due Notifications ──────────────────────────────────

  @Cron('0 8 * * *', {
    name: 'sicredi-boleto-due-notifications',
    timeZone: 'America/Sao_Paulo',
  })
  async notifyDueBankSlips(): Promise<void> {
    if (this.isProcessingDueNotifications) {
      this.logger.warn('[BOLETO_DUE] Due notifications already in progress, skipping');
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      this.logger.log('[BOLETO_DUE] Skipping due notifications in dev mode');
      return;
    }

    this.isProcessingDueNotifications = true;

    try {
      this.logger.log('[BOLETO_DUE] Starting bank slip due notification check...');

      // Compute SP-midnight (UTC-3) expressed as a UTC Date (same pattern as checkOverdueBoletos).
      const SP_OFFSET = '-03:00';
      const spDateParts = new Date().toLocaleString('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const today = new Date(`${spDateParts}T00:00:00${SP_OFFSET}`);

      const threeDaysFromNow = new Date(today);
      threeDaysFromNow.setUTCDate(threeDaysFromNow.getUTCDate() + 3);

      // Find ACTIVE bank slips due within the next 3 days (including today)
      const dueBankSlips = await this.prisma.bankSlip.findMany({
        where: {
          status: BANK_SLIP_STATUS.ACTIVE,
          dueDate: {
            gte: today,
            lte: threeDaysFromNow,
          },
        },
        include: {
          installment: {
            include: {
              invoice: {
                include: {
                  customer: { select: { fantasyName: true } },
                  task: { select: { id: true, name: true, serialNumber: true } },
                  externalOperation: { select: { id: true } },
                },
              },
            },
          },
        },
      });

      this.logger.log(`[BOLETO_DUE] Found ${dueBankSlips.length} bank slip(s) due within 3 days`);

      let notified = 0;

      for (const bankSlip of dueBankSlips) {
        try {
          const invoice = bankSlip.installment?.invoice;
          if (!invoice) continue;

          const customerName = invoice.customer?.fantasyName || 'N/A';
          const dueWithdrawalId =
            (invoice as any).externalOperation?.id ?? invoice.externalOperationId ?? null;
          const taskName = dueWithdrawalId ? 'Operação Externa' : invoice.task?.name || 'N/A';
          const serialNumber = invoice.task?.serialNumber || '';
          const formattedAmount = new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          }).format(Number(bankSlip.amount));

          const dueDate = bankSlip.dueDate;
          const diffTime = dueDate.getTime() - today.getTime();
          const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          const formattedDueDate = new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo',
          }).format(dueDate);

          const webUrl = dueWithdrawalId
            ? `/estoque/operacoes-externas/detalhes/${dueWithdrawalId}`
            : `/financeiro/faturamento/detalhes/${invoice.taskId}`;
          const mobileUrl = dueWithdrawalId
            ? `/(tabs)/estoque/operacoes-externas/detalhes/${dueWithdrawalId}`
            : `financial/${invoice.taskId}`;
          const actionUrl = JSON.stringify({ web: webUrl, mobile: mobileUrl });

          await this.notificationDispatchService.dispatchByConfiguration(
            'bank_slip.due',
            'system',
            {
              entityType: 'Financial',
              entityId: invoice.id,
              action: 'due',
              data: {
                customerName,
                taskName,
                serialNumber,
                amount: formattedAmount,
                nossoNumero: bankSlip.nossoNumero,
                dueDate: formattedDueDate,
                daysRemaining: daysRemaining,
                invoiceId: invoice.id,
                bankSlipId: bankSlip.id,
                taskId: invoice.taskId,
                externalOperationId: dueWithdrawalId || undefined,
              },
              overrides: {
                actionUrl,
                webUrl,
              },
            },
          );

          notified++;
        } catch (error) {
          this.logger.error(`[BOLETO_DUE] Failed to notify for bank slip ${bankSlip.id}: ${error}`);
        }
      }

      this.logger.log(
        `[BOLETO_DUE] Due notification check completed. Notified: ${notified}/${dueBankSlips.length}`,
      );
    } catch (error) {
      this.logger.error('[BOLETO_DUE] Error during due notification job:', error);
    } finally {
      this.isProcessingDueNotifications = false;
    }
  }

  // ─── Job 6: Bank Slip Data Sync from Sicredi ───────────────────────────────
  //
  // Runs daily at 9 AM SP — after the overdue check (7 AM) and before the
  // paid-boleto reconciliation (10 AM).  Queries Sicredi for every ACTIVE or
  // OVERDUE bank slip and pulls back the current dataVencimento and seuNumero.
  // Whenever Sicredi's record differs from ours (e.g. a due date was changed
  // directly in Sicredi's portal, or seuNumero was updated after an NF-e
  // regeneration) we update BankSlip + Installment and cascade the quote status.

  @Cron('0 9 * * *', {
    name: 'sicredi-boleto-due-date-sync',
    timeZone: 'America/Sao_Paulo',
  })
  async syncBankSlipDataFromSicredi(): Promise<void> {
    if (this.isProcessingDueSync) {
      this.logger.warn('[BOLETO_SYNC] Sync already in progress, skipping');
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      this.logger.log('[BOLETO_SYNC] Skipping bank slip data sync in dev mode');
      return;
    }

    this.isProcessingDueSync = true;

    try {
      await this.runSyncAllActiveBankSlips();
    } catch (error) {
      this.logger.error('[BOLETO_SYNC] Error during bank slip data sync:', error);
    } finally {
      this.isProcessingDueSync = false;
    }
  }

  /**
   * Query every ACTIVE / OVERDUE bank slip, compare against Sicredi's current
   * data, and update local BankSlip + Installment records that diverged.
   * Called by the daily cron (syncBankSlipDataFromSicredi) and also after a
   * manual reconciliation so both payment status AND due dates stay in sync.
   */
  async runSyncAllActiveBankSlips(): Promise<{
    checked: number;
    dueDateChanges: number;
    seuNumeroChanges: number;
    errors: number;
  }> {
    this.logger.log('[BOLETO_SYNC] Starting bank slip data sync from Sicredi...');

    const allActive = await this.prisma.bankSlip.findMany({
      where: {
        status: { in: [BANK_SLIP_STATUS.ACTIVE, BANK_SLIP_STATUS.OVERDUE] },
      },
      select: {
        id: true,
        nossoNumero: true,
        dueDate: true,
        seuNumero: true,
        status: true,
        installment: {
          select: {
            id: true,
            status: true,
            externalOperationId: true,
            customerConfig: { select: { quoteId: true } },
          },
        },
      },
    });

    const bankSlips = allActive.filter(
      bs => bs.nossoNumero && !bs.nossoNumero.startsWith('TMP-') && !bs.nossoNumero.startsWith('ERR-'),
    );

    this.logger.log(
      `[BOLETO_SYNC] Checking ${bankSlips.length} registered bank slip(s) against Sicredi`,
    );

    let dueDateChanges = 0;
    let seuNumeroChanges = 0;
    let errors = 0;

    for (const bankSlip of bankSlips) {
      try {
        const result = await this.syncOneBankSlip(bankSlip);
        if (result.dueDateChanged) dueDateChanges++;
        if (result.seuNumeroChanged) seuNumeroChanges++;
      } catch (error) {
        errors++;
        this.logger.warn(
          `[BOLETO_SYNC] Failed to sync boleto ${bankSlip.nossoNumero}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Small courtesy delay between Sicredi API calls
      await new Promise(res => setTimeout(res, 80));
    }

    this.logger.log(
      `[BOLETO_SYNC] Done. Checked: ${bankSlips.length}, Due-date changes: ${dueDateChanges}, SeuNumero changes: ${seuNumeroChanges}, Errors: ${errors}`,
    );

    return { checked: bankSlips.length, dueDateChanges, seuNumeroChanges, errors };
  }

  /**
   * Sync a single bank slip's data from Sicredi (due date + seuNumero).
   * Called by the daily cron and by the manual endpoint on the invoice controller.
   */
  async syncOneBankSlip(bankSlip: {
    id: string;
    nossoNumero: string;
    dueDate: Date;
    seuNumero: string | null;
    status: string;
    installment: {
      id: string;
      status: string;
      externalOperationId?: string | null;
      customerConfig: { quoteId: string } | null;
    } | null;
  }): Promise<{ dueDateChanged: boolean; seuNumeroChanged: boolean; newDueDate?: Date }> {
    const sicrediData = await this.sicrediService.queryBoleto(bankSlip.nossoNumero);

    const bankSlipUpdates: Record<string, unknown> = { lastSyncAt: new Date() };
    let dueDateChanged = false;
    let seuNumeroChanged = false;
    let newParsedDate: Date | undefined;

    // --- Due date ---
    // Use the existing parseSicrediDate for parsing, then compare calendar days in
    // SP timezone (the authoritative local timezone for these dates). Store any
    // change at noon UTC — the convention used everywhere else in the system.
    const sicrediRaw = this.parseSicrediDate(sicrediData.dataVencimento);
    if (sicrediRaw) {
      const sicrediYMD = sicrediRaw.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const localYMD = bankSlip.dueDate.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

      if (localYMD !== sicrediYMD) {
        dueDateChanged = true;
        // Rebuild at noon UTC for timezone-safe storage
        const [y, m, d] = sicrediYMD.split('-').map(Number);
        newParsedDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        bankSlipUpdates.dueDate = newParsedDate;

        // If the boleto was OVERDUE and Sicredi's date is now in the future,
        // restore it to ACTIVE so the overdue-check job won't re-mark it immediately.
        if (bankSlip.status === BANK_SLIP_STATUS.OVERDUE && newParsedDate > new Date()) {
          bankSlipUpdates.status = BANK_SLIP_STATUS.ACTIVE;
        }

        this.logger.log(
          `[BOLETO_SYNC] ${bankSlip.nossoNumero} due date: ${localYMD} → ${sicrediYMD}` +
            (bankSlipUpdates.status ? ' (restored ACTIVE)' : ''),
        );
      }
    } else {
      this.logger.warn(
        `[BOLETO_SYNC] Cannot parse dataVencimento="${sicrediData.dataVencimento}" for boleto ${bankSlip.nossoNumero}`,
      );
    }

    // --- seuNumero ---
    if (
      sicrediData.seuNumero != null &&
      sicrediData.seuNumero !== bankSlip.seuNumero
    ) {
      seuNumeroChanged = true;
      bankSlipUpdates.seuNumero = sicrediData.seuNumero;
      this.logger.log(
        `[BOLETO_SYNC] ${bankSlip.nossoNumero} seuNumero: "${bankSlip.seuNumero}" → "${sicrediData.seuNumero}"`,
      );
    }

    // --- Warn on unexpected terminal states ---
    if (sicrediData.situacao === 'LIQUIDADO') {
      this.logger.warn(
        `[BOLETO_SYNC] Boleto ${bankSlip.nossoNumero} is LIQUIDADO at Sicredi but ${bankSlip.status} locally — reconciliation job should handle this`,
      );
    } else if (sicrediData.situacao === 'BAIXADO') {
      this.logger.warn(
        `[BOLETO_SYNC] Boleto ${bankSlip.nossoNumero} is BAIXADO at Sicredi but ${bankSlip.status} locally`,
      );
    }

    // Persist all changes (at minimum lastSyncAt)
    await this.prisma.bankSlip.update({
      where: { id: bankSlip.id },
      data: bankSlipUpdates,
    });

    // Propagate due-date change down to the installment and up to the quote
    if (dueDateChanged && newParsedDate && bankSlip.installment) {
      const installmentUpdates: Record<string, unknown> = { dueDate: newParsedDate };

      // Restore OVERDUE installment to PENDING when date is pushed into the future
      if (
        bankSlip.installment.status === INSTALLMENT_STATUS.OVERDUE &&
        newParsedDate > new Date()
      ) {
        installmentUpdates.status = INSTALLMENT_STATUS.PENDING;
      }

      await this.prisma.installment.update({
        where: { id: bankSlip.installment.id },
        data: installmentUpdates,
      });

      // Recalculate quote/withdrawal status — a future due date removes the overdue flag
      if (bankSlip.installment.customerConfig?.quoteId) {
        await this.cascadeService.cascadeFromQuote(bankSlip.installment.customerConfig.quoteId);
      } else if (bankSlip.installment.externalOperationId) {
        await this.cascadeService.cascadeFromExternalOperation(
          bankSlip.installment.externalOperationId,
        );
      }
    }

    return { dueDateChanged, seuNumeroChanged, newDueDate: newParsedDate };
  }

  // ─── Job 7: Webhook Contract Periodic Health Check ──────────────────────────

  // Runs every 6 hours in São Paulo time (00:00, 06:00, 12:00, 18:00).
  // Ensures the Sicredi webhook contract is always ATIVO so payment events are
  // delivered even after API restarts, Sicredi-side contract expiry, or network
  // blips that prevented the startup registration from succeeding.
  @Cron('0 */6 * * *', {
    name: 'sicredi-webhook-contract-health',
    timeZone: 'America/Sao_Paulo',
  })
  async periodicWebhookContractHealthCheck(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') return;
    this.logger.log('[WEBHOOK_CONTRACT] Periodic health check (every 6h)...');
    await this.ensureWebhookContract();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Recalculate and update invoice status based on its installments.
   */
  private async updateInvoiceStatus(invoiceId: string): Promise<void> {
    await this.updateInvoiceStatusTx(this.prisma, invoiceId);
  }

  /**
   * Recalculate and update invoice status (transaction-compatible version).
   */
  private async updateInvoiceStatusTx(
    tx: { invoice: typeof this.prisma.invoice; installment: typeof this.prisma.installment },
    invoiceId: string,
  ): Promise<void> {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { installments: true },
    });

    if (!invoice) return;

    const activeInstallments = invoice.installments.filter(
      inst => inst.status !== INSTALLMENT_STATUS.CANCELLED,
    );

    if (activeInstallments.length === 0) return;

    const allPaid = activeInstallments.every(inst => inst.status === INSTALLMENT_STATUS.PAID);
    const somePaid = activeInstallments.some(inst => inst.status === INSTALLMENT_STATUS.PAID);

    const totalPaid = Number(
      activeInstallments
        .filter(inst => inst.status === INSTALLMENT_STATUS.PAID)
        .reduce((sum, inst) => sum + Number((inst.paidAmount ?? 0).toString()), 0)
        .toFixed(2),
    );

    let newStatus: string;
    if (allPaid) {
      newStatus = INVOICE_STATUS.PAID;
    } else if (somePaid) {
      newStatus = INVOICE_STATUS.PARTIALLY_PAID;
    } else {
      newStatus = INVOICE_STATUS.ACTIVE;
    }

    if (invoice.status !== newStatus) {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: newStatus as any,
          paidAmount: totalPaid,
        },
      });

      this.logger.log(`Invoice ${invoiceId} status updated to ${newStatus} (paid: ${totalPaid})`);
    }
  }

  /**
   * Resolve task/withdrawal context (id/label/customer + deep-link URLs) from an invoice.
   * Withdrawal-backed invoices ("Operação Externa") link to the withdrawal detail page;
   * task-backed invoices link to the billing detail page. Returns null if the invoice
   * is missing. Never throws.
   */
  private async resolveInvoiceContext(invoiceId: string): Promise<{
    taskId: string | null;
    taskName: string;
    customerName: string;
    externalOperationId: string | null;
    /** "da tarefa X" / "da operação externa" — for notification bodies */
    refLabel: string;
    webUrl: string | undefined;
    mobileUrl: string | undefined;
  } | null> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: { select: { fantasyName: true } },
        task: { select: { id: true, name: true } },
        externalOperation: { select: { id: true } },
      },
    });
    if (!invoice) return null;

    const taskId = invoice.task?.id ?? invoice.taskId ?? null;
    const externalOperationId =
      invoice.externalOperation?.id ?? invoice.externalOperationId ?? null;
    const isWithdrawal = !!externalOperationId;

    return {
      taskId,
      taskName: isWithdrawal ? 'Operação Externa' : invoice.task?.name || 'N/A',
      customerName: invoice.customer?.fantasyName || 'N/A',
      externalOperationId,
      refLabel: isWithdrawal
        ? 'da operação externa'
        : `da tarefa ${invoice.task?.name || 'N/A'}`,
      webUrl: isWithdrawal
        ? `/estoque/operacoes-externas/detalhes/${externalOperationId}`
        : taskId
          ? `/financeiro/faturamento/detalhes/${taskId}`
          : undefined,
      mobileUrl: !isWithdrawal && taskId ? `financial/${taskId}` : undefined,
    };
  }

  /**
   * Dispatch bank_slip.overdue when a boleto passes its due date (per slip).
   * Best-effort — never breaks the overdue sweep.
   */
  private async dispatchBankSlipOverdueNotification(
    invoiceId: string,
    bankSlipId: string,
    nossoNumero: string | null,
    dueDate: Date,
    amount: number,
  ): Promise<void> {
    try {
      const ctx = await this.resolveInvoiceContext(invoiceId);
      if (!ctx) return;

      const formattedAmount = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(amount);
      const formattedDueDate = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      }).format(dueDate);

      const { webUrl, mobileUrl } = ctx;

      await this.notificationDispatchService.dispatchByConfiguration('bank_slip.overdue', 'system', {
        entityType: 'BankSlip',
        entityId: ctx.taskId ?? ctx.externalOperationId ?? invoiceId,
        action: 'overdue',
        data: {
          customerName: ctx.customerName,
          taskName: ctx.taskName,
          nossoNumero: nossoNumero || 'N/A',
          amount: formattedAmount,
          dueDate: formattedDueDate,
          invoiceId,
          bankSlipId,
          taskId: ctx.taskId || undefined,
          externalOperationId: ctx.externalOperationId || undefined,
        },
        overrides: {
          title: 'Boleto Vencido',
          body: `O boleto ${nossoNumero || ''} ${ctx.refLabel} (${ctx.customerName}) venceu em ${formattedDueDate}. Valor: ${formattedAmount}.`,
          relatedEntityType: 'BANK_SLIP',
          ...(webUrl ? { webUrl } : {}),
          ...(mobileUrl ? { mobileUrl } : {}),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to dispatch bank_slip.overdue notification for bankSlip: ${bankSlipId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Dispatch bank_slip.created (LOW) when a boleto is registered and ACTIVE at Sicredi.
   * Best-effort — never breaks the creation job.
   */
  private async dispatchBankSlipCreatedNotification(
    invoiceId: string,
    nossoNumero: string,
    amount: number,
    dueDate: Date,
  ): Promise<void> {
    try {
      const ctx = await this.resolveInvoiceContext(invoiceId);
      if (!ctx) return;

      const formattedAmount = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(amount);
      const formattedDueDate = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      }).format(dueDate);

      const { webUrl, mobileUrl } = ctx;
      const generatedFor = ctx.externalOperationId
        ? 'a operação externa'
        : `a tarefa ${ctx.taskName}`;

      await this.notificationDispatchService.dispatchByConfiguration('bank_slip.created', 'system', {
        entityType: 'BankSlip',
        entityId: ctx.taskId ?? ctx.externalOperationId ?? invoiceId,
        action: 'created',
        data: {
          customerName: ctx.customerName,
          taskName: ctx.taskName,
          nossoNumero,
          amount: formattedAmount,
          dueDate: formattedDueDate,
          invoiceId,
          taskId: ctx.taskId || undefined,
          externalOperationId: ctx.externalOperationId || undefined,
        },
        overrides: {
          title: 'Boleto Gerado',
          body: `Boleto ${nossoNumero} gerado para ${generatedFor} (${ctx.customerName}). Valor: ${formattedAmount}, vencimento ${formattedDueDate}.`,
          relatedEntityType: 'BANK_SLIP',
          ...(webUrl ? { webUrl } : {}),
          ...(mobileUrl ? { mobileUrl } : {}),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to dispatch bank_slip.created notification for invoice: ${invoiceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Dispatch bank_slip.registration_failed when a boleto permanently fails to register
   * at Sicredi (errorCount >= 3). Best-effort — never breaks the creation job.
   */
  private async dispatchBankSlipRegistrationFailedNotification(
    invoiceId: string,
    bankSlipId: string,
    errorMessage: string | null,
  ): Promise<void> {
    try {
      const ctx = await this.resolveInvoiceContext(invoiceId);
      if (!ctx) return;

      const { webUrl, mobileUrl } = ctx;

      await this.notificationDispatchService.dispatchByConfiguration(
        'bank_slip.registration_failed',
        'system',
        {
          entityType: 'BankSlip',
          entityId: ctx.taskId ?? ctx.externalOperationId ?? invoiceId,
          action: 'registration_failed',
          data: {
            customerName: ctx.customerName,
            taskName: ctx.taskName,
            errorMessage: errorMessage || 'N/A',
            invoiceId,
            bankSlipId,
            taskId: ctx.taskId || undefined,
            externalOperationId: ctx.externalOperationId || undefined,
          },
          overrides: {
            title: 'Falha ao Registrar Boleto',
            body: `Não foi possível registrar o boleto ${ctx.refLabel} (${ctx.customerName}) no Sicredi após várias tentativas. Intervenção manual necessária.${errorMessage ? `\nErro: ${errorMessage}` : ''}`,
            relatedEntityType: 'BANK_SLIP',
            ...(webUrl ? { webUrl } : {}),
            ...(mobileUrl ? { mobileUrl } : {}),
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to dispatch bank_slip.registration_failed notification for bankSlip: ${bankSlipId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Dispatch bank_slip.paid notification (shared by webhook and reconciliation paths).
   */
  private async dispatchBankSlipPaidNotification(
    bankSlipId: string,
    invoiceId: string | undefined,
    paidAmount: number | string,
    dueDate: Date,
  ): Promise<void> {
    if (!invoiceId) return;

    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          customer: { select: { fantasyName: true } },
          task: { select: { id: true, name: true, serialNumber: true } },
          externalOperation: { select: { id: true } },
        },
      });

      if (!invoice) return;

      const customerName = invoice.customer?.fantasyName || 'N/A';
      const withdrawalId = invoice.externalOperation?.id ?? invoice.externalOperationId ?? null;
      const taskName = withdrawalId ? 'Operação Externa' : invoice.task?.name || 'N/A';
      const formattedAmount = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(Number(paidAmount));
      const formattedDueDate = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      }).format(dueDate);

      const webUrl = withdrawalId
        ? `/estoque/operacoes-externas/detalhes/${withdrawalId}`
        : `/financeiro/faturamento/detalhes/${invoice.taskId}`;
      const mobileUrl = withdrawalId
        ? `/(tabs)/estoque/operacoes-externas/detalhes/${withdrawalId}`
        : `financial/${invoice.taskId}`;
      const actionUrl = JSON.stringify({ web: webUrl, mobile: mobileUrl });

      await this.notificationDispatchService.dispatchByConfiguration('bank_slip.paid', 'system', {
        entityType: 'Financial',
        entityId: invoice.id,
        action: 'paid',
        data: {
          customerName,
          taskName,
          paidAmount: formattedAmount,
          dueDate: formattedDueDate,
          invoiceId: invoice.id,
          bankSlipId,
          taskId: invoice.taskId,
          externalOperationId: withdrawalId || undefined,
        },
        overrides: {
          actionUrl,
          webUrl,
        },
      });

      this.logger.log(
        `[BOLETO_RECONCILE] bank_slip.paid notification dispatched for bankSlip: ${bankSlipId}`,
      );
    } catch (error) {
      this.logger.error(
        `[BOLETO_RECONCILE] Failed to dispatch bank_slip.paid notification for bankSlip: ${bankSlipId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

}
