import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SicrediService } from './sicredi.service';
import { SicrediAuthService } from './sicredi-auth.service';
import { SicrediWebhookService } from './sicredi-webhook.service';
import { TaskQuoteStatusCascadeService } from '@modules/production/task-quote/task-quote-status-cascade.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import {
  BANK_SLIP_STATUS,
  INSTALLMENT_STATUS,
  INVOICE_STATUS,
} from '@constants';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly sicrediService: SicrediService,
    private readonly authService: SicrediAuthService,
    private readonly webhookService: SicrediWebhookService,
    private readonly cascadeService: TaskQuoteStatusCascadeService,
    private readonly configService: ConfigService,
    private readonly notificationDispatchService: NotificationDispatchService,
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
    const expectedUrl = this.configService.get<string>(
      'SICREDI_WEBHOOK_URL',
      DEFAULT_WEBHOOK_URL,
    );

    this.logger.log(
      `[WEBHOOK_CONTRACT] Checking webhook contract (expected URL: ${expectedUrl})`,
    );

    try {
      const contracts = await this.sicrediService.queryWebhookContracts();

      this.logger.log(
        `[WEBHOOK_CONTRACT] Found ${Array.isArray(contracts) ? contracts.length : 0} existing contract(s)`,
      );

      if (Array.isArray(contracts) && contracts.length > 0) {
        // Look for a contract with the correct URL and ATIVO status
        const activeMatch = contracts.find(
          (c: any) =>
            c.url === expectedUrl &&
            c.contratoStatus === 'ATIVO' &&
            c.urlStatus === 'ATIVO',
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
            c.url !== expectedUrl ||
            c.contratoStatus !== 'ATIVO' ||
            c.urlStatus !== 'ATIVO',
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
      this.logger.error(
        `[WEBHOOK_CONTRACT] Failed to ensure webhook contract: ${message}`,
      );
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
      // Exclude installments from customer configs with custom payment text (those don't use boleto)
      const installments = await this.prisma.installment.findMany({
        where: {
          status: INSTALLMENT_STATUS.PENDING,
          dueDate: { lte: fiveDaysFromNow },
          customerConfig: {
            OR: [
              { customPaymentText: null },
              { customPaymentText: '' },
            ],
          },
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
              nfseDocuments: {
                where: { status: 'AUTHORIZED' },
                select: { elotechNfseId: true, nfseNumber: true },
                orderBy: { createdAt: 'desc' },
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
          const formattedDueDate = `${dueDate.getUTCFullYear()}-${String(dueDate.getUTCMonth() + 1).padStart(2, '0')}-${String(dueDate.getUTCDate()).padStart(2, '0')}`;

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
            seuNumero: this.buildSeuNumero(installment),
            informativos: this.buildBoletoLines(installment),
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

  /**
   * Build the seuNumero field for a Sicredi boleto.
   * Priority: NfSe number (if enabled + authorized) → truck plate → installment ID fragment.
   * Max 10 alphanumeric chars per API spec.
   */
  private buildSeuNumero(installment: any): string {
    const generateInvoice = installment.invoice?.customerConfig?.generateInvoice !== false;
    const authorizedNfse = installment.invoice?.nfseDocuments?.[0];
    const truckPlate = installment.invoice?.task?.truck?.plate;

    if (generateInvoice && authorizedNfse?.nfseNumber) {
      return `NF${authorizedNfse.nfseNumber}`.substring(0, 10);
    }
    if (truckPlate) {
      return truckPlate.replace(/[^A-Za-z0-9]/g, '').substring(0, 10);
    }
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

    // Lines 2-3: Vehicle description — mirrors NfSe discriminação format
    // Line 2: "Ref. serv. no veiculo Caminhao Carga Seca"
    // Line 3: "de n serie: X, placa: Y, chassi: Z"
    const category = this.translateTruckCategory(truck?.category);
    const implement = this.translateImplementType(truck?.implementType);
    const vehicleType = [category, implement].filter(Boolean).join(' ');

    const identifiers: string[] = [];
    if (task?.serialNumber) identifiers.push(`n serie: ${task.serialNumber}`);
    if (truck?.plate) identifiers.push(`placa: ${truck.plate}`);
    if (truck?.chassisNumber) identifiers.push(`chassi: ${truck.chassisNumber}`);
    const idStr = identifiers.join(', ');

    if (vehicleType || idStr) {
      parts.push(`Ref. serv. no veiculo ${vehicleType}`.trimEnd().substring(0, 80));
      if (idStr) parts.push(idStr.substring(0, 80));
    }

    // Remaining lines: services for this customer
    const allServices: any[] = installment.invoice?.customerConfig?.quote?.services || [];
    const services = allServices.filter(
      (s: any) => !s.invoiceToCustomerId || s.invoiceToCustomerId === customerId,
    );
    const remaining = 5 - parts.length;
    if (services.length > 0 && remaining > 0) {
      const serviceLines = this.buildServiceLines(
        services.map((s: any) => s.description as string),
        remaining,
        80,
      );
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
      THREE_QUARTER: 'Tres quartos',
      RIGID: 'Rigido',
      TRUCK: 'Caminhao',
      SEMI_TRAILER: 'Semi-reboque',
      B_DOUBLE: 'B-Double',
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
                  paymentMethod: 'BANK_SLIP',
                },
              });
            }

            if (invoiceId) {
              await this.updateInvoiceStatusTx(tx, invoiceId);
            }
          });

          // Cascade TaskQuote status (outside transaction — reads fresh data)
          if (invoiceId) {
            await this.cascadeService.cascadeFromInvoice(invoiceId);
          }

          // Dispatch bank_slip.paid notification (same as webhook path)
          await this.dispatchBankSlipPaidNotification(
            bankSlip.id,
            invoiceId,
            paidBoleto.valorLiquidacao,
            bankSlip.dueDate,
          );

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

            // Update Invoice status and cascade to TaskQuote
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

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const threeDaysFromNow = new Date(today);
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

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
          const taskName = invoice.task?.name || 'N/A';
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

          const webUrl = `/financeiro/faturamento/detalhes/${invoice.taskId}`;
          const mobileUrl = `financial/${invoice.taskId}`;
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
                daysRemaining: daysRemaining === 0 ? 'hoje' : `${daysRemaining} dia(s)`,
                invoiceId: invoice.id,
                bankSlipId: bankSlip.id,
                taskId: invoice.taskId,
              },
              overrides: {
                actionUrl,
                webUrl,
              },
            },
          );

          notified++;
        } catch (error) {
          this.logger.error(
            `[BOLETO_DUE] Failed to notify for bank slip ${bankSlip.id}: ${error}`,
          );
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
        },
      });

      if (!invoice) return;

      const customerName = invoice.customer?.fantasyName || 'N/A';
      const taskName = invoice.task?.name || 'N/A';
      const formattedAmount = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(Number(paidAmount));
      const formattedDueDate = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      }).format(dueDate);

      const webUrl = `/financeiro/faturamento/detalhes/${invoice.taskId}`;
      const mobileUrl = `financial/${invoice.taskId}`;
      const actionUrl = JSON.stringify({ web: webUrl, mobile: mobileUrl });

      await this.notificationDispatchService.dispatchByConfiguration(
        'bank_slip.paid',
        'system',
        {
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
          },
          overrides: {
            actionUrl,
            webUrl,
          },
        },
      );

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
