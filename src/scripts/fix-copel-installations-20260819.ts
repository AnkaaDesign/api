/**
 * COPEL tem TRÊS unidades consumidoras no mesmo débito mensal (0000092828493,
 * 0000107981068, 0000113926715) e a conta recorrente tinha uma única ocorrência
 * por competência — a mesma forma do SAMAE. Só o primeiro débito do mês achava
 * obrigação; os outros dois ficavam "Sem vínculo" ou eram carimbados no mês
 * seguinte.
 *
 * Apaga o histórico do modelo antigo (snapshot em *_fix20260819), cadastra as
 * três UCs e deixa a varredura oficial religar débito por débito, cada um na sua
 * UC. Maio fica de fora da varredura padrão (ela olha 3 meses) e é tratado pelo
 * script `fix-samae-prturbo-may-20260819.ts`.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { RecurrentPayableService } from '../modules/financial/recurrent-payable/recurrent-payable.service';
import { deriveTransactionState } from '../modules/financial/reconciliation/transaction-status';

const COPEL_UCS = [
  { code: '0000092828493', label: 'UC 92828493' },
  { code: '0000107981068', label: 'UC 107981068' },
  { code: '0000113926715', label: 'UC 113926715' },
];

async function main(): Promise<number> {
  const logger = new Logger('fix-copel-installations');
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const service = app.get(RecurrentPayableService);

  try {
    const payable = await prisma.recurrentPayable.findFirstOrThrow({
      where: { name: 'Energia Elétrica - COPEL' },
    });
    const occs = await prisma.recurrentPayableOccurrence.findMany({
      where: { recurrentPayableId: payable.id },
      include: { reconciliationMatches: { where: { reversedAt: null } } },
      orderBy: { dueDate: 'asc' },
    });
    console.log(`COPEL: ${occs.length} ocorrência(s), ${occs.reduce((s, o) => s + o.reconciliationMatches.length, 0)} vínculo(s).`);
    if (!apply) {
      console.table(occs.map(o => ({ competencia: o.competence, status: o.status, pago: o.paidAmount?.toString() ?? '', vinculos: o.reconciliationMatches.length })));
      console.log('DRY-RUN — nada foi escrito. Rode com --apply.');
      return 0;
    }

    const touched = new Set<string>();
    for (const o of occs) for (const m of o.reconciliationMatches) touched.add(m.transactionId);
    for (const o of occs) if (o.bankTransactionId) touched.add(o.bankTransactionId);

    await prisma.reconciliationMatch.deleteMany({
      where: { recurrentOccurrenceId: { in: occs.map(o => o.id) } },
    });
    const del = await prisma.recurrentPayableOccurrence.deleteMany({
      where: { id: { in: occs.map(o => o.id) } },
    });
    console.log(`COPEL: ${del.count} ocorrência(s) do modelo antigo removidas.`);

    const upd = await service.update(payable.id, {
      installations: COPEL_UCS,
      expectsNf: payable.expectsNf,
      applyExpectsNfToPast: false,
    } as any);
    console.log(`COPEL: ${upd.message}`);

    for (const id of touched) {
      const state = await deriveTransactionState(prisma, id);
      await prisma.bankTransaction.update({
        where: { id },
        data: { reconciliationStatus: state.status, expectsFiscalDocument: state.expectsFiscalDocument },
      });
    }
    const settled = await service.reconcilePendingFromBank();
    console.log(`Varredura: ${settled} ocorrência(s) liquidada(s).`);

    const after = await prisma.recurrentPayableOccurrence.findMany({
      where: { recurrentPayableId: payable.id },
      include: { installation: { select: { code: true } }, reconciliationMatches: { where: { reversedAt: null } } },
      orderBy: [{ dueDate: 'asc' }, { installationKey: 'asc' }],
    });
    console.table(
      after.map(o => ({
        uc: o.installation?.code ?? '—',
        competencia: o.competence,
        status: o.status,
        pago: o.paidAmount?.toString() ?? '',
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
