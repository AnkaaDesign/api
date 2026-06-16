/**
 * One-off: the boletos for tasks 37438 and 37441 were registered before their NFS-e were
 * cancelled/re-emitted, so their seuNumero is swapped and the informativo shows the cancelled
 * NF. Fix = baixar each at Sicredi, then regenerate so seuNumero AND informativo reference the
 * current (latest not-yet-cancelled) NF: 37438→NF 3113, 37441→NF 3114.
 *
 * Run: NODE_ENV=production npx ts-node -r tsconfig-paths/register src/scripts/fix-boletos-37438-37441.ts [--apply]
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { SicrediService } from '../modules/integrations/sicredi/sicredi.service';
import { InvoiceGenerationService } from '../modules/financial/invoice/invoice-generation.service';

const SERIALS = ['37438', '37441'];
const EXPECTED: Record<string, string> = { '37438': 'NF 3113', '37441': 'NF 3114' };
const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  const logger = new Logger('FixBoletos');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });

  try {
    const prisma = app.get(PrismaService);
    const sicredi = app.get(SicrediService);
    const invoiceGen = app.get(InvoiceGenerationService);

    const targets = await prisma.installment.findMany({
      where: { invoice: { task: { serialNumber: { in: SERIALS } } }, bankSlip: { isNot: null } },
      select: {
        id: true,
        invoiceId: true,
        status: true,
        amount: true,
        dueDate: true,
        bankSlip: { select: { id: true, nossoNumero: true, status: true, seuNumero: true } },
        invoice: { select: { task: { select: { serialNumber: true } } } },
      },
    });

    for (const inst of targets) {
      const serie = inst.invoice?.task?.serialNumber ?? '?';
      const bs = inst.bankSlip!;
      logger.log(
        `\n── Série ${serie}: installment ${inst.id} | boleto nossoNumero=${bs.nossoNumero} status=${bs.status} seuNumero="${bs.seuNumero}" → expected ${EXPECTED[serie]}`,
      );

      if (inst.status === 'PAID' || inst.status === 'CANCELLED') {
        logger.warn(`   parcela ${inst.status} — pulando (não regenerar).`);
        continue;
      }
      if (!APPLY) {
        logger.log('   [DRY-RUN] baixaria no Sicredi + regeneraria.');
        continue;
      }

      // 1) Baixar at Sicredi (skip TMP/already-cancelled)
      if (bs.nossoNumero && !bs.nossoNumero.startsWith('TMP-') && bs.status !== 'CANCELLED') {
        try {
          await sicredi.cancelBoleto(bs.nossoNumero);
          logger.log(`   ✓ baixado no Sicredi (nossoNumero=${bs.nossoNumero})`);
        } catch (e: any) {
          logger.error(`   ✗ falha ao baixar no Sicredi: ${e?.message ?? e}. Abortando esta parcela.`);
          continue;
        }
      }

      // 2) Reset the bank slip so registration re-creates it fresh
      await prisma.bankSlip.update({
        where: { id: bs.id },
        data: {
          status: 'CREATING',
          nossoNumero: `TMP-${inst.id}`,
          barcode: null,
          digitableLine: null,
          pixQrCode: null,
          txid: null,
          pdfFileId: null,
          errorMessage: null,
          errorCount: 0,
        },
      });

      // 3) Re-register at Sicredi with the corrected seuNumero + informativo
      if (inst.invoiceId) {
        await invoiceGen.registerBankSlipsAtSicredi([inst.invoiceId]);
      }

      // 4) Verify
      const after = await prisma.bankSlip.findUnique({
        where: { id: bs.id },
        select: { nossoNumero: true, status: true, seuNumero: true },
      });
      const ok = after?.seuNumero === EXPECTED[serie];
      logger.log(
        `   resultado: nossoNumero=${after?.nossoNumero} status=${after?.status} seuNumero="${after?.seuNumero}" ${ok ? 'PASS ✅' : 'CHECK ⚠️'}`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
