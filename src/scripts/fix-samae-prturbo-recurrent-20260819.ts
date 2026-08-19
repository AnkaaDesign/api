/**
 * Reparo pontual (2026-08-19) das contas recorrentes SAMAE (Água) e PRTurbo
 * (Internet), executado DEPOIS do deploy de `RecurrentPayableInstallation`.
 *
 * O que o banco mostrava:
 *  - SAMAE debita TRÊS matrículas por mês (00113942, 00257657, 00280286) e a
 *    conta tinha uma única ocorrência por competência: só o primeiro débito do
 *    mês encontrava obrigação, os outros dois ficavam "Sem vínculo".
 *  - PRTurbo estava quitada por débitos de OUTROS credores (Claro 210,27 em
 *    05/2026, Vivo 264,00 em 08/2026) enquanto os boletos da própria PRTurbo
 *    (99,00) ficavam soltos.
 *  - Duas ocorrências de SETEMBRO (competência que ainda não aconteceu) estavam
 *    PAGAS com débitos de agosto — a janela de ±35 dias somada ao "liquide a
 *    próxima ocorrência aberta" adiantava o mês.
 *  - As mesmas ocorrências ficaram com `expectsNf = true` de quando a conta
 *    ainda esperava nota, e é isso que pinta "Aguardando nota" no Extrato.
 *
 * O script apaga o histórico ERRADO (com snapshot em *_fix20260819) e deixa o
 * varredor oficial reconstruir a partir dos próprios débitos, agora com o
 * roteamento por matrícula e a trava de orçamento do pagamento.
 *
 *   NODE_ENV=production pnpm ts-node -r tsconfig-paths/register \
 *     --transpile-only src/scripts/fix-samae-prturbo-recurrent-20260819.ts [--apply]
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { RecurrentPayableService } from '../modules/financial/recurrent-payable/recurrent-payable.service';
import { deriveTransactionState } from '../modules/financial/reconciliation/transaction-status';

const SAMAE = '72ec4871-5634-46ea-afe2-7bc6ed7e3ae1';
const PRTURBO = 'c2576d87-bb40-48db-90d7-0c953c9c8544';

/** As três matrículas que aparecem no memo dos débitos do SAMAE. */
const SAMAE_INSTALLATIONS = [
  { code: '00113942', label: 'Matrícula 00113942' },
  { code: '00257657', label: 'Matrícula 00257657' },
  { code: '00280286', label: 'Matrícula 00280286' },
];

async function main(): Promise<number> {
  const logger = new Logger('fix-samae-prturbo');
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const service = app.get(RecurrentPayableService);

  try {
    const before = await prisma.recurrentPayableOccurrence.findMany({
      where: { recurrentPayableId: { in: [SAMAE, PRTURBO] } },
      orderBy: [{ recurrentPayableId: 'asc' }, { dueDate: 'asc' }],
      select: { id: true, competence: true, status: true, paidAmount: true, expectsNf: true, bankTransactionId: true },
    });
    console.log(`Ocorrências antes: ${before.length}`);
    if (!apply) {
      console.table(before.map(o => ({ ...o, paidAmount: o.paidAmount?.toString() })));
      console.log('DRY-RUN — nada foi escrito. Rode com --apply.');
      return 0;
    }

    // As transações que perdem (ou ganham) vínculo precisam ter o estado
    // derivado recalculado no fim — senão a linha do extrato continua verde
    // apontando para um vínculo que não existe mais.
    const touchedTxIds = new Set<string>(before.map(o => o.bankTransactionId).filter(Boolean) as string[]);

    // ── SAMAE: zera o histórico do modelo antigo (1 ocorrência para 3 medidores)
    const samaeOccIds = (
      await prisma.recurrentPayableOccurrence.findMany({
        where: { recurrentPayableId: SAMAE },
        select: { id: true },
      })
    ).map(o => o.id);
    const samaeMatches = await prisma.reconciliationMatch.findMany({
      where: { recurrentOccurrenceId: { in: samaeOccIds } },
      select: { id: true, transactionId: true },
    });
    samaeMatches.forEach(m => touchedTxIds.add(m.transactionId));
    await prisma.reconciliationMatch.deleteMany({ where: { id: { in: samaeMatches.map(m => m.id) } } });
    const delOcc = await prisma.recurrentPayableOccurrence.deleteMany({ where: { id: { in: samaeOccIds } } });
    console.log(`SAMAE: ${samaeMatches.length} vínculo(s) e ${delOcc.count} ocorrência(s) do modelo antigo removidos.`);

    // Cadastra as matrículas + encerra a espera de nota (retroativo explícito).
    const upd = await service.update(SAMAE, {
      installations: SAMAE_INSTALLATIONS,
      expectsNf: false,
      applyExpectsNfToPast: true,
    } as any);
    console.log(`SAMAE: ${upd.message}`);

    // ── PRTurbo: solta os débitos de outros credores e o mês adiantado.
    const prOccs = await prisma.recurrentPayableOccurrence.findMany({
      where: { recurrentPayableId: PRTURBO },
      include: {
        reconciliationMatches: { where: { reversedAt: null }, include: { transaction: true } },
      },
    });
    for (const occ of prOccs) {
      // Um vínculo só é legítimo se o débito foi pago à PRÓPRIA PRTurbo.
      const wrong = occ.reconciliationMatches.filter(
        m => (m.transaction?.counterpartyCnpjCpf ?? '').replace(/\D/g, '') !== '08890343000180',
      );
      for (const m of wrong) {
        touchedTxIds.add(m.transactionId);
        await prisma.reconciliationMatch.delete({ where: { id: m.id } });
        console.log(
          `PRTurbo ${occ.competence}: vínculo removido (R$${m.allocatedAmount} de ${m.transaction?.counterpartyName ?? '?'}).`,
        );
      }
      const keeps = occ.reconciliationMatches.length - wrong.length;
      if (keeps === 0 && occ.status === 'PAID') {
        if (occ.bankTransactionId) touchedTxIds.add(occ.bankTransactionId);
        await prisma.recurrentPayableOccurrence.update({
          where: { id: occ.id },
          data: {
            status: 'PENDING',
            paidAmount: null,
            paidAt: null,
            paidById: null,
            bankTransactionId: null,
            reconciledAt: null,
            expectsNf: false,
          },
        });
        console.log(`PRTurbo ${occ.competence}: ocorrência reaberta (sem lastro real).`);
      }
    }
    await prisma.recurrentPayableOccurrence.updateMany({
      where: { recurrentPayableId: PRTURBO, expectsNf: true, fiscalDocumentId: null },
      data: { expectsNf: false },
    });
    const updPr = await service.update(PRTURBO, {
      expectsNf: false,
      applyExpectsNfToPast: true,
    } as any);
    console.log(`PRTurbo: ${updPr.message}`);

    // ── Deixa o varredor oficial reconstruir os vínculos certos.
    const settled = await service.reconcilePendingFromBank();
    console.log(`Varredura: ${settled} ocorrência(s) liquidada(s) a partir do extrato.`);

    // ── Recalcula o estado derivado de cada transação tocada.
    for (const id of touchedTxIds) {
      const state = await deriveTransactionState(prisma, id);
      await prisma.bankTransaction.update({
        where: { id },
        data: { reconciliationStatus: state.status, expectsFiscalDocument: state.expectsFiscalDocument },
      });
    }
    console.log(`Estado derivado recalculado em ${touchedTxIds.size} transação(ões).`);

    const after = await prisma.recurrentPayableOccurrence.findMany({
      where: { recurrentPayableId: { in: [SAMAE, PRTURBO] } },
      orderBy: [{ recurrentPayableId: 'asc' }, { dueDate: 'asc' }, { installationKey: 'asc' }],
      include: { installation: { select: { code: true } }, reconciliationMatches: { where: { reversedAt: null } } },
    });
    console.table(
      after.map(o => ({
        conta: o.recurrentPayableId === SAMAE ? 'SAMAE' : 'PRTurbo',
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
