/** Smoke: um crédito de LIQ.COBRANCA (lote de boletos) só pode oferecer boletos
 *  como candidatos — nunca uma parcela de PIX/TED ou baixada à mão. */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ReceivableMatchService } from '../modules/financial/reconciliation/receivable-match.service';
import { PrismaService } from '../modules/common/prisma/prisma.service';

async function main(): Promise<number> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const svc = app.get(ReceivableMatchService);
    const prisma = app.get(PrismaService);
    const txs = await prisma.bankTransaction.findMany({
      where: { type: 'CREDIT', reconciliationStatus: 'PENDING' },
      select: { id: true, postedAt: true, amount: true, memo: true, subtype: true, topMatchScore: true },
      orderBy: { postedAt: 'desc' },
      take: 12,
    });
    for (const tx of txs) {
      const cands: any[] = await svc.getReceivableCandidates(tx.id);
      const naoBoleto = cands.filter(c => !c.viaBankSlip);
      console.log(
        `${tx.postedAt.toISOString().slice(0, 10)} R$${tx.amount} ${tx.subtype} "${(tx.memo ?? '').slice(0, 34)}" ` +
          `→ ${cands.length} candidato(s) (${cands.length - naoBoleto.length} boleto / ${naoBoleto.length} direto), score=${tx.topMatchScore}`,
      );
    }
    return 0;
  } catch (e) {
    console.error(`FALHOU: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    await Promise.race([app.close(), new Promise(r => setTimeout(r, 15_000))]).catch(() => undefined);
  }
}
main().then(c => process.exit(c));
