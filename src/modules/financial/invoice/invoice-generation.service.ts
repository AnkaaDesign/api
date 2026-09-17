import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SicrediService } from '@modules/integrations/sicredi/sicredi.service';
import { SicrediAuthService } from '@modules/integrations/sicredi/sicredi-auth.service';
import { INVOICE_STATUS, INSTALLMENT_STATUS, BANK_SLIP_STATUS } from '@constants';
import type { Invoice } from '@types';
import { nextBrazilianBusinessDay } from '@utils/brazilian-holidays.util';
import { formatDueDateYMD, todayInSaoPauloAtNoonUtc } from '@utils/due-date.util';
import { coveredTaskIds, orderNumberLabel, sliceAnchorTaskId } from '../../../utils/quote-tasks';
import { deleteInstallmentsWithSlips } from '../../../utils/billing-teardown';
import { BillingStatusCascadeService } from '@modules/financial/billing/billing-status-cascade.service';

/**
 * UM PAGADOR QUE NÃO GEROU FATURA — e por quê.
 *
 * Existe para que o chamador possa RECUSAR a aprovação. Sem isto o gerador
 * pulava o pagador em silêncio e devolvia só os ids dos que deram certo.
 */
export type SkippedBillingConfig = {
  /** `BudgetPayer.id` — o pagador. */
  configId: string;
  /** Nome de fantasia do cliente, para a mensagem de erro dizer de quem é. */
  customerName: string;
  /** O valor que ficaria sem cobrança. */
  total: number;
  /** Frase pronta em português, já explicando o que falta. */
  reason: string;
};

export type InvoiceGenerationOutcome = {
  invoiceIds: string[];
  skippedConfigs: SkippedBillingConfig[];
};

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
    // A cascata que recalcula `Billing.status`. Vem de `BillingStatusModule`,
    // que só depende do Prisma — importá-lo não fecha ciclo com nada.
    private readonly billingStatusCascade: BillingStatusCascadeService,
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
   *
   * ⚠️ Esta forma devolve SÓ os ids e por isso não sabe dizer quem ficou de
   * fora. Quem precisa decidir se a aprovação pode prosseguir deve chamar
   * {@link generateInvoicesForTaskDetailed}, que devolve também `skippedConfigs`.
   */
  async generateInvoicesForTask(
    taskId: string,
    userId: string,
    approvalDate?: Date,
    options?: {
      skipBankSlips?: boolean;
      skipNfse?: boolean;
      onlyTaskIds?: readonly string[] | null;
      onlyConfigIds?: readonly string[] | null;
    },
  ): Promise<string[]> {
    const { invoiceIds } = await this.generateInvoicesForTaskDetailed(
      taskId,
      userId,
      approvalDate,
      options,
    );
    return invoiceIds;
  }

  /**
   * A MESMA GERAÇÃO, DIZENDO QUEM FICOU DE FORA.
   *
   * O gerador tinha um `continue` mudo: um pagador cujas parcelas não puderam
   * ser calculadas (condição `CUSTOM`, valor zero, condição em branco) era
   * PULADO, sem fatura, sem parcela, sem boleto e sem nota — e a aprovação
   * seguia adiante porque os OUTROS pagadores geraram fatura. Bastava um
   * `invoiceIds.length > 0` para a cobrança inteira ser carimbada de APROVADA
   * com um pagador nunca cobrado dentro dela.
   *
   * `skippedConfigs` é o que faltava para o chamador poder falhar: quem não
   * gerou, de quem é, quanto era e por quê.
   */
  async generateInvoicesForTaskDetailed(
    taskId: string,
    userId: string,
    approvalDate?: Date,
    options?: {
      skipBankSlips?: boolean;
      skipNfse?: boolean;
      /**
       * FATIAS a faturar, quando o orçamento cobra veículo a veículo.
       *
       * Ausente = todas as fatias que ainda não foram faturadas. É o
       * comportamento de `JOINT` (onde existe uma fatia só, a de `taskId` nulo)
       * e é também o "faturar tudo de uma vez" em `PER_TASK`.
       *
       * Presente = só as configurações daquelas tarefas. É o "veículo a
       * veículo": os sessenta caminhões do Marquespan não terminam no mesmo dia,
       * e o financeiro aprova os que já saíram — cada um com sua fatura, sua
       * NFS-e e seus boletos, com o vencimento contado dali.
       */
      onlyTaskIds?: readonly string[] | null;
      /**
       * OS PAGADORES a faturar, pelo id — o endereçamento EXATO, e o que tem
       * precedência quando vem.
       *
       * `onlyTaskIds` chega ao pagador dando a volta pela cobertura, e essa volta
       * tem dois buracos que não se fecham de dentro dela: uma cobrança SEM
       * cobertura declarada passa sempre (a regra abaixo a deixava passar para não
       * faturar nada), e quem chama precisa desistir do filtro inteiro se QUALQUER
       * alvo estiver descoberto. Os dois são alcançáveis em produção: a migration
       * do faturamento-entidade criou `Billing` sem `BillingTask` para todo
       * orçamento anterior à cobertura explícita, de 13/09.
       *
       * Quem aprova já sabe exatamente quais pagadores está aprovando — são os
       * `customerConfigs` dos faturamentos alvo. Dizer isso direto dispensa a
       * inferência e fecha os dois buracos de uma vez.
       */
      onlyConfigIds?: readonly string[] | null;
    },
  ): Promise<InvoiceGenerationOutcome> {
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
              orderBy: { createdAt: 'asc' },
              include: {
                customer: {
                  select: {
                    id: true,
                    fantasyName: true,
                    cnpj: true,
                  },
                },
                // A COBERTURA — os veículos que esta fatura cobra. Decide três
                // coisas: quais fatias esta aprovação fatura, o multiplicador do
                // valor (`por veículo × cobertos`) e o `Invoice.taskId` /
                // `NfseDocument.taskId`, que só é preenchido quando a fatura é
                // de UM veículo.
                billing: {
                  select: {
                    id: true,
                    approvedAt: true,
                    tasks: {
                      select: { taskId: true, task: { select: { id: true, finishedAt: true } } },
                    },
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

    // ── QUAIS FATURAS ESTA APROVAÇÃO EMITE ────────────────────────────────────
    //
    // `onlyTaskIds` restringe às faturas que COBREM um daqueles veículos. A
    // pergunta é de sobreposição, não de igualdade: aprovar o caminhão 37 emite
    // a fatura do lote 21–60, porque é essa a que cobra o 37 — e ela cobra os
    // quarenta de uma vez, que é o que o lote significa.
    //
    // ⚠️ Antes a regra era `taskId === null || onlyTaskIds.has(taskId)`, com o
    // nulo significando "cobre tudo". Um lote teria `taskId` nulo por não caber
    // numa coluna, e a regra o faturaria a cada aprovação de qualquer veículo.
    const onlyConfigIds = options?.onlyConfigIds ? new Set(options.onlyConfigIds) : null;
    const onlyTaskIds = options?.onlyTaskIds ? new Set(options.onlyTaskIds) : null;
    const customerConfigs = (quote.customerConfigs ?? []).filter(config => {
      // O endereçamento EXATO vence: sem volta pela cobertura, sem exceção para
      // cobrança descoberta.
      if (onlyConfigIds) return onlyConfigIds.has(config.id);
      if (!onlyTaskIds) return true;
      const covered = ((config as any).billing?.tasks ?? []) as Array<{ taskId: string }>;
      // Fatia sem cobertura é o orçamento que ainda não tem veículo vinculado:
      // ali não há o que restringir, e recusá-la deixaria a aprovação sem fatura.
      if (covered.length === 0) return true;
      return covered.some(row => onlyTaskIds.has(row.taskId));
    });

    this.logger.log(
      `[INVOICE_GEN] Quote ${quote.id}: ${customerConfigs?.length ?? 0} customer config(s)` +
        (onlyConfigIds
          ? ` (restrita a ${onlyConfigIds.size} pagador(es) da cobrança)`
          : onlyTaskIds
            ? ` (fatia restrita a ${onlyTaskIds.size} tarefa(s))`
            : ''),
    );

    if (!customerConfigs || customerConfigs.length === 0) {
      this.logger.warn(
        `[INVOICE_GEN] No customer configs found for task ${taskId}, skipping invoice generation.`,
      );
      return { invoiceIds: [], skippedConfigs: [] };
    }

    const invoiceIds: string[] = [];
    // QUEM NÃO GEROU — preenchido em cada `continue` do laço abaixo. Ver
    // `SkippedBillingConfig`: sem esta lista o pulo era mudo.
    const skippedConfigs: SkippedBillingConfig[] = [];
    // Track NfseDocument ids already claimed (reused or minted) earlier in THIS
    // approval run. A multi-config quote creates one invoice per config in the
    // same loop; without this guard the taskId-scoped reuse lookup below would
    // let config B "reuse" the note config A just minted, re-pointing it to B's
    // invoice and leaving config A with NO municipal note (its boleto then stalls
    // in CREATING forever because readyForBoleto gates on an AUTHORIZED note).
    const usedNfseIds: string[] = [];

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
          //
          // ⚠️ "PAGA" NÃO É SÓ `status: PAID`. Um boleto quitado A MENOS deixa a
          // parcela em PENDING com `paidAmount > 0` — o webhook do Sicredi grava
          // o valor sem promover o estado. Sem o `paidAmount` na conta, a
          // regeneração apagava a parcela e o `BankSlip` dela, e o dinheiro
          // recebido sumia sem linha em lugar nenhum. As DUAS consultas precisam
          // do mesmo critério: a que recusa e a que apaga.
          const paidCount = await tx.installment.count({
            where: {
              invoiceId: { in: ids },
              OR: [{ status: 'PAID' }, { paidAmount: { gt: 0 } }],
            },
          });
          if (paidCount > 0) {
            throw new BadRequestException(
              'Não é possível regenerar o faturamento: existem parcelas com pagamento registrado ' +
                '(inclusive parcial) vinculadas a faturas canceladas. Trate-as manualmente antes de regenerar.',
            );
          }

          await deleteInstallmentsWithSlips(tx, {
            invoiceId: { in: ids },
            status: { not: 'PAID' },
            paidAmount: { lte: 0 },
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

        // Due dates anchor on approvalDate (the billing-approval moment); task.finishedAt
        // is only a legacy fallback (the installment generators use `approvalDate ?? finishedAt`).
        // Billing can now be approved BEFORE the task is finished, so fall back to
        // approvalDate/now instead of skipping generation when finishedAt is null.
        // A COBERTURA manda no `finishedAt`, não a tarefa por onde a aprovação
        // entrou: cada caminhão fecha num dia diferente, e usar a data de um
        // deles para os sessenta é como todos os vencimentos acabariam iguais.
        //
        // Numa fatura de vários veículos a data é a do ÚLTIMO a fechar — é dali
        // que o prazo do cliente corre, porque antes disso a entrega do lote não
        // aconteceu. E só vale quando TODOS fecharam: com um pendente não existe
        // "data de conclusão" do lote, e a conta cai na data de aprovação, que é
        // o que os geradores já preferem.
        const coveredRows = ((config as any).billing?.tasks ?? []) as Array<{
          task?: { finishedAt: Date | null } | null;
        }>;
        const coveredFinishedAt = coveredRows.map(r => r.task?.finishedAt ?? null);
        const sliceFinishedAt =
          coveredFinishedAt.length > 0 && coveredFinishedAt.every(d => d != null)
            ? new Date(Math.max(...coveredFinishedAt.map(d => new Date(d as Date).getTime())))
            : null;
        const finishedAt = sliceFinishedAt ?? task.finishedAt ?? approvalDate ?? new Date();

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
          // NÃO É MAIS UM PULO MUDO. Depois de `CUSTOM` passar a gerar parcela
          // única, sobram dois motivos reais: valor não positivo e condição de
          // pagamento em branco. Nos dois casos este pagador fica SEM cobrança —
          // e quem chamou precisa saber para poder recusar a aprovação inteira,
          // em vez de carimbá-la porque os OUTROS pagadores geraram fatura.
          const motivo =
            !Number.isFinite(totalAmount) || totalAmount <= 0
              ? `valor de cobrança inválido (R$ ${Number(totalAmount).toFixed(2)})`
              : 'forma de pagamento não definida';
          skippedConfigs.push({
            configId: config.id,
            customerName: config.customer?.fantasyName ?? 'cliente sem nome',
            total: Number(totalAmount),
            reason: motivo,
          });
          this.logger.error(
            `[INVOICE_GEN] NENHUMA PARCELA gerada para o pagador ${config.id} ` +
              `(${config.customer?.fantasyName ?? '?'}): ${motivo}. ` +
              `condition=${config.paymentCondition}, paymentConfig=${JSON.stringify(paymentConfig)}. ` +
              `Este pagador fica SEM fatura.`,
          );
          continue;
        }

        this.logger.log(
          `[INVOICE_GEN] Generated ${generatedInstallments.length} installment(s) for customerConfig ${config.id}`,
        );

        // I44: the Invoice.totalAmount is a FROZEN snapshot of config.total. Defensively
        // assert it matches the sum of the generated installments — a divergence (beyond a
        // centavo) means we are about to bill an amount that does not reconcile to its own
        // parcelas. Do NOT silently rewrite the snapshot; surface it so it can be corrected.
        const installmentsSum = Number(
          generatedInstallments.reduce((s, i) => s + i.amount, 0).toFixed(2),
        );
        if (Math.abs(installmentsSum - totalAmount) > 0.01) {
          this.logger.error(
            `[INVOICE_GEN] AMOUNT DIVERGENCE for customerConfig ${config.id} (task ${taskId}, ` +
              `customer ${config.customerId}): config.total=${totalAmount} but Σ installments=` +
              `${installmentsSum}. Billing the frozen total; reconcile manually.`,
          );
        }

        // Create the Invoice
        // `Invoice.taskId` É O VEÍCULO DESTA FATURA — e só existe quando a
        // fatura é de UM.
        //
        // Antes era sempre a tarefa por onde a aprovação entrou. Num orçamento
        // de sessenta caminhões faturado junto, isso apontaria a fatura de
        // R$ 730.224,00 para UM caminhão, e as telas que listam "faturas desta
        // tarefa" mostrariam a cobrança inteira em um e nada nos outros
        // cinquenta e nove.
        //
        // ⚠️ A conta é sobre a COBERTURA, nunca sobre `billingSplit`. Decidir
        // por modo gravava NULO em todo orçamento `JOINT` — inclusive nos de UMA
        // tarefa, que são o acervo inteiro —, e as três telas que perguntam por
        // `Invoice.taskId` (detalhe da tarefa, cartão de faturas, assistente de
        // Faturamento) ficavam sem fatura nenhuma. Pela cobertura, um orçamento
        // de um veículo cobre um veículo, e o campo continua preenchido como
        // sempre foi. Ver `sliceAnchorTaskId`.
        const sliceTaskId = sliceAnchorTaskId(config as any);
        const invoice = await tx.invoice.create({
          data: {
            customerConfigId: config.id,
            taskId: sliceTaskId,
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
        const installmentPaymentMethod = this.resolveInstallmentPaymentMethod(paymentConfig);
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
              paymentMethod: installmentPaymentMethod,
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
          // I20: never mint a SECOND live municipal note *within the same billing cycle*.
          // Partial approvals, retries and multi-config quotes must all converge on one note
          // per invoice — hence `usedNfseIds`, which stops config B from stealing config A's
          // note in the same run.
          //
          // But "same cycle" is the whole point, and it used to be missing. A note whose
          // invoice was DELETED by a billing revert belongs to the PREVIOUS cycle: inheriting
          // it made the re-approval silently reuse a note the operator had already decided to
          // undo, and — when its cancellation had been rejected — dragged a CANCEL_REJECTED
          // status onto the fresh invoice, which then failed every boleto gate. That is the
          // "Tati Minas 8,50" deadlock.
          //
          // `invoiceId IS NULL` is the reliable marker of "my invoice was reverted away":
          // no other path zeroes it (invoice cancellation marks CANCELLED, it never deletes).
          // Such a note must be SUPERSEDED — a new note is minted here, and
          // supersedePreviousNfses() then cancels the old one citing the new as substituta.
          //
          // ⚠️ O ESCOPO DA GUARDA PASSOU A SER A FATIA, não a tarefa por onde a
          // aprovação entrou.
          //
          // A busca era `taskId: taskId` — a tarefa de entrada. Num orçamento de
          // sessenta caminhões faturado veículo a veículo, isso faria a segunda
          // aprovação encontrar a nota da primeira e REAPONTÁ-LA para a fatura
          // nova: o caminhão 1 ficaria sem nota municipal (e o boleto dele
          // travado em CREATING para sempre, porque o portão exige nota
          // autorizada) e o caminhão 2 herdaria uma nota emitida com os dados de
          // outro veículo.
          //
          // A pergunta certa é "já existe nota viva para ESTE FATURAMENTO neste
          // ciclo?" — e o endereço dela é a fatia, não a tarefa.
          //
          // ⚠️ Endereçar por tarefa (ou por "orçamento com tarefa nula") não
          // sobrevive ao lote: duas faturas do mesmo orçamento cobrindo vinte
          // caminhões cada têm as duas `taskId` nulo, e a guarda daria a nota da
          // primeira para a segunda. `customerConfigId` é único por fatura e
          // atravessa reversão e reemissão, que é exatamente o ciclo que a
          // guarda mede.
          const existingLiveNfse = await tx.nfseDocument.findFirst({
            where: {
              invoice: { is: { customerConfigId: config.id, status: { not: 'CANCELLED' } } },
              status: { notIn: ['CANCELLED', 'CANCEL_REQUESTED'] },
              // Never re-point a note already claimed by an earlier config in this
              // same run — that note belongs to the other customer's invoice.
              id: { notIn: usedNfseIds },
              // Current cycle only: orphaned notes are the previous cycle's, to be replaced.
              invoiceId: { not: null },
            },
            orderBy: { createdAt: 'desc' },
          });

          if (existingLiveNfse) {
            // Re-link the surviving note to the new invoice (if it was orphaned) so the
            // invoice's NFS-e section still resolves it. Do NOT change its status.
            if (existingLiveNfse.invoiceId !== invoice.id) {
              await tx.nfseDocument.update({
                where: { id: existingLiveNfse.id },
                data: { invoiceId: invoice.id },
              });
            }
            usedNfseIds.push(existingLiveNfse.id);
            this.logger.warn(
              `[INVOICE_GEN] Reusing existing live NfseDocument ${existingLiveNfse.id} ` +
                `(status=${existingLiveNfse.status}) for invoice ${invoice.id} — not minting a duplicate.`,
            );
          } else {
            const createdNfse = await tx.nfseDocument.create({
              data: {
                invoiceId: invoice.id,
                // O veículo, quando a nota é de UM (ver `sliceAnchorTaskId`), e
                // SEMPRE o orçamento: é `quoteId` que faz a nota de um lote
                // aparecer no histórico de todos os veículos que ela cobre em vez
                // de em um só.
                taskId: sliceTaskId,
                quoteId: quote.id,
                status: 'PENDING',
              },
            });
            usedNfseIds.push(createdNfse.id);
            this.logger.log(
              `[INVOICE_GEN] NfseDocument created for invoice ${invoice.id} (status=PENDING)`,
            );
          }
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
      `[INVOICE_GEN] ====== Invoice generation complete for task ${taskId}: ${invoiceIds.length} invoice(s) created [${invoiceIds.join(', ')}]` +
        (skippedConfigs.length > 0
          ? ` — ${skippedConfigs.length} pagador(es) SEM fatura: ` +
            skippedConfigs.map(s => `${s.customerName} (${s.reason})`).join('; ')
          : '') +
        ' ======',
    );

    return { invoiceIds, skippedConfigs };
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

    // I44: defensively assert the frozen invoice total reconciles to the generated parcelas.
    const ewInstallmentsSum = Number(
      generatedInstallments.reduce((s, i) => s + i.amount, 0).toFixed(2),
    );
    if (Math.abs(ewInstallmentsSum - totalAmount) > 0.01) {
      this.logger.error(
        `[INVOICE_GEN_EW] AMOUNT DIVERGENCE for withdrawal ${externalOperationId} ` +
          `(customer ${withdrawal.customerId}): computed total=${totalAmount} but Σ installments=` +
          `${ewInstallmentsSum}. Billing the frozen total; reconcile manually.`,
      );
    }

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

        await deleteInstallmentsWithSlips(tx, {
          status: { not: 'PAID' },
          OR: [{ invoiceId: { in: ids } }, { externalOperationId, invoiceId: null }],
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
      const installmentPaymentMethod = this.resolveInstallmentPaymentMethod(paymentConfig);
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
            paymentMethod: installmentPaymentMethod,
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
        // I20: never mint a SECOND live municipal note for this external operation. Reuse any
        // existing note still linked to one of this withdrawal's invoices that is NOT terminally
        // cancelled and NOT in-flight cancellation (CANCEL_REQUESTED — the reconciler owns it).
        const existingLiveNfse = await tx.nfseDocument.findFirst({
          where: {
            invoice: { externalOperationId },
            status: { notIn: ['CANCELLED', 'CANCEL_REQUESTED'] },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (existingLiveNfse) {
          if (existingLiveNfse.invoiceId !== invoice.id) {
            await tx.nfseDocument.update({
              where: { id: existingLiveNfse.id },
              data: { invoiceId: invoice.id },
            });
          }
          this.logger.warn(
            `[INVOICE_GEN_EW] Reusing existing live NfseDocument ${existingLiveNfse.id} ` +
              `(status=${existingLiveNfse.status}) for invoice ${invoice.id} — not minting a duplicate.`,
          );
        } else {
          await tx.nfseDocument.create({
            data: {
              invoiceId: invoice.id,
              status: 'PENDING',
            },
          });
          this.logger.log(
            `[INVOICE_GEN_EW] NfseDocument created for invoice ${invoice.id} (status=PENDING)`,
          );
        }
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
                customerId: true,
                // A COBERTURA DESTA FATURA — de quais VEÍCULOS ela é.
                //
                // Era a coluna `taskId` da fatia, nula querendo dizer "todos". Virou
                // relação porque uma fatura pode cobrir um lote — vinte dos sessenta —, e
                // nesse caso não existe coluna que responda. Leia por `sliceTask()` /
                // `coveredTaskIds()` de `@utils/quote-tasks`.
                billing: { select: { id: true, approvedAt: true, tasks: { select: { taskId: true } } } },
                quote: {
                  select: {
                    services: {
                      select: { description: true, observation: true, invoiceToCustomerId: true },
                      orderBy: { position: 'asc' },
                    },
                    // O NÚMERO DO PEDIDO mora na TAREFA desde que um orçamento
                    // passou a cobrir N caminhões: o pedido é por entrega, e
                    // obrigar os sessenta a citar o mesmo era o que o campo
                    // antigo (por cliente) fazia. Ver `orderNumberLabel`.
                    tasks: {
                      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                      select: {
                        id: true,
                        customerOrderNumber: true,
                        // SÉRIE E CAMINHÃO — numa fatura conjunta `Invoice.task`
                        // é nulo, e sem eles o informativo do boleto não citava
                        // veículo nenhum.
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
      const customerName = customer.corporateName || customer.fantasyName || '';

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

        // Sicredi rejects past due dates — clamp to today (São Paulo) if needed.
        // Both sides are calendar dates at noon UTC, so this is timezone-safe and the
        // clamped value is persisted below, keeping the system equal to the boleto.
        const originalDueDate = new Date(installment.dueDate);
        const effectiveDueDate =
          originalDueDate < todayInSaoPauloAtNoonUtc() ? todayInSaoPauloAtNoonUtc() : originalDueDate;
        const dueDateWasClamped = effectiveDueDate.getTime() !== originalDueDate.getTime();

        if (dueDateWasClamped) {
          this.logger.warn(
            `[BOLETO_REGISTER] Installment ${installment.id} was due ${formatDueDateYMD(originalDueDate)} ` +
              `(in the past) — registering at Sicredi for ${formatDueDateYMD(effectiveDueDate)} and moving ` +
              `the parcela to the same date so the system matches the boleto.`,
          );
        }

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
          dataVencimento: formatDueDateYMD(effectiveDueDate),
          valor: Number(installment.amount),
        });

        const pixQrCode =
          (boletoResponse as any).qrCode || (boletoResponse as any).codigoQrCode || null;

        // Store the date the boleto was ACTUALLY registered with — never the original
        // installment date, or the system would show a vencimento the customer's
        // boleto does not have.
        await this.prisma.bankSlip.update({
          where: { id: installment.bankSlip.id },
          data: {
            nossoNumero: boletoResponse.nossoNumero,
            seuNumero: this.buildSeuNumero(installment),
            barcode: boletoResponse.codigoBarras,
            digitableLine: boletoResponse.linhaDigitavel,
            pixQrCode,
            txid: (boletoResponse as any).txid || null,
            dueDate: effectiveDueDate,
            status: 'ACTIVE',
            errorMessage: null,
            errorCount: 0,
            lastSyncAt: new Date(),
          },
        });

        // Keep the parcela aligned with the boleto that was actually registered.
        if (dueDateWasClamped) {
          await this.prisma.installment.update({
            where: { id: installment.id },
            data: { dueDate: effectiveDueDate },
          });

          // MOVER O VENCIMENTO MUDA O ESTADO DA COBRANÇA. A parcela estava
          // vencida (foi por isso que a data foi empurrada) e agora vence hoje
          // ou depois — a cobrança precisa sair de VENCIDO. O recálculo é pelo
          // PAGADOR, que é o dado em mão aqui: recalcular o orçamento inteiro
          // custaria N vezes mais e responderia a mesma coisa.
          if (installment.customerConfigId) {
            await this.billingStatusCascade
              .recomputeForCustomerConfig(installment.customerConfigId)
              .catch(() => undefined);
          }
        }

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

    // ── OS VEÍCULOS QUE ESTE BOLETO COBRA — uma leitura só ──────────────────
    //
    // O pedido de compra e a descrição do veículo têm de falar dos MESMOS
    // caminhões. Eram duas leituras com recuos diferentes: sem linha de
    // cobertura (fatura do acervo, anterior à migração), o pedido recuava para o
    // ORÇAMENTO INTEIRO e a descrição para a tarefa da fatura — o boleto saía
    // citando os quatro pedidos e nomeando um caminhão só.
    //
    // Agora é uma lista: a cobertura; na falta dela, a tarefa da fatura; na
    // falta das duas, o orçamento inteiro (fatura conjunta antiga, que de fato
    // cobra todos). `80` é o que sobra da linha do boleto informativo.
    const cfgForOrder = installment.invoice?.customerConfig;
    const coveredForOrder = new Set(coveredTaskIds(cfgForOrder as any));
    const quoteTaskRows: any[] = (cfgForOrder?.quote?.tasks ?? []) as any[];
    const coveredRows: any[] =
      coveredForOrder.size > 0
        ? quoteTaskRows.filter(t => coveredForOrder.has(t.id))
        : installment.invoice?.task
          ? [installment.invoice.task]
          : quoteTaskRows;
    const orderNumber = orderNumberLabel(coveredRows, 80);
    // A tarefa de CONTEXTO: a da fatura quando ela é de um veículo, senão o
    // primeiro que ela cobre. Numa fatura conjunta `Invoice.task` é nulo de
    // propósito, e ler só por ele deixava o informativo sem veículo nenhum.
    const task: any = installment.invoice?.task ?? coveredRows[0] ?? null;
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

    if (coveredRows.length > 1) {
      // MAIS DE UM VEÍCULO: contagem e faixa de séries, como a discriminação da
      // nota. Cinco linhas de 80 caracteres não cabem sessenta por extenso.
      const series = coveredRows
        .map((t: any) => t.serialNumber)
        .filter((n: any): n is string => Boolean(n))
        .sort();
      parts.push(
        `Referente aos servicos em ${coveredRows.length} veiculos${
          vehicleType ? ` ${vehicleType}` : ''
        }`.trimEnd().substring(0, 80),
      );
      if (series.length > 1) {
        parts.push(`Series: ${series[0]} a ${series[series.length - 1]}`.substring(0, 80));
      }
    } else if (vehicleType || idStr) {
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
      // "Outros" is a generic catch-all description; the real service text lives in the
      // observation. Mirror the NFS-e discriminacao so the boleto matches the emitted NF.
      const descriptions = services.map((s: any) =>
        s.description === 'Outros' && s.observation?.trim()
          ? s.observation.trim()
          : (s.description as string),
      );
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
      B_DOUBLE_FRONT: 'Bitrem Composição Dianteira',
      B_DOUBLE_REAR: 'Bitrem Composição Traseira',
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
  /**
   * The intended settlement method for every installment a customerConfig (or
   * external-operation withdrawal) generates — stamped onto `Installment.paymentMethod`
   * at creation so the "Forma" column (internal tables) and the customer-facing dossiê
   * page have something to show before anyone manually marks an installment paid.
   *
   * CASH configs carry an explicit choice (`À Vista - Boleto` / `À Vista - Pix`, set by
   * PaymentConfigField on the web). INSTALLMENTS configs — and any config predating this
   * field — default to BANK_SLIP, matching the historical behavior (boletos were the only
   * mechanism before `method` existed).
   */
  private resolveInstallmentPaymentMethod(
    paymentConfig: { method?: string } | null | undefined,
  ): 'PIX' | 'BANK_SLIP' {
    return paymentConfig?.method === 'PIX' ? 'PIX' : 'BANK_SLIP';
  }

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
    // Mesma decisão do gerador por condição: valor não positivo NÃO gera parcela
    // (boleto e NFS-e de R$ 0,00 são documentos impagáveis na mão do cliente), e
    // quem recusa é a validação da aprovação. Ver o comentário em
    // `generateInstallmentsFromCondition`.
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

    // QUALQUER OUTRO `type` (hoje `CUSTOM`, amanhã o que for) cai numa parcela
    // ÚNICA no valor total, pelo mesmo motivo do `CUSTOM` do gerador por
    // condição: combinar o pagamento à parte não apaga a dívida, e devolver
    // lista vazia aqui fazia a cobrança ser aprovada sem parcela, sem boleto e
    // sem nada que vencesse.
    return [
      {
        number: 1,
        dueDate: nextBrazilianBusinessDay(resolveFirstDueDate()),
        amount: total,
      },
    ];
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
    // VALOR NÃO POSITIVO NÃO GERA PARCELA — e isso é decisão, não omissão.
    //
    // Uma parcela de R$ 0,00 produziria um boleto de R$ 0,00 no Sicredi e uma
    // NFS-e de R$ 0,00 na prefeitura: dois documentos que o cliente recebe e
    // ninguém consegue baixar. Cobrança de valor zero (retrabalho em garantia,
    // cortesia) não é dívida, e o lugar de dizer isso é a APROVAÇÃO, que deve
    // RECUSAR antes de chegar aqui — o gerador não tem como distinguir "de
    // graça" de "alguém esqueceu de preencher o valor".
    //
    // ⚠️ Enquanto a validação não recusa, quem não gerou aparece em
    // `skippedConfigs` (ver `generateInvoicesForTaskDetailed`) e o chamador
    // falha em voz alta em vez de aprovar uma cobrança sem fatura.
    if (!Number.isFinite(total) || total <= 0) return [];
    if (!paymentCondition) return [];

    // `CUSTOM` = "combinado à parte" — texto livre é FORMA DE PAGAMENTO, não
    // ausência de dívida. Gerava ZERO parcelas, e o efeito era exatamente o
    // defeito que esta correção fecha: a fatura nascia sem parcela nenhuma (ou
    // nem nascia), o boleto não saía, nada vencia, e a cobrança se declarava
    // aprovada sobre dinheiro que ninguém ia cobrar.
    //
    // Uma parcela ÚNICA no valor total, com o vencimento à vista da casa
    // (5 dias do âncora), é a leitura conservadora: existe a dívida, existe a
    // data, e o financeiro ajusta vencimento e instrumento pela tela de
    // faturamento como faz em qualquer outra parcela.
    if (paymentCondition === 'CUSTOM') {
      const anchorCustom = approvalDate ?? finishedAt;
      const baseCustom = new Date(
        Date.UTC(
          anchorCustom.getUTCFullYear(),
          anchorCustom.getUTCMonth(),
          anchorCustom.getUTCDate() + 5,
          12,
          0,
          0,
        ),
      );
      const nowCustom = new Date();
      const floorCustom = nextBrazilianBusinessDay(
        new Date(
          Date.UTC(
            nowCustom.getUTCFullYear(),
            nowCustom.getUTCMonth(),
            nowCustom.getUTCDate() + 3,
            12,
            0,
            0,
          ),
        ),
      );
      return [
        {
          number: 1,
          dueDate: nextBrazilianBusinessDay(baseCustom < floorCustom ? floorCustom : baseCustom),
          amount: total,
        },
      ];
    }

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
