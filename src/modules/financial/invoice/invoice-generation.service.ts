import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SicrediService } from '@modules/integrations/sicredi/sicredi.service';
import { SicrediAuthService } from '@modules/integrations/sicredi/sicredi-auth.service';
import { INVOICE_STATUS, INSTALLMENT_STATUS, BANK_SLIP_STATUS } from '@constants';
import type { Invoice } from '@types';
import { nextBrazilianBusinessDay } from '@utils/brazilian-holidays.util';

/**
 * Service responsible for auto-generating invoices from approved task quotes.
 * Creates invoices, installments, bank slips, and NFS-e documents as needed.
 */
@Injectable()
export class InvoiceGenerationService {
  private readonly logger = new Logger(InvoiceGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sicrediService: SicrediService,
    private readonly sicrediAuthService: SicrediAuthService,
  ) {}

  /**
   * Generate invoices for all customer configs of a task's approved quote.
   *
   * For each customerConfig:
   * 1. Creates an Invoice with status ACTIVE
   * 2. Calculates installment due dates based on payment condition
   * 3. Creates Installment records
   * 4. If payment method is BANK_SLIP, creates BankSlip records with CREATING status
   * 5. If NFS-e should be emitted, creates NfseDocument with PENDING status
   *
   * All operations are wrapped in a Prisma transaction for atomicity.
   *
   * @param taskId - UUID of the task whose quote to generate invoices for
   * @param userId - UUID of the user triggering the generation
   * @returns Array of created invoice IDs
   */
  async generateInvoicesForTask(
    taskId: string,
    userId: string,
    approvalDate?: Date,
    options?: { skipBankSlips?: boolean; skipNfse?: boolean },
  ): Promise<string[]> {
    this.logger.log(`[INVOICE_GEN] ====== Starting invoice generation for task ${taskId} ======`);

    // Load the task with its quote, customer configs, and finishedAt for due date calculation
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        finishedAt: true,
        quote: {
          include: {
            customerConfigs: {
              include: {
                customer: {
                  select: {
                    id: true,
                    fantasyName: true,
                    cnpj: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!task) {
      this.logger.error(`[INVOICE_GEN] Task ${taskId} NOT FOUND in database`);
      throw new NotFoundException(`Tarefa com ID ${taskId} não encontrada.`);
    }

    this.logger.log(`[INVOICE_GEN] Task found: ${task.id}, has quote: ${!!task.quote}`);

    if (!task.quote) {
      this.logger.error(`[INVOICE_GEN] No quote found for task ${taskId}`);
      throw new NotFoundException(`Orçamento não encontrado para a tarefa ${taskId}.`);
    }

    const quote = task.quote;
    const customerConfigs = quote.customerConfigs;

    this.logger.log(
      `[INVOICE_GEN] Quote ${quote.id}: ${customerConfigs?.length ?? 0} customer config(s)`,
    );

    if (!customerConfigs || customerConfigs.length === 0) {
      this.logger.warn(
        `[INVOICE_GEN] No customer configs found for task ${taskId}, skipping invoice generation.`,
      );
      return [];
    }

    const invoiceIds: string[] = [];

    await this.prisma.$transaction(async tx => {
      for (const config of customerConfigs) {
        // Check if an active (non-cancelled) invoice already exists for this customerConfig.
        // Cancelled invoices are intentionally excluded so re-approval after cancellation
        // creates fresh documents instead of reusing stale ones.
        const existingInvoice = await tx.invoice.findFirst({
          where: { customerConfigId: config.id, status: { not: 'CANCELLED' } },
        });

        if (existingInvoice) {
          this.logger.warn(
            `[INVOICE_GEN] Active invoice already exists for customerConfig ${config.id} (invoice ${existingInvoice.id}), skipping.`,
          );
          invoiceIds.push(existingInvoice.id);
          continue;
        }

        // Clean up any cancelled invoices for this customerConfig before creating new ones.
        // Cancelled invoices leave behind installments with the same (customerConfigId, number)
        // which would cause a unique-constraint violation when we create fresh installments below.
        const cancelledInvoiceIds = await tx.invoice.findMany({
          where: { customerConfigId: config.id, status: 'CANCELLED' },
          select: { id: true },
        });
        if (cancelledInvoiceIds.length > 0) {
          const ids = cancelledInvoiceIds.map(i => i.id);

          // H3a: never hard-delete PAID installments (and their bank slips) during
          // re-generation cleanup — they are real financial history. If any PAID
          // installment hangs off a cancelled invoice, abort with a clear error.
          const paidCount = await tx.installment.count({
            where: { invoiceId: { in: ids }, status: 'PAID' },
          });
          if (paidCount > 0) {
            throw new BadRequestException(
              'Não é possível regenerar o faturamento: existem parcelas pagas vinculadas a faturas canceladas. Trate as parcelas pagas manualmente antes de regenerar.',
            );
          }

          await tx.installment.deleteMany({
            where: { invoiceId: { in: ids }, status: { not: 'PAID' } },
          });
          await tx.invoice.deleteMany({ where: { id: { in: ids } } });
          this.logger.log(
            `[INVOICE_GEN] Cleaned up ${ids.length} cancelled invoice(s) for customerConfig ${config.id} before re-generation.`,
          );
        }

        const totalAmount = Number(config.total);
        this.logger.log(
          `[INVOICE_GEN] CustomerConfig ${config.id}: customer=${config.customer?.fantasyName} (${config.customer?.cnpj}), total=${totalAmount}`,
        );

        // Generate installments from payment condition and task.finishedAt
        const finishedAt = task.finishedAt;
        if (!finishedAt) {
          this.logger.warn(
            `[INVOICE_GEN] Task ${taskId} has no finishedAt date, skipping invoice generation for customerConfig ${config.id}.`,
          );
          continue;
        }

        const paymentConfig = (config as any).paymentConfig ?? null;
        const generatedInstallments = paymentConfig
          ? this.generateInstallmentsFromPaymentConfig(
              paymentConfig,
              finishedAt,
              totalAmount,
              approvalDate,
            )
          : this.generateInstallmentsFromCondition(
              config.paymentCondition || null,
              finishedAt,
              totalAmount,
              approvalDate,
            );

        if (generatedInstallments.length === 0) {
          this.logger.warn(
            `[INVOICE_GEN] No installments generated for customerConfig ${config.id} (condition=${config.paymentCondition}, paymentConfig=${JSON.stringify(paymentConfig)}), skipping invoice generation.`,
          );
          continue;
        }

        this.logger.log(
          `[INVOICE_GEN] Generated ${generatedInstallments.length} installment(s) for customerConfig ${config.id}`,
        );

        // Create the Invoice
        const invoice = await tx.invoice.create({
          data: {
            customerConfigId: config.id,
            taskId: taskId,
            customerId: config.customerId,
            totalAmount: totalAmount,
            paidAmount: 0,
            status: 'ACTIVE',
            createdById: userId,
          },
        });

        invoiceIds.push(invoice.id);

        this.logger.log(
          `[INVOICE_GEN] Invoice ${invoice.id} created (status=ACTIVE, total=${totalAmount})`,
        );

        // Determine if bank slips should be generated.
        // generateBankSlip=false means the customer pays via direct transfer/PIX — no boleto needed.
        // options.skipBankSlips=true overrides the config flag (used for manual settlement).
        const shouldCreateBankSlips =
          !options?.skipBankSlips && (config as any).generateBankSlip !== false;

        if (!shouldCreateBankSlips) {
          this.logger.log(
            `[INVOICE_GEN] Skipping BankSlip creation for customerConfig ${config.id}: generateBankSlip=false`,
          );
        }

        // Create installments and optionally create BankSlips
        for (const instData of generatedInstallments) {
          const inst = await tx.installment.create({
            data: {
              customerConfigId: config.id,
              invoiceId: invoice.id,
              number: instData.number,
              dueDate: instData.dueDate,
              amount: instData.amount,
              paidAmount: 0,
              status: 'PENDING',
            },
          });

          if (shouldCreateBankSlips) {
            const nossoNumero = this.generateTemporaryNossoNumero(inst.id);

            await tx.bankSlip.create({
              data: {
                installmentId: inst.id,
                nossoNumero: nossoNumero,
                type: 'NORMAL',
                amount: Number(inst.amount),
                dueDate: inst.dueDate,
                status: 'CREATING',
              },
            });

            this.logger.log(
              `[INVOICE_GEN]   Installment #${instData.number}: id=${inst.id}, amount=${instData.amount}, dueDate=${instData.dueDate}, bankSlip nossoNumero=${nossoNumero}, status=CREATING`,
            );
          } else {
            this.logger.log(
              `[INVOICE_GEN]   Installment #${instData.number}: id=${inst.id}, amount=${instData.amount}, dueDate=${instData.dueDate}, no BankSlip (custom payment)`,
            );
          }
        }

        // Create NfseDocument for municipal emission (Elotech OXY) only if generateInvoice is true
        // and options.skipNfse is not set (used for manual settlement where NFS-e is not auto-emitted).
        const shouldGenerateNfse = !options?.skipNfse && config.generateInvoice !== false;

        if (shouldGenerateNfse) {
          await tx.nfseDocument.create({
            data: {
              invoiceId: invoice.id,
              status: 'PENDING',
            },
          });
          this.logger.log(
            `[INVOICE_GEN] NfseDocument created for invoice ${invoice.id} (status=PENDING)`,
          );
        } else {
          this.logger.log(
            `[INVOICE_GEN] Skipping NfseDocument for invoice ${invoice.id}: generateInvoice=false`,
          );
        }
        this.logger.log(
          `[INVOICE_GEN] Invoice ${invoice.id} fully created for customer ${config.customer?.fantasyName} (${config.customerId}): ` +
            `${generatedInstallments.length} installment(s), total: ${totalAmount}`,
        );
      }
    });

    this.logger.log(
      `[INVOICE_GEN] ====== Invoice generation complete for task ${taskId}: ${invoiceIds.length} invoice(s) created [${invoiceIds.join(', ')}] ======`,
    );

    return invoiceIds;
  }

  /**
   * Generate the billing invoice for a CHARGEABLE external withdrawal ("Operação Externa").
   *
   * Mirrors generateInvoicesForTask's per-config body, but the billing config lives on
   * the withdrawal itself (single invoice — no customer configs):
   * 1. Creates an Invoice {externalOperationId, customerId} with status ACTIVE
   * 2. Calculates installments from paymentConfig ?? paymentCondition anchored at approvalDate
   * 3. Creates Installment records keyed by externalOperationId (NO customerConfigId)
   * 4. If generateBankSlip, creates BankSlip records with CREATING status
   * 5. If generateInvoice (NFS-e), creates NfseDocument with PENDING status
   *
   * All operations are wrapped in a Prisma transaction for atomicity.
   *
   * @param externalOperationId - UUID of the external withdrawal to bill
   * @param userId - UUID of the user triggering the generation
   * @param approvalDate - Anchor date for installment due dates (defaults to now)
   * @returns Array of created invoice IDs (or the existing active invoice id)
   */
  async generateInvoicesForExternalOperation(
    externalOperationId: string,
    userId: string,
    approvalDate?: Date,
  ): Promise<string[]> {
    this.logger.log(
      `[INVOICE_GEN_EW] ====== Starting invoice generation for external withdrawal ${externalOperationId} ======`,
    );

    const withdrawal = await this.prisma.externalOperation.findUnique({
      where: { id: externalOperationId },
      include: {
        items: { include: { item: { select: { name: true } } } },
        services: { orderBy: { position: 'asc' } },
        customer: {
          select: {
            id: true,
            fantasyName: true,
            cnpj: true,
          },
        },
      },
    });

    if (!withdrawal) {
      this.logger.error(
        `[INVOICE_GEN_EW] External withdrawal ${externalOperationId} NOT FOUND in database`,
      );
      throw new NotFoundException(
        `Operação externa com ID ${externalOperationId} não encontrada.`,
      );
    }

    if (!withdrawal.customerId || !withdrawal.customer) {
      this.logger.warn(
        `[INVOICE_GEN_EW] Withdrawal ${externalOperationId} has no customer, skipping invoice generation.`,
      );
      return [];
    }

    if (!withdrawal.generateInvoice && !withdrawal.generateBankSlip) {
      this.logger.warn(
        `[INVOICE_GEN_EW] Withdrawal ${externalOperationId} has no billing flags enabled (generateInvoice=false, generateBankSlip=false), skipping.`,
      );
      return [];
    }

    // totalAmount = Σ(items: unit price × withdrawedQuantity) + Σ(services: amount)
    const itemsTotal = withdrawal.items.reduce(
      (sum, it) => sum + Number(it.price ?? 0) * it.withdrawedQuantity,
      0,
    );
    const servicesTotal = withdrawal.services.reduce((sum, s) => sum + Number(s.amount), 0);
    const totalAmount = Number((itemsTotal + servicesTotal).toFixed(2));

    this.logger.log(
      `[INVOICE_GEN_EW] Withdrawal ${externalOperationId}: customer=${withdrawal.customer.fantasyName} (${withdrawal.customer.cnpj}), ` +
        `items=${withdrawal.items.length} (${itemsTotal}), services=${withdrawal.services.length} (${servicesTotal}), total=${totalAmount}`,
    );

    // Due dates are anchored at the billing approval moment (CHARGED transition).
    const anchor = approvalDate ?? new Date();
    const paymentConfig = (withdrawal.paymentConfig as any) ?? null;
    const generatedInstallments = paymentConfig
      ? this.generateInstallmentsFromPaymentConfig(paymentConfig, anchor, totalAmount, anchor)
      : this.generateInstallmentsFromCondition(
          withdrawal.paymentCondition || null,
          anchor,
          totalAmount,
          anchor,
        );

    if (generatedInstallments.length === 0) {
      this.logger.warn(
        `[INVOICE_GEN_EW] No installments generated for withdrawal ${externalOperationId} (condition=${withdrawal.paymentCondition}, paymentConfig=${JSON.stringify(paymentConfig)}), skipping invoice generation.`,
      );
      return [];
    }

    this.logger.log(
      `[INVOICE_GEN_EW] Generated ${generatedInstallments.length} installment(s) for withdrawal ${externalOperationId}`,
    );

    const invoiceIds: string[] = [];

    await this.prisma.$transaction(async tx => {
      // Skip if an active (non-cancelled) invoice already exists for this withdrawal.
      // Cancelled invoices are intentionally excluded so re-billing after cancellation
      // creates fresh documents instead of reusing stale ones.
      const existingInvoice = await tx.invoice.findFirst({
        where: { externalOperationId, status: { not: 'CANCELLED' } },
      });

      if (existingInvoice) {
        this.logger.warn(
          `[INVOICE_GEN_EW] Active invoice already exists for withdrawal ${externalOperationId} (invoice ${existingInvoice.id}), skipping.`,
        );
        invoiceIds.push(existingInvoice.id);
        return;
      }

      // Clean up any cancelled invoices for this withdrawal before creating new ones.
      // Cancelled invoices leave behind installments with the same (externalOperationId, number)
      // which would cause a unique-constraint violation when we create fresh installments below.
      const cancelledInvoices = await tx.invoice.findMany({
        where: { externalOperationId, status: 'CANCELLED' },
        select: { id: true },
      });
      if (cancelledInvoices.length > 0) {
        const ids = cancelledInvoices.map(i => i.id);

        // H3a: never hard-delete PAID installments (and their bank slips) during
        // re-generation cleanup — they are real financial history. If any PAID
        // installment exists, abort with a clear error.
        const paidCount = await tx.installment.count({
          where: {
            status: 'PAID',
            OR: [{ invoiceId: { in: ids } }, { externalOperationId, invoiceId: null }],
          },
        });
        if (paidCount > 0) {
          throw new BadRequestException(
            'Não é possível regenerar o faturamento: existem parcelas pagas vinculadas a faturas canceladas desta operação externa. Trate as parcelas pagas manualmente antes de regenerar.',
          );
        }

        await tx.installment.deleteMany({
          where: {
            status: { not: 'PAID' },
            OR: [{ invoiceId: { in: ids } }, { externalOperationId, invoiceId: null }],
          },
        });
        await tx.invoice.deleteMany({ where: { id: { in: ids } } });
        this.logger.log(
          `[INVOICE_GEN_EW] Cleaned up ${ids.length} cancelled invoice(s) for withdrawal ${externalOperationId} before re-generation.`,
        );
      }

      // Create the Invoice
      const invoice = await tx.invoice.create({
        data: {
          externalOperationId,
          customerId: withdrawal.customerId!,
          totalAmount: totalAmount,
          paidAmount: 0,
          status: 'ACTIVE',
          createdById: userId,
        },
      });

      invoiceIds.push(invoice.id);

      this.logger.log(
        `[INVOICE_GEN_EW] Invoice ${invoice.id} created (status=ACTIVE, total=${totalAmount})`,
      );

      // generateBankSlip=false means the customer pays via direct transfer/PIX — no boleto needed.
      const shouldCreateBankSlips = withdrawal.generateBankSlip !== false;

      if (!shouldCreateBankSlips) {
        this.logger.log(
          `[INVOICE_GEN_EW] Skipping BankSlip creation for withdrawal ${externalOperationId}: generateBankSlip=false`,
        );
      }

      // Create installments and optionally create BankSlips
      for (const instData of generatedInstallments) {
        const inst = await tx.installment.create({
          data: {
            externalOperationId,
            invoiceId: invoice.id,
            number: instData.number,
            dueDate: instData.dueDate,
            amount: instData.amount,
            paidAmount: 0,
            status: 'PENDING',
          },
        });

        if (shouldCreateBankSlips) {
          const nossoNumero = this.generateTemporaryNossoNumero(inst.id);

          await tx.bankSlip.create({
            data: {
              installmentId: inst.id,
              nossoNumero: nossoNumero,
              type: 'NORMAL',
              amount: Number(inst.amount),
              dueDate: inst.dueDate,
              status: 'CREATING',
            },
          });

          this.logger.log(
            `[INVOICE_GEN_EW]   Installment #${instData.number}: id=${inst.id}, amount=${instData.amount}, dueDate=${instData.dueDate}, bankSlip nossoNumero=${nossoNumero}, status=CREATING`,
          );
        } else {
          this.logger.log(
            `[INVOICE_GEN_EW]   Installment #${instData.number}: id=${inst.id}, amount=${instData.amount}, dueDate=${instData.dueDate}, no BankSlip (custom payment)`,
          );
        }
      }

      // Create NfseDocument for municipal emission (Elotech OXY) only if generateInvoice is true
      if (withdrawal.generateInvoice !== false) {
        await tx.nfseDocument.create({
          data: {
            invoiceId: invoice.id,
            status: 'PENDING',
          },
        });
        this.logger.log(
          `[INVOICE_GEN_EW] NfseDocument created for invoice ${invoice.id} (status=PENDING)`,
        );
      } else {
        this.logger.log(
          `[INVOICE_GEN_EW] Skipping NfseDocument for invoice ${invoice.id}: generateInvoice=false`,
        );
      }

      this.logger.log(
        `[INVOICE_GEN_EW] Invoice ${invoice.id} fully created for customer ${withdrawal.customer?.fantasyName} (${withdrawal.customerId}): ` +
          `${generatedInstallments.length} installment(s), total: ${totalAmount}`,
      );
    });

    this.logger.log(
      `[INVOICE_GEN_EW] ====== Invoice generation complete for withdrawal ${externalOperationId}: ${invoiceIds.length} invoice(s) [${invoiceIds.join(', ')}] ======`,
    );

    return invoiceIds;
  }

  /**
   * After invoices are created, immediately register all CREATING bank slips at Sicredi.
   * This is called right after generateInvoicesForTask so bank slips go active immediately.
   * The scheduler serves as a fallback for any that fail here.
   */
  async registerBankSlipsAtSicredi(invoiceIds: string[]): Promise<void> {
    this.logger.log(
      `[BOLETO_REGISTER] Registering bank slips at Sicredi for ${invoiceIds.length} invoice(s)`,
    );

    const installments = await this.prisma.installment.findMany({
      where: {
        invoiceId: { in: invoiceIds },
        bankSlip: { status: BANK_SLIP_STATUS.CREATING },
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
      `[BOLETO_REGISTER] Found ${installments.length} installment(s) with CREATING bank slips`,
    );

    const { codigoBeneficiario } = this.sicrediAuthService.config;
    let created = 0;
    let errors = 0;

    for (const installment of installments) {
      const customer = installment.invoice?.customer;
      if (!customer || !installment.bankSlip) continue;

      // Atomically claim the bank slip: CREATING → REGISTERING
      // This prevents the scheduler or another concurrent call from also registering the same boleto
      const claimed = await this.prisma.bankSlip.updateMany({
        where: {
          id: installment.bankSlip.id,
          status: BANK_SLIP_STATUS.CREATING,
        },
        data: { status: BANK_SLIP_STATUS.REGISTERING },
      });

      if (claimed.count === 0) {
        this.logger.warn(
          `[BOLETO_REGISTER] BankSlip ${installment.bankSlip.id} already being processed (status=${installment.bankSlip.status}), skipping`,
        );
        continue;
      }

      const cleanCnpj = (customer.cnpj || '').replace(/\D/g, '');
      const cleanCpf = (customer.cpf || '').replace(/\D/g, '');
      const customerDocument = cleanCnpj.length === 14 ? cleanCnpj : cleanCpf;
      const tipoPessoa = cleanCnpj.length === 14 ? 'PESSOA_JURIDICA' : 'PESSOA_FISICA';
      const customerName = customer.fantasyName || customer.corporateName || '';

      if ((customerDocument.length !== 14 && customerDocument.length !== 11) || !customerName) {
        this.logger.error(
          `[BOLETO_REGISTER] Skipping installment ${installment.id}: invalid document (${customerDocument}) or name (${customerName})`,
        );
        await this.prisma.bankSlip.update({
          where: { id: installment.bankSlip.id },
          data: {
            status: 'ERROR',
            errorMessage: `Dados do cliente inválidos: CNPJ=${cleanCnpj}, CPF=${cleanCpf}, Nome=${customerName}`,
            errorCount: { increment: 1 },
          },
        });
        errors++;
        continue;
      }

      try {
        this.logger.log(
          `[BOLETO_REGISTER] Creating boleto for installment ${installment.id}: customer=${customerName}, amount=${installment.amount}, dueDate=${installment.dueDate}`,
        );

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
            cep: (customer.zipCode || '').replace(/\D/g, '') || undefined,
            telefone: (customer.phones as any)?.[0]?.replace(/\D/g, '') || undefined,
            email: customer.email || undefined,
          },
          especieDocumento: 'DUPLICATA_MERCANTIL_INDICACAO',
          seuNumero: this.buildSeuNumero(installment),
          informativos: this.buildBoletoLines(installment),
          dataVencimento: (() => {
            const d = new Date(installment.dueDate);
            // Sicredi rejects past due dates — clamp to today (São Paulo) if needed
            const nowSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
            nowSP.setHours(0, 0, 0, 0);
            const effective = d < nowSP ? nowSP : d;
            return `${effective.getFullYear()}-${String(effective.getMonth() + 1).padStart(2, '0')}-${String(effective.getDate()).padStart(2, '0')}`;
          })(),
          valor: Number(installment.amount),
        });

        const pixQrCode =
          (boletoResponse as any).qrCode || (boletoResponse as any).codigoQrCode || null;

        await this.prisma.bankSlip.update({
          where: { id: installment.bankSlip.id },
          data: {
            nossoNumero: boletoResponse.nossoNumero,
            seuNumero: this.buildSeuNumero(installment),
            barcode: boletoResponse.codigoBarras,
            digitableLine: boletoResponse.linhaDigitavel,
            pixQrCode,
            txid: (boletoResponse as any).txid || null,
            status: 'ACTIVE',
            errorMessage: null,
            errorCount: 0,
            lastSyncAt: new Date(),
          },
        });

        this.logger.log(
          `[BOLETO_REGISTER] Boleto created: nossoNumero=${boletoResponse.nossoNumero}, barcode=${boletoResponse.codigoBarras}`,
        );
        created++;
      } catch (error) {
        errors++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[BOLETO_REGISTER] Failed for installment ${installment.id}: ${errorMsg}`,
        );
        await this.prisma.bankSlip.update({
          where: { id: installment.bankSlip.id },
          data: { status: 'ERROR', errorMessage: errorMsg, errorCount: { increment: 1 } },
        });
      }
    }

    this.logger.log(`[BOLETO_REGISTER] Complete. Created: ${created}, Errors: ${errors}`);
  }

  /**
   * Build the seuNumero field for a Sicredi boleto.
   * Priority: NfSe number (if enabled + authorized) → truck plate → installment ID fragment.
   * Max 10 alphanumeric chars per API spec.
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
      // seuNumero shows just the NFS-e number — no installment suffix.
      // nossoNumero (assigned by Sicredi) already uniquely identifies each bank slip.
      const nfseStr = String(authorizedNfse.nfseNumber).slice(-(10 - 2));
      return `NF${nfseStr}`;
    }
    if (truckPlate) {
      const plateClean = truckPlate.replace(/[^A-Za-z0-9]/g, '');
      // Reserve last char(s) for installment number so slips on the same truck are unique.
      return (plateClean.slice(0, 10 - num.length) + num).slice(0, 10);
    }
    // UUID fragment is already unique per installment — no suffix needed.
    return installment.id.replace(/-/g, '').substring(0, 10);
  }

  /**
   * Build informativo lines for a Sicredi boleto (INFORMATIVO box on PDF).
   * Format matches the NfSe discriminacao: same vehicle/service description.
   * Up to 5 lines, 80 chars each.
   */
  private buildInformativo(installment: any): string[] | undefined {
    return this.buildBoletoLines(installment);
  }

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

  /**
   * Convert a structured PaymentConfig object into installment records.
   * Due dates are anchored to `approvalDate` (billing approval time) so that
   * "first payment in N days" always means N days from the moment billing was approved.
   * Falls back to `finishedAt` when `approvalDate` is not provided (backward compat).
   */
  private generateInstallmentsFromPaymentConfig(
    paymentConfig: {
      type: string;
      cashDays?: number;
      installmentCount?: number;
      installmentStep?: number;
      entryDays?: number;
      specificDate?: string;
    },
    finishedAt: Date,
    total: number,
    approvalDate?: Date,
  ): { number: number; dueDate: Date; amount: number }[] {
    if (!Number.isFinite(total) || total <= 0) return [];

    // Use the billing approval date as the anchor so "first payment in N days" means
    // N days from the moment the financial team approved billing — not from when the
    // task was finished (which can be months in the past, collapsing all dates to minDueDate).
    const anchor = approvalDate ?? finishedAt;
    const baseDate = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(), 12, 0, 0),
    );

    const now = new Date();
    // Bumping the floor to the next business day is correct: if "today + 3" is
    // a Saturday, the customer effectively can't pay until Monday anyway.
    const minDueDate = nextBrazilianBusinessDay(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3, 12, 0, 0)),
    );

    const addDays = (base: Date, days: number): Date => {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + days);
      return d;
    };

    const ensureMinDate = (date: Date): Date => (date < minDueDate ? minDueDate : date);

    const resolveFirstDueDate = (): Date => {
      if (paymentConfig.specificDate) {
        const [y, m, d] = paymentConfig.specificDate.split('-').map(Number);
        const specific = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        return ensureMinDate(specific);
      }
      if (paymentConfig.type === 'CASH') {
        return ensureMinDate(addDays(baseDate, paymentConfig.cashDays ?? 5));
      }
      return ensureMinDate(addDays(baseDate, paymentConfig.entryDays ?? 5));
    };

    if (paymentConfig.type === 'CASH') {
      return [
        { number: 1, dueDate: nextBrazilianBusinessDay(resolveFirstDueDate()), amount: total },
      ];
    }

    if (paymentConfig.type === 'INSTALLMENTS') {
      const count = paymentConfig.installmentCount ?? 2;
      const step = paymentConfig.installmentStep ?? 20;
      const entryDays = paymentConfig.entryDays ?? 5;
      const firstDue = resolveFirstDueDate();
      const totalCents = Math.round(total * 100);
      const baseCents = Math.floor(totalCents / count);

      return Array.from({ length: count }, (_, i) => {
        // When the caller set a specificDate, cascade all subsequent installments from
        // that anchor — they chose it intentionally.
        // Otherwise calculate each installment independently from the approval-date anchor
        // so future ones keep their natural schedule and only truly past dates get clamped.
        const rawDueDate =
          i === 0
            ? firstDue
            : paymentConfig.specificDate
              ? addDays(firstDue, step * i)
              : ensureMinDate(addDays(baseDate, entryDays + step * i));
        // Roll forward off Saturdays/Sundays/national holidays so the boleto is
        // always payable on its due date.
        const dueDate = nextBrazilianBusinessDay(rawDueDate);
        const isLast = i === count - 1;
        const amount = isLast ? (totalCents - baseCents * (count - 1)) / 100 : baseCents / 100;
        return { number: i + 1, dueDate, amount };
      });
    }

    return [];
  }

  /**
   * Convert paymentCondition + total into installment records.
   * Due dates are anchored to approvalDate (falls back to finishedAt).
   * - CASH_5: 1 payment, 5 days from anchor
   * - CASH_40: 1 payment, 40 days from anchor
   * - INSTALLMENTS_N: first at 5 days, subsequent +20 days each; cascades if any date is pushed forward
   */
  private generateInstallmentsFromCondition(
    paymentCondition: string | null,
    finishedAt: Date,
    total: number,
    approvalDate?: Date,
  ): { number: number; dueDate: Date; amount: number }[] {
    if (!Number.isFinite(total) || total <= 0) return [];
    if (!paymentCondition || paymentCondition === 'CUSTOM') return [];

    // Use the billing approval date as anchor — same rationale as generateInstallmentsFromPaymentConfig:
    // "first payment in N days" means N days from billing approval, not from a possibly stale finishedAt
    // (which can be weeks/months in the past, collapsing all installment dates to the same minimum floor).
    const anchor = approvalDate ?? finishedAt;
    const baseDate = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(), 12, 0, 0),
    );

    const addDays = (base: Date, days: number): Date => {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + days);
      return d;
    };

    // Minimum due date: 3 days from today (noon UTC), then rolled to the next
    // Brazilian business day so the floor itself is payable.
    const now = new Date();
    const minDueDate = nextBrazilianBusinessDay(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3, 12, 0, 0)),
    );

    const ensureMinDate = (date: Date): Date => {
      return date < minDueDate ? minDueDate : date;
    };

    if (paymentCondition === 'CASH_5') {
      return [
        {
          number: 1,
          dueDate: nextBrazilianBusinessDay(ensureMinDate(addDays(baseDate, 5))),
          amount: total,
        },
      ];
    }

    if (paymentCondition === 'CASH_40') {
      return [
        {
          number: 1,
          dueDate: nextBrazilianBusinessDay(ensureMinDate(addDays(baseDate, 40))),
          amount: total,
        },
      ];
    }

    const conditionMap: Record<string, number> = {
      INSTALLMENTS_2: 2,
      INSTALLMENTS_3: 3,
      INSTALLMENTS_4: 4,
      INSTALLMENTS_5: 5,
      INSTALLMENTS_6: 6,
      INSTALLMENTS_7: 7,
    };

    const totalInstallments = conditionMap[paymentCondition] || 1;
    const totalCents = Math.round(total * 100);
    const baseCents = Math.floor(totalCents / totalInstallments);
    const installmentAmount = baseCents / 100;

    const installments: { number: number; dueDate: Date; amount: number }[] = [];
    let prevDueDate: Date | null = null;
    for (let i = 0; i < totalInstallments; i++) {
      let rawDate = addDays(baseDate, 5 + i * 20);
      // Cascade safety: if a prior installment was pushed forward (by ensureMinDate or a holiday),
      // ensure this one is at least 20 days after it — prevents two installments collapsing to the
      // same date when multiple natural dates fall before the minimum-due-date floor.
      if (prevDueDate) {
        const cascaded = addDays(prevDueDate, 20);
        if (rawDate < cascaded) rawDate = cascaded;
      }
      const dueDate = nextBrazilianBusinessDay(ensureMinDate(rawDate));
      prevDueDate = dueDate;

      const isLast = i === totalInstallments - 1;
      const amount = isLast
        ? (totalCents - baseCents * (totalInstallments - 1)) / 100
        : installmentAmount;

      installments.push({ number: i + 1, dueDate, amount });
    }

    return installments;
  }

  /**
   * Generate a temporary nossoNumero for a bank slip.
   * Uses the installment UUID to guarantee uniqueness (installmentId is @unique on BankSlip).
   * This placeholder is overwritten by Sicredi's real nossoNumero when the boleto is created.
   */
  private generateTemporaryNossoNumero(installmentId: string): string {
    return `TMP-${installmentId}`;
  }
}
