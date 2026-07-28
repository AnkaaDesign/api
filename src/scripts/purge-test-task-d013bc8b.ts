/**
 * One-off: purge the test task "Teste" (d013bc8b-bdd8-4502-beb4-e009978eea05) and everything
 * it spawned. It was created to exercise the billing flow and produced REAL external
 * artifacts that must be revoked before the local rows go away:
 *
 *   1. NFS-e 3179 (elotechNfseId=36169993) — AUTHORIZED at the prefeitura de Ibiporã.
 *      Cancellation is async + fiscal-approved, so this only REQUESTS it (reasonCode 1 =
 *      "Erro na emissão"). The note stays ATIVA until the fiscal approves.
 *   2. Boleto nossoNumero=600003443 (seuNumero NF3179) — ACTIVE at Sicredi. Baixa via API.
 *
 * Only then delete: Task (cascades ServiceOrder/Truck/logs/forecast/Invoice) and the
 * TaskQuote (cascades TaskQuoteCustomerConfig → Installment → BankSlip).
 *
 * NfseDocument.taskId/invoiceId are onDelete:SetNull BY DESIGN — the fiscal record survives
 * as an orphan so the cancellation outcome stays auditable. This script does NOT delete it.
 *
 * Run: NODE_ENV=production npx ts-node -r tsconfig-paths/register src/scripts/purge-test-task-d013bc8b.ts [--apply]
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { SicrediService } from '../modules/integrations/sicredi/sicredi.service';
import { ElotechOxyNfseService } from '../modules/integrations/nfse/elotech-oxy-nfse.service';

const TASK_ID = 'd013bc8b-bdd8-4502-beb4-e009978eea05';
const CANCEL_REASON = 'Erro na emissao - nota emitida em teste do sistema';
const CANCEL_REASON_CODE = 1; // 1 = Erro na emissão
const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  const logger = new Logger('PurgeTestTask');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const sicredi = app.get(SicrediService);
    const elotech = app.get(ElotechOxyNfseService);

    const task = await prisma.task.findUnique({
      where: { id: TASK_ID },
      select: {
        id: true,
        name: true,
        status: true,
        quoteId: true,
        _count: { select: { serviceOrders: true, fieldChangeLogs: true, forecastHistory: true } },
      },
    });
    if (!task) {
      logger.error(`Task ${TASK_ID} not found — nothing to do.`);
      return;
    }
    logger.log(
      `Task "${task.name}" status=${task.status} quoteId=${task.quoteId} ` +
        `SOs=${task._count.serviceOrders} logs=${task._count.fieldChangeLogs} forecast=${task._count.forecastHistory}`,
    );

    // ── 1) NFS-e: request cancellation at the prefeitura ────────────────────────────────
    const notes = await prisma.nfseDocument.findMany({
      where: { OR: [{ taskId: TASK_ID }, { invoice: { taskId: TASK_ID } }] },
      select: { id: true, nfseNumber: true, elotechNfseId: true, status: true },
    });
    for (const note of notes) {
      logger.log(`\n── NFS-e ${note.nfseNumber} (elotech ${note.elotechNfseId}) status=${note.status}`);
      if (note.status === 'CANCELLED') {
        logger.log('   já cancelada — pulando.');
        continue;
      }
      if (!['AUTHORIZED', 'CANCEL_REJECTED', 'CANCEL_REQUESTED'].includes(note.status)) {
        logger.warn(`   status ${note.status} não permite cancelamento — pulando.`);
        continue;
      }
      if (!APPLY) {
        logger.log(`   [DRY-RUN] solicitaria cancelamento: "${CANCEL_REASON}" (cod ${CANCEL_REASON_CODE})`);
        continue;
      }
      const res = await elotech.cancelNfse(note.id, CANCEL_REASON, CANCEL_REASON_CODE, null);
      logger.log(
        `   → cancelled=${res.cancelled} pending=${res.pending} rejected=${res.rejected} ` +
          `status=${res.status} requestStatus=${res.requestStatus ?? '-'} ${res.rejectionMessage ?? ''}`,
      );
    }

    // ── 2) Boletos: baixa at Sicredi ────────────────────────────────────────────────────
    const slips = await prisma.bankSlip.findMany({
      where: {
        installment: {
          OR: [{ invoice: { taskId: TASK_ID } }, { customerConfig: { quoteId: task.quoteId ?? '' } }],
        },
      },
      select: { id: true, nossoNumero: true, status: true, seuNumero: true, amount: true },
    });
    for (const slip of slips) {
      logger.log(`\n── Boleto nossoNumero=${slip.nossoNumero} seuNumero="${slip.seuNumero}" status=${slip.status} R$ ${slip.amount}`);
      if (slip.status === 'PAID') {
        logger.error('   boleto PAGO — abortando, não é seguro remover histórico financeiro real.');
        throw new Error(`Boleto ${slip.nossoNumero} está PAGO.`);
      }
      if (slip.status === 'CANCELLED' || !slip.nossoNumero || slip.nossoNumero.startsWith('TMP-')) {
        logger.log('   já cancelado / sem registro no banco — pulando baixa.');
        continue;
      }
      if (!APPLY) {
        logger.log('   [DRY-RUN] daria baixa no Sicredi.');
        continue;
      }
      await sicredi.cancelBoleto(slip.nossoNumero);
      await prisma.bankSlip.update({ where: { id: slip.id }, data: { status: 'CANCELLED' } });
      logger.log('   → baixado no Sicredi e marcado CANCELLED.');
    }

    // ── 3) Delete task + quote ──────────────────────────────────────────────────────────
    if (!APPLY) {
      logger.log(`\n[DRY-RUN] deletaria Task ${TASK_ID} e TaskQuote ${task.quoteId}.`);
      return;
    }

    await prisma.task.delete({ where: { id: TASK_ID } });
    logger.log(`\n✓ Task ${TASK_ID} deletada (cascade: ServiceOrder, Truck, logs, forecast, Invoice).`);

    if (task.quoteId) {
      await prisma.taskQuote.delete({ where: { id: task.quoteId } });
      logger.log(`✓ TaskQuote ${task.quoteId} deletada (cascade: customerConfig → Installment → BankSlip).`);
    }

    const leftovers = await prisma.nfseDocument.findMany({
      where: { id: { in: notes.map(n => n.id) } },
      select: { id: true, nfseNumber: true, status: true, cancelRequestStatus: true, taskId: true, invoiceId: true },
    });
    for (const l of leftovers) {
      logger.log(
        `• NfseDocument ${l.id} NF ${l.nfseNumber} mantido: status=${l.status} ` +
          `cancelRequest=${l.cancelRequestStatus ?? '-'} taskId=${l.taskId ?? 'null'} invoiceId=${l.invoiceId ?? 'null'}`,
      );
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
