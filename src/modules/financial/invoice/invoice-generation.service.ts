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
 * Service responsible for auto-generating invoices from approved task pricings.
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
   * Generate invoices for all customer configs of a task's approved pricing.
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
   * @param taskId - UUID of the task whose pricing to generate invoices for
   * @param userId - UUID of the user triggering the generation
   * @returns Array of created invoice IDs
   */
  async generateInvoicesForTask(
    taskId: string,
    userId: string,
  ): Promise<string[]> {
    this.logger.log(`[INVOICE_GEN] ====== Starting invoice generation for task ${taskId} ======`);

    // Load the task with its pricing and customer configs
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        pricing: {
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

    this.logger.log(`[INVOICE_GEN] Task found: ${task.id}, has pricing: ${!!task.pricing}`);

    if (!task.pricing) {
      this.logger.error(`[INVOICE_GEN] No pricing found for task ${taskId}`);
      throw new NotFoundException(
        `Orçamento não encontrado para a tarefa ${taskId}.`,
      );
    }

    const pricing = task.pricing;
    const customerConfigs = pricing.customerConfigs;

    this.logger.log(`[INVOICE_GEN] Pricing ${pricing.id}: ${customerConfigs?.length ?? 0} customer config(s)`);

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

        // Query existing installments created at pricing time
        const existingInstallments = await tx.installment.findMany({
          where: { customerConfigId: config.id },
          orderBy: { number: 'asc' },
        });

        this.logger.log(`[INVOICE_GEN] Found ${existingInstallments.length} installment(s) for customerConfig ${config.id}`);

        if (existingInstallments.length === 0) {
          this.logger.warn(
            `[INVOICE_GEN] No installments found for customerConfig ${config.id}, skipping invoice generation.`,
          );
          continue;
        }

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

        // Link existing installments to the invoice and create BankSlips
        for (const inst of existingInstallments) {
          await tx.installment.update({
            where: { id: inst.id },
            data: { invoiceId: invoice.id },
          });

          // Always create BankSlip (only bank slip workflow via Sicredi)
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
            `[INVOICE_GEN]   Installment #${inst.number}: id=${inst.id}, amount=${inst.amount}, dueDate=${inst.dueDate}, bankSlip nossoNumero=${nossoNumero}, status=CREATING`,
          );
        }

        // NFSe Nacional disabled: Ibiporã still uses municipal emission.
        // NfseDocument creation will be re-enabled once the city migrates to the national system.
        // await tx.nfseDocument.create({
        //   data: {
        //     invoiceId: invoice.id,
        //     status: 'PENDING',
        //     totalAmount: totalAmount,
        //   },
        // });
        this.logger.log(
          `[INVOICE_GEN] Invoice ${invoice.id} fully created for customer ${config.customer?.fantasyName} (${config.customerId}): ` +
            `${existingInstallments.length} installment(s), total: ${totalAmount}`,
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
   * Generate a temporary nossoNumero for a bank slip.
   * Uses the installment UUID to guarantee uniqueness (installmentId is @unique on BankSlip).
   * This placeholder is overwritten by Sicredi's real nossoNumero when the boleto is created.
   */
  private generateTemporaryNossoNumero(installmentId: string): string {
    return `TMP-${installmentId}`;
  }
}
