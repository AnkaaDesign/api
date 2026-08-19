/**
 * Complemento do reparo SAMAE/PRTurbo: a competência 05/2026.
 *
 * `reconcilePendingFromBank(3)` olha a partir do início do mês DOIS meses atrás
 * (hoje 08 → 06/2026), então os débitos de maio ficaram fora da varredura e as
 * ocorrências de maio — apagadas junto com o modelo antigo de uma-ocorrência-
 * para-três-medidores — não voltaram. Este script roda EXATAMENTE o mesmo
 * caminho de liquidação, restrito a estas duas contas e a maio.
 *
 *   NODE_ENV=production pnpm ts-node -r tsconfig-paths/register \
 *     --transpile-only src/scripts/fix-samae-prturbo-may-20260819.ts [--apply]
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { RecurrentPayableService } from '../modules/financial/recurrent-payable/recurrent-payable.service';

const DEFAULT_IDS = ['72ec4871-5634-46ea-afe2-7bc6ed7e3ae1', 'c2576d87-bb40-48db-90d7-0c953c9c8544'];
/** Outras contas atingidas pelo mesmo buraco de maio entram por `PAYABLE_IDS`. */
const PAYABLE_IDS = process.env.PAYABLE_IDS?.split(',').filter(Boolean) ?? DEFAULT_IDS;
const FROM = new Date('2026-05-01T00:00:00.000Z');
const TO = new Date('2026-06-01T00:00:00.000Z');

async function main(): Promise<number> {
  const logger = new Logger('fix-samae-prturbo-may');
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const service = app.get(RecurrentPayableService);

  try {
    for (const id of PAYABLE_IDS) {
      const payable = await prisma.recurrentPayable.findUniqueOrThrow({ where: { id } });
      const digits = (payable.payeeCnpj ?? '').replace(/\D/g, '');
      const txs = await prisma.bankTransaction.findMany({
        where: {
          type: 'DEBIT',
          postedAt: { gte: FROM, lt: TO },
          categories: { some: { categoryId: payable.categoryId } },
        },
        orderBy: { postedAt: 'asc' },
      });
      for (const tx of txs) {
        // Mesma trava de identidade da varredura: o débito tem de ser DESTE credor.
        if ((tx.counterpartyCnpjCpf ?? '').replace(/\D/g, '') !== digits) continue;
        if (!apply) {
          console.log(`[dry] ${payable.name} ← ${tx.postedAt.toISOString().slice(0, 10)} R$${tx.amount} ${tx.memo}`);
          continue;
        }
        const result = await (service as any).applyBankSettlement(payable, tx);
        console.log(`${payable.name} ← ${tx.postedAt.toISOString().slice(0, 10)} R$${tx.amount}: ${result}`);
      }
    }

    const after = await prisma.recurrentPayableOccurrence.findMany({
      where: { recurrentPayableId: { in: PAYABLE_IDS }, competence: '2026-05' },
      include: { installation: { select: { code: true } }, reconciliationMatches: { where: { reversedAt: null } } },
      orderBy: [{ recurrentPayableId: 'asc' }, { installationKey: 'asc' }],
    });
    console.table(
      after.map(o => ({
        matricula: o.installation?.code ?? '—',
        competencia: o.competence,
        status: o.status,
        pago: o.paidAmount?.toString() ?? '',
        expectsNf: o.expectsNf,
        vinculos: o.reconciliationMatches.length,
      })),
    );
    return 0;
  } catch (error) {
    logger.error(`FALHOU: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) logger.error(error.stack);
    return 1;
  } finally {
    await Promise.race([app.close(), new Promise(r => setTimeout(r, 15_000))]).catch(() => undefined);
  }
}

main().then(code => process.exit(code));
