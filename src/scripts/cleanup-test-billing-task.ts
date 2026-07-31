/**
 * Desfaz a tarefa de teste de faturamento: CANCELA a NFS-e emitida na prefeitura e remove
 * tarefa, orçamento, fatura, parcelas e o documento fiscal local.
 *
 * A nota é cancelada ANTES de qualquer remoção — apagar a linha local primeiro deixaria a
 * nota viva na prefeitura sem nada apontando para ela.
 *
 * Run: NODE_ENV=production DOTENV_CONFIG_PATH=.env.production \
 *        npx ts-node -r dotenv/config -r tsconfig-paths/register --transpile-only \
 *        src/scripts/cleanup-test-billing-task.ts <taskId>
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { ElotechOxyNfseService } from '../modules/integrations/nfse/elotech-oxy-nfse.service';

// eslint-disable-next-line no-console
const out = (message: string): void => console.log(message);

async function main(): Promise<void> {
  const taskId = process.argv.find(a => /^[0-9a-f-]{36}$/i.test(a));
  if (!taskId) {
    out('Uso: cleanup-test-billing-task.ts <taskId>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const elotech = app.get(ElotechOxyNfseService);

  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, name: true, quoteId: true },
    });
    if (!task) throw new Error(`Tarefa ${taskId} não encontrada`);
    out(`Tarefa: ${task.name} (orçamento ${task.quoteId})`);

    const invoices = await prisma.invoice.findMany({
      where: { taskId },
      select: { id: true, status: true, nfseDocuments: { select: { id: true, nfseNumber: true, status: true, elotechNfseId: true } } },
    });

    // 1) Cancela toda NFS-e viva na prefeitura
    for (const invoice of invoices) {
      for (const doc of invoice.nfseDocuments) {
        if (doc.status !== 'AUTHORIZED') {
          out(`NF ${doc.nfseNumber}: status ${doc.status} — nada a cancelar`);
          continue;
        }
        out(`Cancelando NF ${doc.nfseNumber} (elotechId ${doc.elotechNfseId})...`);
        const result = await elotech.cancelNfse(
          doc.id,
          'Nota de teste de integracao - servico nao prestado, cancelamento imediato.',
          2,
        );
        out(`  resultado: ${JSON.stringify(result)}`);
        if (!result.cancelled) {
          throw new Error(
            `NF ${doc.nfseNumber} NÃO foi cancelada (${result.requestStatus}). Abortando a remoção — ` +
              `apagar os registros locais deixaria a nota viva sem rastro.`,
          );
        }
      }
    }

    // 2) Remove os registros locais, filhos antes dos pais
    const invoiceIds = invoices.map(i => i.id);
    if (invoiceIds.length > 0) {
      const docs = await prisma.nfseDocument.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      const insts = await prisma.installment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      out(`NfseDocument removidos: ${docs.count} | Parcelas (por fatura): ${insts.count}`);
    }
    if (task.quoteId) {
      const configIds = (
        await prisma.taskQuoteCustomerConfig.findMany({
          where: { quoteId: task.quoteId },
          select: { id: true },
        })
      ).map(c => c.id);
      if (configIds.length > 0) {
        const insts = await prisma.installment.deleteMany({
          where: { customerConfigId: { in: configIds } },
        });
        out(`Parcelas (por config): ${insts.count}`);
      }
    }
    if (invoiceIds.length > 0) {
      const inv = await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      out(`Faturas removidas: ${inv.count}`);
    }

    await prisma.task.delete({ where: { id: taskId } });
    out('Tarefa removida.');

    if (task.quoteId) {
      // Cascateia serviços e customer configs do orçamento.
      await prisma.taskQuote.delete({ where: { id: task.quoteId } });
      out('Orçamento removido (serviços e configs em cascata).');
    }

    const leftovers = await prisma.nfseDocument.count({ where: { taskId } });
    out(`NfseDocument ainda apontando para a tarefa: ${leftovers}`);
    if (leftovers > 0) {
      await prisma.nfseDocument.deleteMany({ where: { taskId } });
      out('  removidos.');
    }
  } finally {
    await app.close();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err?.response?.data ?? err);
  process.exit(1);
});
