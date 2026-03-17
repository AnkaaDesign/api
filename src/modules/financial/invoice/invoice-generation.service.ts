import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SicrediService } from '@modules/integrations/sicredi/sicredi.service';
import { SicrediAuthService } from '@modules/integrations/sicredi/sicredi-auth.service';
import {
  INVOICE_STATUS,
  INSTALLMENT_STATUS,
  BANK_SLIP_STATUS,
} from '@constants';
import type { Invoice } from '@types';

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
      throw new NotFoundException(
        `Orçamento não encontrado para a tarefa ${taskId}.`,
      );
    }

    const quote = task.quote;
    const customerConfigs = quote.customerConfigs;

    this.logger.log(`[INVOICE_GEN] Quote ${quote.id}: ${customerConfigs?.length ?? 0} customer config(s)`);

    if (!customerConfigs || customerConfigs.length === 0) {
      this.logger.warn(
        `[INVOICE_GEN] No customer configs found for task ${taskId}, skipping invoice generation.`,
      );
      return [];
    }

    const invoiceIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const config of customerConfigs) {
        // Check if an invoice already exists for this customerConfig
        const existingInvoice = await tx.invoice.findUnique({
          where: { customerConfigId: config.id },
        });

        if (existingInvoice) {
          this.logger.warn(
            `[INVOICE_GEN] Invoice already exists for customerConfig ${config.id} (invoice ${existingInvoice.id}), skipping.`,
          );
          invoiceIds.push(existingInvoice.id);
          continue;
        }

        const totalAmount = Number(config.total);
        this.logger.log(`[INVOICE_GEN] CustomerConfig ${config.id}: customer=${config.customer?.fantasyName} (${config.customer?.cnpj}), total=${totalAmount}`);

        // Generate installments from payment condition and task.finishedAt
        const finishedAt = task.finishedAt;
        if (!finishedAt) {
          this.logger.warn(
            `[INVOICE_GEN] Task ${taskId} has no finishedAt date, skipping invoice generation for customerConfig ${config.id}.`,
          );
          continue;
        }

        const generatedInstallments = this.generateInstallmentsFromCondition(
          config.paymentCondition || null,
          finishedAt,
          totalAmount,
        );

        if (generatedInstallments.length === 0) {
          this.logger.warn(
            `[INVOICE_GEN] No installments generated for customerConfig ${config.id} (condition=${config.paymentCondition}), skipping invoice generation.`,
          );
          continue;
        }

        this.logger.log(`[INVOICE_GEN] Generated ${generatedInstallments.length} installment(s) for customerConfig ${config.id}`);

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

        this.logger.log(`[INVOICE_GEN] Invoice ${invoice.id} created (status=ACTIVE, total=${totalAmount})`);

        // Determine if bank slips should be generated:
        // Skip when customPaymentText is set (custom payment method can't be parsed for boleto installments)
        const hasCustomPaymentText = !!(config.customPaymentText && config.customPaymentText.trim());
        const shouldCreateBankSlips = !hasCustomPaymentText;

        if (hasCustomPaymentText) {
          this.logger.log(
            `[INVOICE_GEN] Skipping BankSlip creation for customerConfig ${config.id}: custom payment text is set`,
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
        const shouldGenerateNfse = config.generateInvoice !== false;

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
   * After invoices are created, immediately register all CREATING bank slips at Sicredi.
   * This is called right after generateInvoicesForTask so bank slips go active immediately.
   * The scheduler serves as a fallback for any that fail here.
   */
  async registerBankSlipsAtSicredi(invoiceIds: string[]): Promise<void> {
    this.logger.log(`[BOLETO_REGISTER] Registering bank slips at Sicredi for ${invoiceIds.length} invoice(s)`);

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
                address: true,
                city: true,
                state: true,
                zipCode: true,
                phones: true,
                email: true,
              },
            },
          },
        },
      },
    });

    this.logger.log(`[BOLETO_REGISTER] Found ${installments.length} installment(s) with CREATING bank slips`);

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
      const customerName = customer.fantasyName || customer.corporateName || '';

      if (cleanCnpj.length < 14 || !customerName) {
        this.logger.error(`[BOLETO_REGISTER] Skipping installment ${installment.id}: invalid CNPJ (${cleanCnpj}) or name (${customerName})`);
        await this.prisma.bankSlip.update({
          where: { id: installment.bankSlip.id },
          data: { status: 'ERROR', errorMessage: `Dados do cliente inválidos: CNPJ=${cleanCnpj}, Nome=${customerName}`, errorCount: { increment: 1 } },
        });
        errors++;
        continue;
      }

      try {
        this.logger.log(`[BOLETO_REGISTER] Creating boleto for installment ${installment.id}: customer=${customerName}, amount=${installment.amount}, dueDate=${installment.dueDate}`);

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
            cep: (customer.zipCode || '').replace(/\D/g, '') || undefined,
            telefone: (customer.phones as any)?.[0]?.replace(/\D/g, '') || undefined,
            email: customer.email || undefined,
          },
          especieDocumento: 'DUPLICATA_MERCANTIL_INDICACAO',
          seuNumero: installment.id.replace(/-/g, '').substring(0, 10),
          dataVencimento: new Date(installment.dueDate).toISOString().split('T')[0],
          valor: Number(installment.amount),
        });

        const pixQrCode = (boletoResponse as any).qrCode || (boletoResponse as any).codigoQrCode || null;

        await this.prisma.bankSlip.update({
          where: { id: installment.bankSlip.id },
          data: {
            nossoNumero: boletoResponse.nossoNumero,
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

        this.logger.log(`[BOLETO_REGISTER] Boleto created: nossoNumero=${boletoResponse.nossoNumero}, barcode=${boletoResponse.codigoBarras}`);
        created++;
      } catch (error) {
        errors++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(`[BOLETO_REGISTER] Failed for installment ${installment.id}: ${errorMsg}`);
        await this.prisma.bankSlip.update({
          where: { id: installment.bankSlip.id },
          data: { status: 'ERROR', errorMessage: errorMsg, errorCount: { increment: 1 } },
        });
      }
    }

    this.logger.log(`[BOLETO_REGISTER] Complete. Created: ${created}, Errors: ${errors}`);
  }

  /**
   * Convert paymentCondition + finishedAt + total into installment records.
   * Due dates are calculated from task.finishedAt:
   * - CASH_5: 1 payment, 5 days from finishedAt
   * - CASH_40: 1 payment, 40 days from finishedAt
   * - INSTALLMENTS_N: first at 5 days from finishedAt, subsequent +20 days each
   */
  private generateInstallmentsFromCondition(
    paymentCondition: string | null,
    finishedAt: Date,
    total: number,
  ): { number: number; dueDate: Date; amount: number }[] {
    if (!Number.isFinite(total) || total <= 0) return [];
    if (!paymentCondition || paymentCondition === 'CUSTOM') return [];

    const baseDate = new Date(finishedAt);

    if (paymentCondition === 'CASH_5') {
      const dueDate = new Date(baseDate);
      dueDate.setDate(dueDate.getDate() + 5);
      return [{ number: 1, dueDate, amount: total }];
    }

    if (paymentCondition === 'CASH_40') {
      const dueDate = new Date(baseDate);
      dueDate.setDate(dueDate.getDate() + 40);
      return [{ number: 1, dueDate, amount: total }];
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
    for (let i = 0; i < totalInstallments; i++) {
      const dueDate = new Date(baseDate);
      dueDate.setDate(dueDate.getDate() + 5 + i * 20);

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
