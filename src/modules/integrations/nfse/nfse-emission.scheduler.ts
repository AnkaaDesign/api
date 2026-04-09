import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NfseService } from './nfse.service';
import { ElotechOxyNfseService } from './elotech-oxy-nfse.service';
import { NfseStatus } from '@prisma/client';

/**
 * Scheduler for automatic NFS-e emission.
 *
 * Uses the Elotech OXY municipal REST API (Ibiporã) for emission.
 * The national SEFIN integration is preserved but disabled until the city migrates.
 *
 * Runs a daily job at 9 AM to emit PENDING NFS-e documents.
 * Also retries ERROR documents that have passed their retryAfter window (max 3 attempts).
 */
@Injectable()
export class NfseEmissionScheduler {
  private readonly logger = new Logger(NfseEmissionScheduler.name);
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nfseService: NfseService,
    private readonly municipalNfseService: ElotechOxyNfseService,
  ) {}

  @Cron('0 9 * * *', {
    name: 'nfse-emission',
    timeZone: 'America/Sao_Paulo',
  })
  async emitPendingNfses(): Promise<void> {
    if (this.isProcessing) {
      this.logger.warn('NFS-e emission already in progress, skipping');
      return;
    }

    this.isProcessing = true;

    try {
      this.logger.log('Starting NFS-e emission job...');

      const now = new Date();

      // Recover stuck PROCESSING docs (stuck for more than 5 minutes)
      const stuckThreshold = new Date(now.getTime() - 5 * 60 * 1000);
      const unstuck = await this.prisma.nfseDocument.updateMany({
        where: {
          status: NfseStatus.PROCESSING,
          updatedAt: { lt: stuckThreshold },
        },
        data: {
          status: NfseStatus.PENDING,
          errorMessage: 'Recovered from stuck PROCESSING state',
        },
      });
      if (unstuck.count > 0) {
        this.logger.warn(
          `Recovered ${unstuck.count} NFS-e document(s) stuck in PROCESSING state`,
        );
      }

      // Find NfseDocuments that are PENDING, or ERROR with retryAfter passed and < 3 errors
      const pendingDocs = await this.prisma.nfseDocument.findMany({
        where: {
          OR: [
            { status: NfseStatus.PENDING },
            {
              status: NfseStatus.ERROR,
              errorCount: { lt: 3 },
              retryAfter: { lte: now },
            },
          ],
        },
        include: {
          invoice: {
            include: {
              customer: {
                select: {
                  id: true,
                  fantasyName: true,
                  corporateName: true,
                  cnpj: true,
                  cpf: true,
                  email: true,
                  phones: true,
                  address: true,
                  city: true,
                  state: true,
                  zipCode: true,
                  neighborhood: true,
                  addressNumber: true,
                  addressComplement: true,
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
                  quote: {
                    select: {
                      services: {
                        select: {
                          description: true,
                          amount: true,
                          invoiceToCustomerId: true,
                        },
                        orderBy: { position: 'asc' as const },
                      },
                    },
                  },
                },
              },
              customerConfig: { select: { orderNumber: true, discountType: true, discountValue: true } },
            },
          },
        },
      });

      this.logger.log(
        `Found ${pendingDocs.length} NFS-e document(s) to emit`,
      );

      let emitted = 0;
      let errors = 0;

      for (const doc of pendingDocs) {
        try {
          // Atomically claim the document: PENDING/ERROR → PROCESSING
          // This prevents concurrent scheduler instances or manual triggers from processing the same document
          const claimed = await this.prisma.nfseDocument.updateMany({
            where: {
              id: doc.id,
              status: { in: [NfseStatus.PENDING, NfseStatus.ERROR] },
            },
            data: {
              status: NfseStatus.PROCESSING,
              errorMessage: null,
            },
          });

          if (claimed.count === 0) {
            this.logger.warn(
              `NfseDocument ${doc.id} already claimed by another process, skipping`,
            );
            continue;
          }

          const invoice = doc.invoice;
          if (!invoice) {
            this.logger.warn(
              `NfseDocument ${doc.id} has no invoice, skipping`,
            );
            // Revert status since we can't process it
            await this.prisma.nfseDocument.update({
              where: { id: doc.id },
              data: { status: NfseStatus.ERROR, errorMessage: 'No invoice linked' },
            });
            continue;
          }

          const customer = invoice.customer;
          if (!customer) {
            this.logger.warn(
              `NfseDocument ${doc.id} has no customer, skipping`,
            );
            await this.prisma.nfseDocument.update({
              where: { id: doc.id },
              data: { status: NfseStatus.ERROR, errorMessage: 'No customer linked' },
            });
            continue;
          }

          const task = invoice.task;
          if (!task) {
            this.logger.warn(
              `NfseDocument ${doc.id} has no task, skipping`,
            );
            await this.prisma.nfseDocument.update({
              where: { id: doc.id },
              data: { status: NfseStatus.ERROR, errorMessage: 'No task linked' },
            });
            continue;
          }

          // Build services list from task quote, filtered by customer
          const allServices =
            (task as any).quote?.services as
              | Array<{
                  description: string;
                  amount: any;
                  invoiceToCustomerId: string | null;
                }>
              | undefined;

          const services = allServices
            ?.filter(
              (s) =>
                !s.invoiceToCustomerId ||
                s.invoiceToCustomerId === customer.id,
            )
            .map((s) => ({
              description: s.description,
              amount: Number(s.amount),
            }));

          // Get customer config discount (global discount for this customer)
          const customerConfig = (invoice as any).customerConfig;
          const configDiscountType = customerConfig?.discountType || undefined;
          const configDiscountValue = customerConfig?.discountValue != null ? Number(customerConfig.discountValue) : undefined;

          // Build the input for municipal NFSe emission (Elotech OXY)
          const truck = (task as any).truck;
          const emitInput = {
            id: invoice.id,
            totalAmount: Number(invoice.totalAmount),
            customer: {
              cnpj: customer.cnpj || undefined,
              cpf: customer.cpf || undefined,
              name: customer.fantasyName || '',
              corporateName: (customer as any).corporateName || undefined,
              email: customer.email || undefined,
              phone: customer.phones?.[0] || undefined,
              address: customer.address
                ? {
                    cityName: customer.city || undefined,
                    state: customer.state || undefined,
                    zipCode: customer.zipCode || '',
                    street: customer.address,
                    number: customer.addressNumber || 'S/N',
                    complement: customer.addressComplement || undefined,
                    neighborhood: customer.neighborhood || '',
                  }
                : undefined,
            },
            task: {
              id: task.id,
              name: task.name,
              serialNumber: (task as any).serialNumber || undefined,
            },
            truck: truck
              ? {
                  plate: truck.plate || undefined,
                  chassisNumber: truck.chassisNumber || undefined,
                  category: truck.category || undefined,
                  implementType: truck.implementType || undefined,
                }
              : undefined,
            orderNumber: (invoice as any).customerConfig?.orderNumber || undefined,
            services,
            globalDiscount: (configDiscountType && configDiscountType !== 'NONE' && configDiscountValue)
              ? { type: configDiscountType, value: configDiscountValue }
              : undefined,
          };

          await this.municipalNfseService.emitNfse(emitInput);
          emitted++;

          this.logger.log(
            `NFS-e emitted for invoice ${invoice.id} (task: ${task.name})`,
          );
        } catch (error) {
          errors++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          this.logger.error(
            `Failed to emit NFS-e for document ${doc.id}: ${errorMessage}`,
          );

          // NfseService.emitNfse() already handles error status update,
          // so we don't need to update the doc here
        }
      }

      this.logger.log(
        `NFS-e emission job completed. Emitted: ${emitted}, Errors: ${errors}`,
      );
    } catch (error) {
      this.logger.error('Error during NFS-e emission job:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Emit NfSe documents for specific invoice IDs synchronously.
   * Called during task quote approval so NfSe is authorized BEFORE bank slips are
   * registered at Sicredi — this ensures the NfSe number is available for seuNumero.
   *
   * Does NOT use the global isProcessing lock (targeted, not the full scheduled sweep).
   * emitNfse() handles its own atomic claim internally so concurrent safety is preserved.
   */
  async emitNfseForInvoices(invoiceIds: string[]): Promise<void> {
    if (invoiceIds.length === 0) return;

    this.logger.log(
      `[NFSE_TARGETED] Emitting NfSe for ${invoiceIds.length} invoice(s): [${invoiceIds.join(', ')}]`,
    );

    const docs = await this.prisma.nfseDocument.findMany({
      where: {
        invoiceId: { in: invoiceIds },
        status: { in: [NfseStatus.PENDING, NfseStatus.ERROR] },
      },
      include: {
        invoice: {
          include: {
            customer: {
              select: {
                id: true,
                fantasyName: true,
                corporateName: true,
                cnpj: true,
                cpf: true,
                email: true,
                phones: true,
                address: true,
                city: true,
                state: true,
                zipCode: true,
                neighborhood: true,
                addressNumber: true,
                addressComplement: true,
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
                quote: {
                  select: {
                    services: {
                      select: {
                        description: true,
                        amount: true,
                        invoiceToCustomerId: true,
                      },
                      orderBy: { position: 'asc' as const },
                    },
                  },
                },
              },
            },
            customerConfig: { select: { orderNumber: true, discountType: true, discountValue: true } },
          },
        },
      },
    });

    this.logger.log(
      `[NFSE_TARGETED] Found ${docs.length} NfSe document(s) to emit`,
    );

    let emitted = 0;
    let errors = 0;

    for (const doc of docs) {
      try {
        const invoice = doc.invoice;
        const customer = invoice?.customer;
        const task = invoice?.task;

        if (!invoice || !customer || !task) {
          this.logger.warn(
            `[NFSE_TARGETED] NfseDocument ${doc.id} missing invoice/customer/task — skipping`,
          );
          continue;
        }

        const allServices = (task as any).quote?.services as Array<{
          description: string;
          amount: any;
          invoiceToCustomerId: string | null;
        }> | undefined;

        const services = allServices
          ?.filter((s) => !s.invoiceToCustomerId || s.invoiceToCustomerId === customer.id)
          .map((s) => ({
            description: s.description,
            amount: Number(s.amount),
          }));

        // Get customer config discount (global discount for this customer)
        const customerConfig = (invoice as any).customerConfig;
        const configDiscountType = customerConfig?.discountType || undefined;
        const configDiscountValue = customerConfig?.discountValue != null ? Number(customerConfig.discountValue) : undefined;

        const truck = (task as any).truck;

        await this.municipalNfseService.emitNfse({
          id: invoice.id,
          totalAmount: Number(invoice.totalAmount),
          customer: {
            cnpj: customer.cnpj || undefined,
            cpf: customer.cpf || undefined,
            name: customer.fantasyName || '',
            corporateName: (customer as any).corporateName || undefined,
            email: customer.email || undefined,
            phone: customer.phones?.[0] || undefined,
            address: customer.address
              ? {
                  cityName: customer.city || undefined,
                  state: customer.state || undefined,
                  zipCode: customer.zipCode || '',
                  street: customer.address,
                  number: customer.addressNumber || 'S/N',
                  complement: customer.addressComplement || undefined,
                  neighborhood: customer.neighborhood || '',
                }
              : undefined,
          },
          task: {
            id: task.id,
            name: task.name,
            serialNumber: (task as any).serialNumber || undefined,
          },
          truck: truck
            ? {
                plate: truck.plate || undefined,
                chassisNumber: truck.chassisNumber || undefined,
                category: truck.category || undefined,
                implementType: truck.implementType || undefined,
              }
            : undefined,
          orderNumber: customerConfig?.orderNumber || undefined,
          services,
          globalDiscount: (configDiscountType && configDiscountType !== 'NONE' && configDiscountValue)
            ? { type: configDiscountType, value: configDiscountValue }
            : undefined,
        });

        emitted++;
        this.logger.log(
          `[NFSE_TARGETED] NfSe emitted for invoice ${invoice.id} (task: ${task.name})`,
        );
      } catch (error) {
        errors++;
        this.logger.error(
          `[NFSE_TARGETED] Failed to emit NfSe for document ${doc.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        // emitNfse() already updated the NfseDocument to ERROR status
      }
    }

    this.logger.log(
      `[NFSE_TARGETED] Done. Emitted: ${emitted}, Errors: ${errors}`,
    );
  }
}
