/**
 * Cria uma TAREFA DE TESTE (concluída) com orçamento de R$ 2,00 em 2 serviços, faturada
 * para o cliente Kennedy — para exercitar o gatilho de faturamento (aprovação → NFS-e)
 * pela própria interface.
 *
 * Deliberadamente com `generateBankSlip: false`: a aprovação de faturamento registraria um
 * boleto REAL no Sicredi. Marque "Gerar Boleto" na tela se quiser testar esse trecho também.
 *
 * Run: NODE_ENV=production DOTENV_CONFIG_PATH=.env.production \
 *        npx ts-node -r dotenv/config -r tsconfig-paths/register --transpile-only \
 *        src/scripts/seed-test-billing-task.ts
 *
 * Para remover: src/scripts/seed-test-billing-task.ts --delete=<taskId>
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';

const KENNEDY_CUSTOMER_ID = 'b593f440-9f00-4c85-93ef-54bf5a9eef37';
const COMERCIAL_SECTOR_ID = 'd8968b27-350a-453d-9c7e-6d83c350622e';

// eslint-disable-next-line no-console
const out = (message: string): void => console.log(message);

async function main(): Promise<void> {
  const deleteArg = process.argv.find(a => a.startsWith('--delete='));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);

  try {
    if (deleteArg) {
      const taskId = deleteArg.slice('--delete='.length);
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { quoteId: true, name: true } });
      if (!task) throw new Error(`Tarefa ${taskId} não encontrada`);
      await prisma.task.delete({ where: { id: taskId } });
      if (task.quoteId) await prisma.taskQuote.delete({ where: { id: task.quoteId } }).catch(() => undefined);
      out(`Tarefa "${task.name}" removida.`);
      return;
    }

    const responsible = await prisma.responsible.findFirst({
      where: { companyId: KENNEDY_CUSTOMER_ID, isActive: true },
      select: { id: true, name: true },
    });

    // budgetNumber é MAX+1 sob advisory lock — mesmo caminho do serviço de produção.
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('task_quote_budget_number'))`;
      const max = await tx.taskQuote.aggregate({ _max: { budgetNumber: true } });
      const budgetNumber = (max._max.budgetNumber ?? 0) + 1;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const quote = await tx.taskQuote.create({
        data: {
          budgetNumber,
          subtotal: 2,
          total: 2,
          expiresAt,
          status: 'PENDING',
          statusOrder: 8,
          services: {
            create: [
              {
                description: 'Servico de teste 1',
                amount: 1,
                position: 0,
                invoiceToCustomerId: KENNEDY_CUSTOMER_ID,
              },
              {
                description: 'Servico de teste 2',
                amount: 1,
                position: 1,
                invoiceToCustomerId: KENNEDY_CUSTOMER_ID,
              },
            ],
          },
          customerConfigs: {
            create: [
              {
                customerId: KENNEDY_CUSTOMER_ID,
                subtotal: 2,
                total: 2,
                generateInvoice: true,
                // Evita registrar um boleto REAL no Sicredi por R$ 2,00.
                generateBankSlip: false,
                paymentCondition: 'CASH_5',
                paymentConfig: { type: 'CASH', cashDays: 5 },
                responsibleId: responsible?.id ?? null,
              },
            ],
          },
        },
        select: { id: true, budgetNumber: true },
      });

      const now = new Date();
      const task = await tx.task.create({
        data: {
          name: 'TESTE NFS-E - contato do tomador',
          status: 'COMPLETED',
          statusOrder: 4,
          serialNumber: `TESTE-NFSE-${quote.budgetNumber}`,
          details: 'Tarefa de teste criada para validar a emissão de NFS-e (telefone/e-mail/inscrições do tomador). Pode ser removida.',
          customerId: KENNEDY_CUSTOMER_ID,
          sectorId: COMERCIAL_SECTOR_ID,
          entryDate: now,
          startedAt: now,
          finishedAt: now,
          quoteId: quote.id,
        },
        select: { id: true, name: true, serialNumber: true },
      });

      return { quote, task };
    });

    out('Tarefa de teste criada:');
    out(`  taskId       : ${result.task.id}`);
    out(`  nome         : ${result.task.name}`);
    out(`  nº de série  : ${result.task.serialNumber}`);
    out(`  orçamento nº : ${result.quote.budgetNumber} (PENDENTE, R$ 2,00 em 2 serviços)`);
    out(`  responsável  : ${responsible?.name ?? '(nenhum)'}`);
    out(`  faturamento  : https://ankaadesign.com.br/financeiro/faturamento/detalhes/${result.task.id}`);
    out(`  remover com  : --delete=${result.task.id}`);
  } finally {
    await app.close();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err?.response?.data ?? err);
  process.exit(1);
});
