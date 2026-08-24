/**
 * Verificação da correção de 24/08 — o vínculo entre a baixa de uma conta
 * recorrente e o débito que a pagou.
 *
 * Não escreve nada sem `--apply`. Três partes:
 *
 *  A) DIFF DE DECISÃO — para cada par (conta recorrente, débito) que a varredura
 *     das 05:15 alcança hoje, calcula a ocorrência que o código ANTIGO escolheria
 *     (ramo aberto primeiro, ramo já-pago como sobra) e a que o NOVO escolhe
 *     (a mais próxima do vencimento, entre os dois conjuntos). Só as diferenças
 *     importam: elas são exatamente o que a correção muda em produção.
 *
 *  B) DRY-RUN DA VARREDURA DE SAÍDA — quantos débitos entram no novo funil
 *     (sem o filtro PENDING) e o que ela confirmaria na janela de 90 dias do cron
 *     das 04:00.
 *
 *  C) REPARO — liga as ocorrências pagas à mão que estão sem vínculo, pelo mesmo
 *     caminho novo que a baixa manual passa a usar (`confirmOccurrenceFromBank`).
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { RecurrentPayableService } from '../modules/financial/recurrent-payable/recurrent-payable.service';
import { PayableMatchService } from '../modules/financial/reconciliation/payable-match.service';

const WINDOW_DAYS = 35;
const DAY = 86_400_000;
const brl = (n: number): string => `R$ ${n.toFixed(2)}`;
const d10 = (d: Date): string => d.toISOString().slice(0, 10);

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const prisma = app.get(PrismaService);
  const recurrent = app.get(RecurrentPayableService) as any;
  const payableMatch = app.get(PayableMatchService);

  try {
    // ---------------------------------------------------------------- A ------
    console.log('\n=== A) diferença de decisão do applyBankSettlement ===');
    const from = new Date(Date.now() - 92 * DAY);
    const payables = await prisma.recurrentPayable.findMany({ where: { isActive: true } });
    let pairs = 0;
    const diffs: any[] = [];

    for (const payable of payables) {
      const txs = await prisma.bankTransaction.findMany({
        where: {
          type: 'DEBIT',
          postedAt: { gte: from },
          categories: { some: { categoryId: payable.categoryId } },
        },
        select: {
          id: true, postedAt: true, amount: true, memo: true,
          counterpartyName: true, counterpartyCnpjCpf: true,
        },
        orderBy: { postedAt: 'asc' },
      });

      for (const tx of txs) {
        if (!recurrent.identityMatches(payable, tx.counterpartyCnpjCpf, tx.counterpartyName)) continue;

        const amount = Math.abs(Number(tx.amount));
        const spent = await prisma.reconciliationMatch.aggregate({
          where: { transactionId: tx.id, reversedAt: null },
          _sum: { allocatedAmount: true },
        });
        if (amount - Number(spent._sum.allocatedAmount ?? 0) <= 0.01) continue;

        const routing = await recurrent.routeToInstallation(payable, tx);
        if (routing.kind === 'unroutable') continue;
        const slot = routing.kind === 'installation' ? { installationKey: routing.installation.id } : {};

        const lo = new Date(tx.postedAt.getTime() - WINDOW_DAYS * DAY);
        const hi = new Date(tx.postedAt.getTime() + WINDOW_DAYS * DAY);
        const [open, paidUnlinked] = await Promise.all([
          prisma.recurrentPayableOccurrence.findMany({
            where: { recurrentPayableId: payable.id, status: { in: ['PENDING', 'OVERDUE'] }, dueDate: { gte: lo, lte: hi }, ...slot },
            orderBy: { dueDate: 'asc' },
          }),
          prisma.recurrentPayableOccurrence.findMany({
            where: { recurrentPayableId: payable.id, status: 'PAID', bankTransactionId: null, dueDate: { gte: lo, lte: hi }, ...slot },
            orderBy: { dueDate: 'asc' },
          }),
        ]);
        if (open.length === 0 && paidUnlinked.length === 0) continue;
        pairs++;

        const dist = (o: any) => Math.abs(o.dueDate.getTime() - tx.postedAt.getTime());
        const near = (list: any[]) => list.reduce((b, o) => (dist(o) < dist(b) ? o : b));

        const oldPick = open.length > 0
          ? { occ: near(open), act: 'settle' }
          : { occ: near(paidUnlinked), act: 'confirm' };

        const all = [
          ...open.map((occ: any) => ({ occ, paid: false })),
          ...paidUnlinked.map((occ: any) => ({ occ, paid: true })),
        ];
        const chosen = all.reduce((best, c) => {
          const a = dist(c.occ), b = dist(best.occ);
          if (a !== b) return a < b ? c : best;
          return !best.paid && c.paid ? c : best;
        });
        const newPick = { occ: chosen.occ, act: chosen.paid ? 'confirm' : 'settle' };

        if (oldPick.occ.id !== newPick.occ.id || oldPick.act !== newPick.act) {
          diffs.push({
            conta: payable.name,
            uc: routing.kind === 'installation' ? routing.installation.code : '—',
            debito: `${d10(tx.postedAt)} ${brl(amount)}`,
            antigo: `${oldPick.act} ${oldPick.occ.competence} (venc ${d10(oldPick.occ.dueDate)}, ${Math.round(dist(oldPick.occ) / DAY)}d)`,
            novo: `${newPick.act} ${newPick.occ.competence} (venc ${d10(newPick.occ.dueDate)}, ${Math.round(dist(newPick.occ) / DAY)}d)`,
          });
        }
      }
    }
    console.log(`${pairs} par(es) (conta, débito) com candidato na janela; ${diffs.length} mudam de destino:`);
    if (diffs.length) console.table(diffs);

    // ---------------------------------------------------------------- B ------
    console.log('\n=== B) funil da varredura de saída (payable-match) ===');
    const end = new Date();
    const start = new Date(end.getTime() - 90 * DAY);
    const antigo = await prisma.bankTransaction.count({
      where: { type: 'DEBIT', reconciliationStatus: 'PENDING', postedAt: { gte: start, lte: end } },
    });
    const novo = await prisma.bankTransaction.count({
      where: {
        type: 'DEBIT', reconciliationStatus: { not: 'IGNORED' },
        matches: { none: { reversedAt: null } }, settlementAckAt: null,
        postedAt: { gte: start, lte: end },
      },
    });
    console.log(`débitos elegíveis em 90 dias — gate antigo (PENDING): ${antigo} · gate novo (sem âncora): ${novo}`);
    // exige PAYABLE_AUTO_CONFIRM_DRY_RUN=true no ambiente
    const would = await payableMatch.confirmPayablesDateRange(start, end);
    console.log(`dry-run: ${would} débito(s) seriam confirmados (linhas "[dry-run]" acima).`);

    // ---------------------------------------------------------------- C ------
    console.log('\n=== C) ocorrências PAGAS sem vínculo ===');
    const orphans = await prisma.recurrentPayableOccurrence.findMany({
      where: {
        status: 'PAID',
        reconciliationMatches: { none: { reversedAt: null } },
      },
      include: { recurrentPayable: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
    });
    console.table(orphans.map(o => ({
      conta: o.recurrentPayable.name, competencia: o.competence, venc: d10(o.dueDate),
      pago: brl(Number(o.paidAmount ?? 0)), manual: o.paidById ? 'sim' : 'não',
      fk: o.bankTransactionId ? 'sim' : 'não',
    })));

    if (!apply) {
      console.log('\nDRY-RUN — nada foi escrito. Rode com --apply para ligar as órfãs.');
      return 0;
    }

    for (const o of orphans) {
      const txId = await recurrent.confirmOccurrenceFromBank(o.id);
      console.log(`${o.recurrentPayable.name} ${o.competence}: ${txId ? `ligada ao débito ${txId}` : 'sem débito inequívoco — deixada como está'}`);
    }
    return 0;
  } finally {
    await Promise.race([app.close(), new Promise(r => setTimeout(r, 5000))]);
  }
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
