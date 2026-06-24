import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
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
  private isReconcilingCancellations = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nfseService: NfseService,
    private readonly municipalNfseService: ElotechOxyNfseService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  /**
   * Emit nfse.issued (AUTHORIZED) or nfse.rejected (ERROR) to FINANCIAL/ADMIN.
   * Best-effort — never breaks the emission flow. Deep link keyed by taskId.
   */
  private async dispatchNfseOutcomeNotification(
    invoiceId: string,
    outcome: 'AUTHORIZED' | 'ERROR',
    detail?: { nfseNumber?: number | string | null; errorMessage?: string | null },
  ): Promise<void> {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          customer: { select: { fantasyName: true } },
          task: { select: { id: true, name: true } },
          externalOperation: { select: { id: true } },
        },
      });
      if (!invoice) return;

      const customerName = invoice.customer?.fantasyName || 'N/A';
      const taskId = invoice.task?.id ?? invoice.taskId ?? null;
      const withdrawalId = invoice.externalOperation?.id ?? invoice.externalOperationId ?? null;
      const isWithdrawal = !!withdrawalId;
      const taskName = isWithdrawal ? 'Operação Externa' : invoice.task?.name || 'N/A';
      // "da tarefa X" for task-backed invoices, "da operação externa" for withdrawal-backed.
      const refLabel = isWithdrawal ? 'da operação externa' : `da tarefa ${taskName}`;

      const webUrl = isWithdrawal
        ? `/estoque/operacoes-externas/detalhes/${withdrawalId}`
        : taskId
          ? `/financeiro/faturamento/detalhes/${taskId}`
          : undefined;
      // Mobile billing detail screen is keyed by the TASK id
      // (src/app/(tabs)/financeiro/faturamento/detalhes/[id].tsx). Omit when
      // there is no task (withdrawal-backed invoices have no mobile screen).
      const mobileUrl =
        !isWithdrawal && taskId ? `/(tabs)/financeiro/faturamento/detalhes/${taskId}` : undefined;

      if (outcome === 'AUTHORIZED') {
        await this.dispatchService.dispatchByConfiguration('nfse.issued', 'system', {
          entityType: 'NfseDocument',
          entityId: taskId ?? withdrawalId ?? invoiceId,
          action: 'issued',
          data: {
            customerName,
            taskName,
            nfseNumber: detail?.nfseNumber ?? 'N/A',
            invoiceId,
            taskId: taskId || undefined,
            externalOperationId: withdrawalId || undefined,
          },
          overrides: {
            title: 'NFS-e Emitida',
            body: `A NFS-e${detail?.nfseNumber ? ` Nº ${detail.nfseNumber}` : ''} ${refLabel} (${customerName}) foi autorizada.`,
            relatedEntityType: 'NFSE',
            ...(webUrl ? { webUrl } : {}),
            ...(mobileUrl ? { mobileUrl } : {}),
          },
        });
      } else {
        await this.dispatchService.dispatchByConfiguration('nfse.rejected', 'system', {
          entityType: 'NfseDocument',
          entityId: taskId ?? withdrawalId ?? invoiceId,
          action: 'rejected',
          data: {
            customerName,
            taskName,
            errorMessage: detail?.errorMessage || 'N/A',
            invoiceId,
            taskId: taskId || undefined,
            externalOperationId: withdrawalId || undefined,
          },
          overrides: {
            title: 'NFS-e Rejeitada',
            body: `A emissão da NFS-e ${refLabel} (${customerName}) foi rejeitada.${detail?.errorMessage ? `\nMotivo: ${detail.errorMessage}` : ''}`,
            relatedEntityType: 'NFSE',
            ...(webUrl ? { webUrl } : {}),
            ...(mobileUrl ? { mobileUrl } : {}),
          },
        });
      }
    } catch (error) {
      this.logger.error(
        `Falha ao notificar resultado de NFS-e (${outcome}) para fatura ${invoiceId}:`,
        error,
      );
    }
  }

  @Cron('0 9 * * *', {
    name: 'nfse-emission',
    timeZone: 'America/Sao_Paulo',
  })
  async emitPendingNfses(): Promise<void> {
    if (process.env.NFSE_SCHEDULER_ENABLED !== 'true') {
      this.logger.log('NFSe scheduler disabled (NFSE_SCHEDULER_ENABLED!=true)');
      return;
    }

    if (this.isProcessing) {
      this.logger.warn('NFS-e emission already in progress, skipping');
      return;
    }

    this.isProcessing = true;

    try {
      this.logger.log('Starting NFS-e emission job...');

      const now = new Date();

      // I22: A doc stuck in PROCESSING (>5min) may have ALREADY been emitted at Elotech —
      // emission is a non-transactional HTTP call, so the note can be live at the prefeitura
      // even though our claim never flipped to AUTHORIZED (process crash, network drop after
      // the POST). Auto-flipping PROCESSING→PENDING and re-emitting would mint a DUPLICATE
      // live municipal note. Park it as ERROR so a human/relink script reconciles it against
      // the live Elotech state instead of silently re-emitting. The retryAfter is set far in
      // the future so the ERROR-retry sweep below does NOT auto-pick it up.
      const stuckThreshold = new Date(now.getTime() - 5 * 60 * 1000);
      const farFuture = new Date(now.getTime() + 100 * 365 * 24 * 60 * 60 * 1000);
      const unstuck = await this.prisma.nfseDocument.updateMany({
        where: {
          status: NfseStatus.PROCESSING,
          updatedAt: { lt: stuckThreshold },
        },
        data: {
          status: NfseStatus.ERROR,
          errorMessage:
            'Travado em PROCESSING — pode já ter sido emitido no Elotech. ' +
            'Requer reconciliação manual contra a prefeitura antes de reemitir (não reemitido automaticamente).',
          // Park errorCount past the retry ceiling AND push retryAfter far out so neither
          // this sweep nor any retry re-emits it without human intervention.
          errorCount: 3,
          retryAfter: farFuture,
        },
      });
      if (unstuck.count > 0) {
        this.logger.warn(
          `Parked ${unstuck.count} NFS-e document(s) stuck in PROCESSING as ERROR (needs manual reconcile — NOT auto-re-emitted)`,
        );
      }

      // Find NfseDocuments that are PENDING, or ERROR with retryAfter passed and < 3 errors.
      // I33: NEVER emit a note for a CANCELLED invoice or an opted-out customer
      // (generateInvoice=false). The note's lifecycle is owned by an ACTIVE/billable invoice;
      // a doc still PENDING/ERROR against a cancelled invoice (or one whose customer opted out)
      // must not mint a live municipal note. The flag lives on customerConfig (task-backed) or
      // on the externalOperation (withdrawal-backed) — exclude either opt-out.
      const pendingDocs = await this.prisma.nfseDocument.findMany({
        where: {
          invoice: {
            is: {
              status: { not: 'CANCELLED' },
              // Exclude opt-outs: customer config OR external operation with generateInvoice=false.
              customerConfig: { isNot: { generateInvoice: false } },
              externalOperation: { isNot: { generateInvoice: false } },
            },
          },
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
              customerConfig: {
                select: { orderNumber: true, discountType: true, discountValue: true },
              },
              externalOperation: {
                include: {
                  services: { orderBy: { position: 'asc' as const } },
                  items: { include: { item: { select: { name: true } } } },
                },
              },
            },
          },
        },
      });

      this.logger.log(`Found ${pendingDocs.length} NFS-e document(s) to emit`);

      let emitted = 0;
      let errors = 0;

      for (const doc of pendingDocs) {
        try {
          // H3c: the atomic claim (PENDING/ERROR → PROCESSING, proceed only when
          // count === 1) lives INSIDE municipalNfseService.emitNfse() — the single
          // claim authority for both this sweep and the targeted emission path.
          // A doc claimed by another process comes back as { skipped: true }.

          const invoice = doc.invoice;
          if (!invoice) {
            this.logger.warn(`NfseDocument ${doc.id} has no invoice, skipping`);
            await this.prisma.nfseDocument.update({
              where: { id: doc.id },
              data: { status: NfseStatus.ERROR, errorMessage: 'No invoice linked' },
            });
            continue;
          }

          const customer = invoice.customer;
          if (!customer) {
            this.logger.warn(`NfseDocument ${doc.id} has no customer, skipping`);
            await this.prisma.nfseDocument.update({
              where: { id: doc.id },
              data: { status: NfseStatus.ERROR, errorMessage: 'No customer linked' },
            });
            continue;
          }

          const task = invoice.task;
          const withdrawal = (invoice as any).externalOperation;
          const isWithdrawal = !!invoice.externalOperationId;
          // Withdrawal-backed invoices ("Operação Externa") have no task — that's expected.
          if (!task && !isWithdrawal) {
            this.logger.warn(`NfseDocument ${doc.id} has no task, skipping`);
            await this.prisma.nfseDocument.update({
              where: { id: doc.id },
              data: { status: NfseStatus.ERROR, errorMessage: 'No task linked' },
            });
            continue;
          }

          let emitTask: { id: string; name: string; serialNumber?: string };
          let emitTruck:
            | {
                plate?: string;
                chassisNumber?: string;
                category?: string;
                implementType?: string;
              }
            | undefined;
          let services: { description: string; amount: number }[] | undefined;
          let orderNumber: string | undefined;
          let globalDiscount: { type: string; value: number } | undefined;

          if (isWithdrawal) {
            // Operação Externa: discriminate services + withdrawn items; no truck/order/discount.
            emitTask = { id: invoice.externalOperationId!, name: 'Operação Externa' };
            emitTruck = undefined;
            orderNumber = undefined;
            globalDiscount = undefined;
            services = [
              ...((withdrawal?.services ?? []) as any[]).map((s: any) => ({
                description: s.description as string,
                amount: Number(s.amount),
              })),
              ...((withdrawal?.items ?? []) as any[]).map((i: any) => ({
                description: `${i.item?.name ?? 'Item'} - ${i.withdrawedQuantity} un`,
                amount: Number(i.price ?? 0) * i.withdrawedQuantity,
              })),
            ];
          } else {
            // Build services list from task quote, filtered by customer
            const allServices = (task as any).quote?.services as
              | Array<{
                  description: string;
                  amount: any;
                  invoiceToCustomerId: string | null;
                }>
              | undefined;

            services = allServices
              ?.filter(s => !s.invoiceToCustomerId || s.invoiceToCustomerId === customer.id)
              .map(s => ({
                description: s.description,
                amount: Number(s.amount),
              }));

            // Get customer config discount (global discount for this customer)
            const customerConfig = (invoice as any).customerConfig;
            const configDiscountType = customerConfig?.discountType || undefined;
            const configDiscountValue =
              customerConfig?.discountValue != null
                ? Number(customerConfig.discountValue)
                : undefined;

            const truck = (task as any).truck;
            emitTask = {
              id: task!.id,
              name: task!.name,
              serialNumber: (task as any).serialNumber || undefined,
            };
            emitTruck = truck
              ? {
                  plate: truck.plate || undefined,
                  chassisNumber: truck.chassisNumber || undefined,
                  category: truck.category || undefined,
                  implementType: truck.implementType || undefined,
                }
              : undefined;
            orderNumber = (invoice as any).customerConfig?.orderNumber || undefined;
            globalDiscount =
              configDiscountType && configDiscountType !== 'NONE' && configDiscountValue
                ? { type: configDiscountType, value: configDiscountValue }
                : undefined;
          }

          // Build the input for municipal NFSe emission (Elotech OXY)
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
            task: emitTask,
            truck: emitTruck,
            orderNumber,
            services,
            globalDiscount,
          };

          const result = await this.municipalNfseService.emitNfse(emitInput);

          if ((result as any)?.skipped) {
            this.logger.warn(
              `NfseDocument ${doc.id} skipped (${(result as any)?.reason ?? 'claimed by another process'})`,
            );
            continue;
          }
          emitted++;

          this.logger.log(
            `NFS-e emitted for invoice ${invoice.id} (${isWithdrawal ? 'operação externa' : `task: ${task?.name}`})`,
          );

          // Notify FINANCIAL/ADMIN of the emission outcome. emitNfse returns
          // { status: 'AUTHORIZED' | 'ERROR' | skipped }. Skip notifying on no-op skips.
          if ((result as any)?.status === 'AUTHORIZED') {
            await this.dispatchNfseOutcomeNotification(invoice.id, 'AUTHORIZED', {
              nfseNumber: (result as any)?.nfseNumber ?? null,
            });
          } else if ((result as any)?.status === 'ERROR') {
            await this.dispatchNfseOutcomeNotification(invoice.id, 'ERROR', {
              errorMessage: (result as any)?.errorMessage ?? null,
            });
          }
        } catch (error) {
          errors++;
          const errorMessage = error instanceof Error ? error.message : String(error);

          this.logger.error(`Failed to emit NFS-e for document ${doc.id}: ${errorMessage}`);

          // NfseService.emitNfse() already handles error status update,
          // so we don't need to update the doc here. Notify FINANCIAL/ADMIN of rejection.
          if (doc.invoice?.id) {
            await this.dispatchNfseOutcomeNotification(doc.invoice.id, 'ERROR', { errorMessage });
          }
        }
      }

      this.logger.log(`NFS-e emission job completed. Emitted: ${emitted}, Errors: ${errors}`);
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
            customerConfig: {
              select: { orderNumber: true, discountType: true, discountValue: true },
            },
            externalOperation: {
              include: {
                services: { orderBy: { position: 'asc' as const } },
                items: { include: { item: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });

    this.logger.log(`[NFSE_TARGETED] Found ${docs.length} NfSe document(s) to emit`);

    let emitted = 0;
    let errors = 0;

    for (const doc of docs) {
      try {
        const invoice = doc.invoice;
        const customer = invoice?.customer;
        const task = invoice?.task;
        const withdrawal = (invoice as any)?.externalOperation;
        const isWithdrawal = !!invoice?.externalOperationId;

        // Withdrawal-backed invoices ("Operação Externa") have no task — that's expected.
        if (!invoice || !customer || (!task && !isWithdrawal)) {
          this.logger.warn(
            `[NFSE_TARGETED] NfseDocument ${doc.id} missing invoice/customer/task — skipping`,
          );
          continue;
        }

        let emitTask: { id: string; name: string; serialNumber?: string };
        let emitTruck:
          | {
              plate?: string;
              chassisNumber?: string;
              category?: string;
              implementType?: string;
            }
          | undefined;
        let services: { description: string; amount: number }[] | undefined;
        let orderNumber: string | undefined;
        let globalDiscount: { type: string; value: number } | undefined;

        if (isWithdrawal) {
          // Operação Externa: discriminate services + withdrawn items; no truck/order/discount.
          emitTask = { id: invoice.externalOperationId!, name: 'Operação Externa' };
          emitTruck = undefined;
          orderNumber = undefined;
          globalDiscount = undefined;
          services = [
            ...((withdrawal?.services ?? []) as any[]).map((s: any) => ({
              description: s.description as string,
              amount: Number(s.amount),
            })),
            ...((withdrawal?.items ?? []) as any[]).map((i: any) => ({
              description: `${i.item?.name ?? 'Item'} - ${i.withdrawedQuantity} un`,
              amount: Number(i.price ?? 0) * i.withdrawedQuantity,
            })),
          ];
        } else {
          const allServices = (task as any).quote?.services as
            | Array<{
                description: string;
                amount: any;
                invoiceToCustomerId: string | null;
              }>
            | undefined;

          services = allServices
            ?.filter(s => !s.invoiceToCustomerId || s.invoiceToCustomerId === customer.id)
            .map(s => ({
              description: s.description,
              amount: Number(s.amount),
            }));

          // Get customer config discount (global discount for this customer)
          const customerConfig = (invoice as any).customerConfig;
          const configDiscountType = customerConfig?.discountType || undefined;
          const configDiscountValue =
            customerConfig?.discountValue != null
              ? Number(customerConfig.discountValue)
              : undefined;

          const truck = (task as any).truck;
          emitTask = {
            id: task!.id,
            name: task!.name,
            serialNumber: (task as any).serialNumber || undefined,
          };
          emitTruck = truck
            ? {
                plate: truck.plate || undefined,
                chassisNumber: truck.chassisNumber || undefined,
                category: truck.category || undefined,
                implementType: truck.implementType || undefined,
              }
            : undefined;
          orderNumber = customerConfig?.orderNumber || undefined;
          globalDiscount =
            configDiscountType && configDiscountType !== 'NONE' && configDiscountValue
              ? { type: configDiscountType, value: configDiscountValue }
              : undefined;
        }

        const targetedResult = await this.municipalNfseService.emitNfse({
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
          task: emitTask,
          truck: emitTruck,
          orderNumber,
          services,
          globalDiscount,
        });

        // H3c: emitNfse() owns the atomic PENDING/ERROR → PROCESSING claim and
        // returns { skipped: true } when another process (e.g. the 9AM sweep)
        // already claimed this document — never double-emit.
        if ((targetedResult as any)?.skipped) {
          this.logger.warn(
            `[NFSE_TARGETED] NfseDocument ${doc.id} skipped (${(targetedResult as any)?.reason ?? 'claimed by another process'})`,
          );
          continue;
        }

        emitted++;
        this.logger.log(
          `[NFSE_TARGETED] NfSe emitted for invoice ${invoice.id} (${isWithdrawal ? 'operação externa' : `task: ${task?.name}`})`,
        );

        // Notify FINANCIAL/ADMIN of the emission outcome.
        if ((targetedResult as any)?.status === 'AUTHORIZED') {
          await this.dispatchNfseOutcomeNotification(invoice.id, 'AUTHORIZED', {
            nfseNumber: (targetedResult as any)?.nfseNumber ?? null,
          });
        } else if ((targetedResult as any)?.status === 'ERROR') {
          await this.dispatchNfseOutcomeNotification(invoice.id, 'ERROR', {
            errorMessage: (targetedResult as any)?.errorMessage ?? null,
          });
        }
      } catch (error) {
        errors++;
        const targetedErrMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[NFSE_TARGETED] Failed to emit NfSe for document ${doc.id}: ${targetedErrMsg}`,
        );
        // emitNfse() already updated the NfseDocument to ERROR status. Notify rejection.
        if (doc.invoice?.id) {
          await this.dispatchNfseOutcomeNotification(doc.invoice.id, 'ERROR', {
            errorMessage: targetedErrMsg,
          });
        }
      }
    }

    this.logger.log(`[NFSE_TARGETED] Done. Emitted: ${emitted}, Errors: ${errors}`);
  }

  // ─── Cancellation reconciliation ───────────────────────────────────────────
  // Cancellation at Elotech is asynchronous + fiscal-approved. A submitted request sits in
  // CANCEL_REQUESTED (AGUARDANDO_FISCAL) until a municipal fiscal approves (→ CANCELLED) or
  // rejects it (→ CANCEL_REJECTED). This job re-checks pending requests against the live
  // Elotech state so the system never lies about whether a note is actually cancelled, and
  // so users who only use our system learn the moment the fiscal acts (incl. the rejection
  // message). It also re-syncs AUTHORIZED notes that were cancelled directly at the portal.

  /**
   * Best-effort notification when a cancellation request is resolved by the fiscal.
   * Reuses the configuration-driven dispatch; a no-op if the config key is absent.
   */
  private async dispatchCancellationOutcome(
    invoiceId: string,
    outcome: 'CANCELLED' | 'REJECTED',
    detail: { nfseNumber?: number | null; rejectionMessage?: string | null },
  ): Promise<void> {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          customer: { select: { fantasyName: true } },
          task: { select: { id: true, name: true } },
          externalOperation: { select: { id: true } },
        },
      });
      if (!invoice) return;

      const customerName = invoice.customer?.fantasyName || 'N/A';
      const taskId = invoice.task?.id ?? invoice.taskId ?? null;
      const withdrawalId = invoice.externalOperation?.id ?? invoice.externalOperationId ?? null;
      const isWithdrawal = !!withdrawalId;
      const taskName = isWithdrawal ? 'Operação Externa' : invoice.task?.name || 'N/A';
      const refLabel = isWithdrawal ? 'da operação externa' : `da tarefa ${taskName}`;
      const webUrl = isWithdrawal
        ? `/estoque/operacoes-externas/detalhes/${withdrawalId}`
        : taskId
          ? `/financeiro/faturamento/detalhes/${taskId}`
          : undefined;
      const mobileUrl =
        !isWithdrawal && taskId ? `/(tabs)/financeiro/faturamento/detalhes/${taskId}` : undefined;

      const numero = detail.nfseNumber ? ` Nº ${detail.nfseNumber}` : '';
      const isCancelled = outcome === 'CANCELLED';
      await this.dispatchService.dispatchByConfiguration(
        isCancelled ? 'nfse.cancelled' : 'nfse.cancel_rejected',
        'system',
        {
          entityType: 'NfseDocument',
          entityId: taskId ?? withdrawalId ?? invoiceId,
          action: isCancelled ? 'cancelled' : 'cancel_rejected',
          data: {
            customerName,
            taskName,
            nfseNumber: detail.nfseNumber ?? 'N/A',
            invoiceId,
            taskId: taskId || undefined,
            externalOperationId: withdrawalId || undefined,
          },
          overrides: {
            title: isCancelled ? 'NFS-e Cancelada' : 'Cancelamento de NFS-e Rejeitado',
            body: isCancelled
              ? `A NFS-e${numero} ${refLabel} (${customerName}) foi cancelada na prefeitura.`
              : `O cancelamento da NFS-e${numero} ${refLabel} (${customerName}) foi REJEITADO pela prefeitura.${
                  detail.rejectionMessage ? `\nMotivo: ${detail.rejectionMessage}` : ''
                }\nÉ necessário corrigir e reenviar a solicitação.`,
            relatedEntityType: 'NFSE',
            ...(webUrl ? { webUrl } : {}),
            ...(mobileUrl ? { mobileUrl } : {}),
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Falha ao notificar resultado do cancelamento (${outcome}) para fatura ${invoiceId}:`,
        error,
      );
    }
  }

  @Cron('*/20 * * * *', {
    name: 'nfse-cancellation-reconcile',
    timeZone: 'America/Sao_Paulo',
  })
  async reconcilePendingCancellations(): Promise<void> {
    // Only runs where Elotech OXY is configured (production). No-ops in dev.
    if (!process.env.ELOTECH_OXY_USERNAME || !process.env.ELOTECH_OXY_PASSWORD) {
      return;
    }
    if (this.isReconcilingCancellations) {
      this.logger.warn('[NFSE_CANCEL_RECON] Already running, skipping');
      return;
    }
    this.isReconcilingCancellations = true;

    try {
      const pending = await this.prisma.nfseDocument.findMany({
        where: {
          status: NfseStatus.CANCEL_REQUESTED,
          elotechNfseId: { not: null },
        },
        select: { id: true, invoiceId: true, nfseNumber: true },
      });

      if (pending.length === 0) return;
      this.logger.log(`[NFSE_CANCEL_RECON] Checking ${pending.length} pending cancellation(s)`);

      let resolved = 0;
      for (const doc of pending) {
        try {
          const result = await this.municipalNfseService.syncCancellationStatus(doc.id);

          // Still pending — nothing changed.
          if (result.status === NfseStatus.CANCEL_REQUESTED) continue;

          resolved++;
          if (result.cancelled) {
            this.logger.log(
              `[NFSE_CANCEL_RECON] NFS-e #${doc.nfseNumber} cancellation APPROVED by fiscal`,
            );
            await this.dispatchCancellationOutcome(doc.invoiceId, 'CANCELLED', {
              nfseNumber: doc.nfseNumber,
            });
          } else if (result.rejected) {
            this.logger.warn(
              `[NFSE_CANCEL_RECON] NFS-e #${doc.nfseNumber} cancellation REJECTED: ${result.rejectionMessage}`,
            );
            await this.dispatchCancellationOutcome(doc.invoiceId, 'REJECTED', {
              nfseNumber: doc.nfseNumber,
              rejectionMessage: result.rejectionMessage,
            });
          }
        } catch (error) {
          this.logger.error(
            `[NFSE_CANCEL_RECON] Failed to reconcile NfseDocument ${doc.id}: ${
              error instanceof Error ? error.message : error
            }`,
          );
        }
      }

      this.logger.log(
        `[NFSE_CANCEL_RECON] Done. Checked: ${pending.length}, Resolved: ${resolved}`,
      );
    } catch (error) {
      this.logger.error('[NFSE_CANCEL_RECON] Error during cancellation reconciliation:', error);
    } finally {
      this.isReconcilingCancellations = false;
    }
  }
}
