import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NfseService } from './nfse.service';
import { NfseStatus } from '@prisma/client';

/**
 * Scheduler for automatic NFS-e emission.
 *
 * Runs a daily job at 9 AM to emit PENDING NFS-e documents to the municipality API.
 * Also retries ERROR documents that have passed their retryAfter window (max 3 attempts).
 */
@Injectable()
export class NfseEmissionScheduler {
  private readonly logger = new Logger(NfseEmissionScheduler.name);
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nfseService: NfseService,
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
                },
              },
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

          // Build the input for NfseService.emitNfse()
          const emitInput = {
            id: invoice.id,
            totalAmount: Number(doc.totalAmount),
            customer: {
              cnpj: customer.cnpj || undefined,
              cpf: customer.cpf || undefined,
              name: customer.fantasyName || '',
              email: customer.email || undefined,
              phone: customer.phones?.[0] || undefined,
              address: customer.address
                ? {
                    cityCode: 0, // Falls back to NFSE_CITY_CODE env var in buildDps()
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
            },
            description:
              doc.description ||
              `Serviço ref. OS ${task.serialNumber || task.name}`,
          };

          await this.nfseService.emitNfse(emitInput);
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
}
