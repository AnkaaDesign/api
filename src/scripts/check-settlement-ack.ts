/** Smoke do "Marcar como resolvido": estados aceitos, recusados e o efeito no
 *  balde do Extrato (o mirror SQL tem de concordar com a derivação). */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { ReconciliationService } from '../modules/financial/reconciliation/reconciliation.service';
import { settlementStateWhere } from '../modules/financial/reconciliation/settlement-summary';

async function main(): Promise<number> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const svc = app.get(ReconciliationService);
  try {
    const countBuckets = async () => ({
      untied: await prisma.bankTransaction.count({ where: settlementStateWhere('UNTIED') }),
      unbacked: await prisma.bankTransaction.count({ where: settlementStateWhere('UNBACKED') }),
      settled: await prisma.bankTransaction.count({ where: settlementStateWhere('SETTLED') }),
    });
    console.log('baldes antes :', JSON.stringify(await countBuckets()));

    const vivo = await prisma.bankTransaction.findFirstOrThrow({
      where: { counterpartyCnpjCpf: '02558157000162', amount: { lt: 0 }, memo: { contains: 'VIVOPR' } },
    });
    const ok = await svc.acknowledgeSettlement(vivo.id, { acknowledged: true, note: 'Pagamento avulso — não há conta recorrente da Vivo cadastrada.' });
    console.log('marcar       :', ok.message, '→', ok.data.settlement.state, '| acknowledged =', ok.data.settlement.acknowledged);
    console.log('baldes depois:', JSON.stringify(await countBuckets()));

    // Recusa: uma linha que está aguardando nota não pode virar verde por aqui.
    const awaiting = await prisma.bankTransaction.findFirst({ where: settlementStateWhere('AWAITING_NF') });
    if (awaiting) {
      await svc
        .acknowledgeSettlement(awaiting.id, { acknowledged: true })
        .then(() => console.log('recusa       : FALHOU — aceitou uma AWAITING_NF'))
        .catch(e => console.log('recusa       :', e.message));
    }
    // Recusa: pendente.
    const open = await prisma.bankTransaction.findFirst({ where: { reconciliationStatus: 'PENDING' } });
    if (open) {
      await svc
        .acknowledgeSettlement(open.id, { acknowledged: true })
        .then(() => console.log('recusa open  : FALHOU — aceitou uma PENDING'))
        .catch(e => console.log('recusa open  :', e.message));
    }

    const undo = await svc.acknowledgeSettlement(vivo.id, { acknowledged: false });
    console.log('desfazer     :', undo.message, '→', undo.data.settlement.state);
    console.log('baldes final :', JSON.stringify(await countBuckets()));
    return 0;
  } catch (e) {
    console.error(`FALHOU: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    await Promise.race([app.close(), new Promise(r => setTimeout(r, 15_000))]).catch(() => undefined);
  }
}
main().then(c => process.exit(c));
