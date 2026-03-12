import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SicrediService } from './sicredi.service';
import { SicrediAuthService } from './sicredi-auth.service';
import { SicrediWebhookService } from './sicredi-webhook.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { TaskPricingStatusCascadeService } from '@modules/production/task-pricing/task-pricing-status-cascade.service';
import {
  BANK_SLIP_STATUS,
  INSTALLMENT_STATUS,
  INVOICE_STATUS,
} from '@constants';

const MAX_WEBHOOK_RETRIES = 3;

/**
 * Scheduler for Sicredi boleto lifecycle management.
 *
 * Runs four daily jobs:
 * 1. Boleto Creation (6 AM) - Creates boletos for upcoming installments
 * 2. Boleto Reconciliation (10 AM) - Reconciles paid boletos from Sicredi
 * 3. Boleto Overdue Check (7 AM) - Marks overdue boletos
 * 4. Webhook Retry (11 AM) - Retries failed webhook events (up to 3 attempts)
 */
@Injectable()
export class SicrediBoletoScheduler {
  private readonly logger = new Logger(SicrediBoletoScheduler.name);
  private isProcessingCreation = false;
  private isProcessingReconciliation = false;
  private isProcessingOverdue = false;
  private isProcessingWebhookRetry = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sicrediService: SicrediService,
    private readonly authService: SicrediAuthService,
    private readonly webhookService: SicrediWebhookService,
    private readonly dispatchService: NotificationDispatchService,
    private readonly cascadeService: TaskPricingStatusCascadeService,
  ) {}

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
      this.logger.log('[BOLETO_CREATE] Skipping scheduled boleto creation in dev mode (only triggered on internal approval)');
      return;
    }

    this.isProcessingCreation = true;

    try {
      this.logger.log('[BOLETO_CREATE] ====== Starting boleto creation job ======');

      const today = new Date();
      const fiveDaysFromNow = new Date(today);
      fiveDaysFromNow.setDate(fiveDaysFromNow.getDate() + 5);
      this.logger.log(`[BOLETO_CREATE] Looking for installments due by ${fiveDaysFromNow.toISOString().split('T')[0]}`);

      // Find installments that are PENDING, due within 5 days,
      // and either have no BankSlip or have a BankSlip with ERROR/CREATING status (< 3 retries)
      const installments = await this.prisma.installment.findMany({
        where: {
          status: INSTALLMENT_STATUS.PENDING,
          dueDate: { lte: fiveDaysFromNow },
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
                },
              },
            },
          },
        },
      });

      this.logger.log(`[BOLETO_CREATE] Found ${installments.length} installment(s) needing boleto creation`);

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
      this.logger.log(`[BOLETO_CREATE] Sicredi config: codigoBeneficiario=${codigoBeneficiario}, apiUrl=${this.authService.config.apiUrl}`);

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
          const cleanCnpj = customer.cnpj?.replace(/\D/g, '') || '';
          const customerName = customer.fantasyName || customer.corporateName || '';

          if (!cleanCnpj || cleanCnpj.length < 14) {
            const validationMsg = `Customer "${customer.fantasyName || customer.id}" has invalid or missing CNPJ (got: "${customer.cnpj || ''}")`;
            this.logger.error(`[BOLETO_CREATE] ${validationMsg} — skipping installment ${installment.id}`);

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
                  amount: Number(installment.amount),
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

          if (!customerName) {
            const validationMsg = `Customer ${customer.id} has no name (fantasyName and corporateName are both empty)`;
            this.logger.error(`[BOLETO_CREATE] ${validationMsg} — skipping installment ${installment.id}`);

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
                  amount: Number(installment.amount),
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
          const formattedDueDate = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;

          this.logger.log(
            `[BOLETO_CREATE] Creating boleto for installment ${installment.id}: ` +
            `customer=${customer.fantasyName}, cnpj=${customer.cnpj}, amount=${installment.amount}, dueDate=${formattedDueDate}`,
          );

          // Create boleto via Sicredi API
          const boletoResponse = await this.sicrediService.createBoleto({
            codigoBeneficiario,
            tipoCobranca: 'NORMAL',
            pagador: {
              tipoPessoa: 'PESSOA_JURIDICA',
              documento: cleanCnpj,
              nome: customerName,
              endereco: customer.address || undefined,
              cidade: customer.city || undefined,
              uf: customer.state || undefined,
              cep: customer.zipCode?.replace(/\D/g, '') || undefined,
              telefone: customer.phones?.[0]?.replace(/\D/g, '') || undefined,
              email: customer.email || undefined,
            },
            especieDocumento: 'DUPLICATA_MERCANTIL_INDICACAO',
            seuNumero: installment.id.replace(/-/g, '').slice(0, 10),
            dataVencimento: formattedDueDate,
            valor: Number(installment.amount),
          });

          // Download PDF
          let pdfBuffer: Buffer | null = null;
          try {
            pdfBuffer = await this.sicrediService.downloadBoletoPdf(
              boletoResponse.linhaDigitavel,
            );
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
          if (installment.bankSlip) {
            await this.prisma.bankSlip.update({
              where: { id: installment.bankSlip.id },
              data: {
                nossoNumero: boletoResponse.nossoNumero,
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
                barcode: boletoResponse.codigoBarras,
                digitableLine: boletoResponse.linhaDigitavel,
                pixQrCode,
                txid: boletoResponse.txid || null,
                type: 'NORMAL',
                amount: Number(installment.amount),
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
        } catch (error) {
          errors++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          this.logger.error(
            `[BOLETO_CREATE] Failed to create boleto for installment ${installment.id}: ${errorMessage}`,
          );
          if (error instanceof Error && error.stack) {
            this.logger.error(`[BOLETO_CREATE] Stack: ${error.stack}`);
          }
          // Log the full error response if it's an HTTP error
          if ((error as any)?.response?.data) {
            this.logger.error(`[BOLETO_CREATE] Sicredi response: ${JSON.stringify((error as any).response.data)}`);
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
                amount: Number(installment.amount),
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
          }
        }
      } catch (summaryError) {
        this.logger.error(`[BOLETO_CREATE] Failed to query permanently failed boletos: ${summaryError}`);
      }
    } catch (error) {
      this.logger.error(`[BOLETO_CREATE] Fatal error during boleto creation job: ${error}`);
      if (error instanceof Error) this.logger.error(`[BOLETO_CREATE] Stack: ${error.stack}`);
    } finally {
      this.isProcessingCreation = false;
    }
  }

  // ─── Job 2: Boleto Reconciliation ───────────────────────────────────────────

  @Cron('0 10 * * *', {
    name: 'sicredi-boleto-reconciliation',
    timeZone: 'America/Sao_Paulo',
  })
  async reconcileBoletos(): Promise<void> {
    if (this.isProcessingReconciliation) {
      this.logger.warn('Boleto reconciliation already in progress, skipping');
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      this.logger.log('[BOLETO_RECONCILE] Skipping boleto reconciliation in dev mode');
      return;
    }

    this.isProcessingReconciliation = true;

    try {
      this.logger.log('[BOLETO_RECONCILE] Starting boleto reconciliation job...');

      // Check the last 3 days to handle weekends and missed job runs
      const daysToCheck = 3;
      const seenNossoNumeros = new Set<string>();
      const paidBoletos: Array<{ nossoNumero: string; valorLiquidacao: number; dataLiquidacao: string; [key: string]: any }> = [];

      for (let daysAgo = 1; daysAgo <= daysToCheck; daysAgo++) {
        const checkDate = new Date();
        checkDate.setDate(checkDate.getDate() - daysAgo);
        const formattedDate = `${String(checkDate.getDate()).padStart(2, '0')}/${String(checkDate.getMonth() + 1).padStart(2, '0')}/${checkDate.getFullYear()}`;

        try {
          const dailyPaid = await this.sicrediService.queryPaidBoletos(formattedDate);
          this.logger.log(`[BOLETO_RECONCILE] Found ${dailyPaid.length} paid boleto(s) from ${formattedDate}`);

          for (const boleto of dailyPaid) {
            if (!seenNossoNumeros.has(boleto.nossoNumero)) {
              seenNossoNumeros.add(boleto.nossoNumero);
              paidBoletos.push(boleto);
            }
          }
        } catch (dayError) {
          this.logger.error(`[BOLETO_RECONCILE] Failed to query paid boletos for ${formattedDate}: ${dayError}`);
          // Continue to next day — don't let one failure stop the entire reconciliation
        }
      }

      this.logger.log(`[BOLETO_RECONCILE] Total unique paid boletos across last ${daysToCheck} days: ${paidBoletos.length}`);

      let reconciled = 0;

      for (const paidBoleto of paidBoletos) {
        try {
          // Find our BankSlip by nossoNumero
          const bankSlip = await this.prisma.bankSlip.findUnique({
            where: { nossoNumero: paidBoleto.nossoNumero },
            include: {
              installment: {
                include: {
                  invoice: true,
                },
              },
            },
          });

          if (!bankSlip) {
            this.logger.warn(
              `[BOLETO_RECONCILE] No BankSlip found for nossoNumero=${paidBoleto.nossoNumero}, skipping`,
            );
            continue;
          }

          // Skip if already marked as PAID
          if (bankSlip.status === BANK_SLIP_STATUS.PAID) {
            this.logger.log(
              `[BOLETO_RECONCILE] BankSlip ${bankSlip.id} already PAID, skipping`,
            );
            continue;
          }

          // Update BankSlip + Installment + Invoice atomically in a transaction
          const invoiceId = bankSlip.installment?.invoice?.id;

          await this.prisma.$transaction(async (tx) => {
            await tx.bankSlip.update({
              where: { id: bankSlip.id },
              data: {
                status: BANK_SLIP_STATUS.PAID,
                paidAmount: paidBoleto.valorLiquidacao,
                paidAt: new Date(paidBoleto.dataLiquidacao),
                lastSyncAt: new Date(),
              },
            });

            if (bankSlip.installment) {
              await tx.installment.update({
                where: { id: bankSlip.installment.id },
                data: {
                  status: INSTALLMENT_STATUS.PAID,
                  paidAmount: paidBoleto.valorLiquidacao,
                  paidAt: new Date(paidBoleto.dataLiquidacao),
                },
              });
            }

            if (invoiceId) {
              await this.updateInvoiceStatusTx(tx, invoiceId);
            }
          });

          // Cascade TaskPricing status (outside transaction — reads fresh data)
          if (invoiceId) {
            await this.cascadeService.cascadeFromInvoice(invoiceId);
          }

          reconciled++;
          this.logger.log(
            `[BOLETO_RECONCILE] Reconciled boleto ${paidBoleto.nossoNumero} - paid ${paidBoleto.valorLiquidacao}`,
          );
        } catch (error) {
          this.logger.error(
            `[BOLETO_RECONCILE] Failed to reconcile boleto ${paidBoleto.nossoNumero}: ${error}`,
          );
        }
      }

      this.logger.log(
        `[BOLETO_RECONCILE] Boleto reconciliation completed. Reconciled: ${reconciled}/${paidBoletos.length}`,
      );
    } catch (error) {
      this.logger.error('[BOLETO_RECONCILE] Error during boleto reconciliation job:', error);
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

      const today = new Date();
      today.setHours(0, 0, 0, 0);

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

            // Update Invoice status and cascade to TaskPricing
            if (bankSlip.installment.invoice) {
              await this.updateInvoiceStatus(bankSlip.installment.invoice.id);
              await this.cascadeService.cascadeFromInvoice(bankSlip.installment.invoice.id);
            }
          }

          updated++;
        } catch (error) {
          this.logger.error(
            `Failed to update overdue bank slip ${bankSlip.id}: ${error}`,
          );
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
          this.logger.log(
            `[WEBHOOK_RETRY] Event ${event.idEventoWebhook} succeeded on retry`,
          );
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
      this.logger.error(
        `[WEBHOOK_RETRY] Fatal error during webhook retry job: ${error}`,
      );
      if (error instanceof Error) {
        this.logger.error(`[WEBHOOK_RETRY] Stack: ${error.stack}`);
      }
    } finally {
      this.isProcessingWebhookRetry = false;
    }
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
      (inst) => inst.status !== INSTALLMENT_STATUS.CANCELLED,
    );

    if (activeInstallments.length === 0) return;

    const allPaid = activeInstallments.every(
      (inst) => inst.status === INSTALLMENT_STATUS.PAID,
    );
    const somePaid = activeInstallments.some(
      (inst) => inst.status === INSTALLMENT_STATUS.PAID,
    );

    const totalPaid = activeInstallments
      .filter((inst) => inst.status === INSTALLMENT_STATUS.PAID)
      .reduce((sum, inst) => sum + Number(inst.paidAmount || 0), 0);

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

      this.logger.log(
        `Invoice ${invoiceId} status updated to ${newStatus} (paid: ${totalPaid})`,
      );
    }
  }
}
