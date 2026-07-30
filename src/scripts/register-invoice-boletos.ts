/**
 * Register the bank slips of specific invoices at Sicredi, now.
 *
 * Why this exists: `registerBankSlipsAtSicredi` normally runs inline right after billing
 * approval. If the process dies mid-flight (deploy, restart, crash), the BankSlip is left
 * at `CREATING` with a `TMP-` nossoNumero. The scheduled sweep DOES pick `CREATING` up,
 * but only for installments due within 5 days — so a parcela due further out sits
 * unregistered and invisible until that window opens.
 *
 * Run: NODE_ENV=production DOTENV_CONFIG_PATH=.env.production \
 *        npx ts-node -r dotenv/config -r tsconfig-paths/register --transpile-only \
 *        src/scripts/register-invoice-boletos.ts <invoiceId> [<invoiceId> ...]
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { InvoiceGenerationService } from '../modules/financial/invoice/invoice-generation.service';

// eslint-disable-next-line no-console
const out = (message: string): void => console.log(message);

async function main(): Promise<void> {
  const invoiceIds = process.argv.filter(a => /^[0-9a-f-]{36}$/i.test(a));
  if (invoiceIds.length === 0) {
    out('Uso: register-invoice-boletos.ts <invoiceId> [<invoiceId> ...]');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const invoiceGen = app.get(InvoiceGenerationService);

    const before = await prisma.installment.findMany({
      where: { invoiceId: { in: invoiceIds } },
      select: {
        number: true,
        status: true,
        dueDate: true,
        bankSlip: { select: { nossoNumero: true, status: true, errorMessage: true } },
      },
      orderBy: { number: 'asc' },
    });
    out('══════════════════ ANTES ══════════════════');
    for (const i of before) {
      out(
        `  parcela #${i.number}  ${i.status}  venc=${i.dueDate.toISOString().slice(0, 10)}  ` +
          `boleto=${i.bankSlip?.nossoNumero ?? '(nenhum)'} (${i.bankSlip?.status ?? '-'})`,
      );
    }

    out('');
    out(`Registrando boletos de ${invoiceIds.length} fatura(s) no Sicredi...`);
    await invoiceGen.registerBankSlipsAtSicredi(invoiceIds);

    const after = await prisma.installment.findMany({
      where: { invoiceId: { in: invoiceIds } },
      select: {
        number: true,
        status: true,
        dueDate: true,
        bankSlip: {
          select: {
            nossoNumero: true,
            status: true,
            errorMessage: true,
            digitableLine: true,
            dueDate: true,
          },
        },
      },
      orderBy: { number: 'asc' },
    });
    out('');
    out('══════════════════ DEPOIS ══════════════════');
    for (const i of after) {
      out(
        `  parcela #${i.number}  ${i.status}  venc=${i.dueDate.toISOString().slice(0, 10)}  ` +
          `boleto=${i.bankSlip?.nossoNumero ?? '(nenhum)'} (${i.bankSlip?.status ?? '-'})  ` +
          `venc_boleto=${i.bankSlip?.dueDate?.toISOString().slice(0, 10) ?? '-'}  ` +
          `linha=${i.bankSlip?.digitableLine ? 'sim' : 'não'}` +
          (i.bankSlip?.errorMessage ? `  erro="${i.bankSlip.errorMessage}"` : ''),
      );
    }
  } finally {
    await app.close();
  }
}

main().catch(error => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
