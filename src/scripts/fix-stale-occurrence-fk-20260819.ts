/**
 * Segunda passada do reparo das recorrentes: o FK `bankTransactionId` mentiroso.
 *
 * `RecurrentPayableOccurrence.bankTransactionId` é um atalho para "o débito que
 * quitou esta linha", mas quem manda é o ReconciliationMatch. As duas coisas
 * saíram do lugar em quem foi liquidado pelo varredor antigo:
 *
 *  1. ocorrência COM vínculo vivo mas FK apontando para OUTRO pagamento — o FK
 *     ficou do vínculo anterior, que já foi desfeito. Some o FK, fica o vínculo.
 *  2. ocorrência SEM vínculo vivo e FK de um credor que não é o dela — nunca
 *     houve lastro. Some o FK e a linha reabre (baixa manual sobrevive: é
 *     declaração de gente, não dedução de extrato).
 *
 * A conta de energia da COPEL fica de fora: ela tem três UCs no mesmo boleto
 * mensal e é tratada como o SAMAE, com instalações — reconstruir a linha dela
 * aqui só criaria trabalho para desfazer depois.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { RecurrentPayableService } from '../modules/financial/recurrent-payable/recurrent-payable.service';
import { deriveTransactionState } from '../modules/financial/reconciliation/transaction-status';

const SKIP_PAYABLE_NAMES = ['Energia Elétrica - COPEL'];

async function main(): Promise<number> {
  const logger = new Logger('fix-stale-occurrence-fk');
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const service = app.get(RecurrentPayableService);

  try {
    const payables = await prisma.recurrentPayable.findMany({ include: { supplier: true } });
    const byId = new Map(payables.map(p => [p.id, p]));
    const occs = await prisma.recurrentPayableOccurrence.findMany({
      where: { bankTransactionId: { not: null } },
      include: { reconciliationMatches: { where: { reversedAt: null } } },
      orderBy: [{ recurrentPayableId: 'asc' }, { dueDate: 'asc' }],
    });

    const rows: any[] = [];
    const touched = new Set<string>();
    for (const occ of occs) {
      const payable = byId.get(occ.recurrentPayableId);
      if (!payable || SKIP_PAYABLE_NAMES.includes(payable.name)) continue;
      const live = occ.reconciliationMatches;
      const fkId = occ.bankTransactionId!;
      if (live.some(m => m.transactionId === fkId)) continue; // FK e vínculo concordam

      const tx = await prisma.bankTransaction.findUnique({ where: { id: fkId } });
      const identityOk = (service as any).identityMatches(
        payable,
        tx?.counterpartyCnpjCpf,
        tx?.counterpartyName,
      );

      if (live.length > 0) {
        rows.push({ conta: payable.name, competencia: occ.competence, acao: 'FK obsoleto removido', fk: (tx?.counterpartyName ?? '').slice(0, 30) });
        if (apply) {
          touched.add(fkId);
          await prisma.recurrentPayableOccurrence.update({
            where: { id: occ.id },
            data: { bankTransactionId: live[0].transactionId },
          });
        }
        continue;
      }

      if (identityOk) continue; // sem vínculo, mas o pagamento é do credor certo: não mexe
      rows.push({
        conta: payable.name,
        competencia: occ.competence,
        acao: occ.paidById ? 'FK falso removido (baixa manual mantida)' : 'reaberta (sem lastro)',
        fk: (tx?.counterpartyName ?? '').slice(0, 30),
      });
      if (apply) {
        touched.add(fkId);
        await prisma.recurrentPayableOccurrence.update({
          where: { id: occ.id },
          data: occ.paidById
            ? { bankTransactionId: null, reconciledAt: null }
            : { status: 'PENDING', paidAmount: null, paidAt: null, bankTransactionId: null, reconciledAt: null },
        });
      }
    }

    console.log(`Ocorrências com FK divergente: ${rows.length}`);
    if (rows.length) console.table(rows);
    if (!apply) {
      console.log('DRY-RUN — nada foi escrito. Rode com --apply.');
      return 0;
    }
    for (const id of touched) {
      const state = await deriveTransactionState(prisma, id);
      await prisma.bankTransaction.update({
        where: { id },
        data: { reconciliationStatus: state.status, expectsFiscalDocument: state.expectsFiscalDocument },
      });
    }
    console.log(`Estado derivado recalculado em ${touched.size} transação(ões).`);
    const settled = await service.reconcilePendingFromBank();
    console.log(`Varredura oficial: ${settled} ocorrência(s) religada(s).`);
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
