/**
 * Auditoria + reparo dos vínculos de conta recorrente feitos ANTES da trava de
 * identidade (o varredor escolhia o débito só pela CATEGORIA, e uma categoria
 * tem vários credores: "Internet / Telefone" tem PRTurbo, Claro e Telefônica).
 *
 * Regra aplicada — a MESMA do varredor de hoje (`identityMatches`, que aceita
 * documento OU nome, porque "Diária - Limpeza" carrega o CNPJ da própria Ankaa
 * no lugar do CPF da diarista):
 *
 *   um débito só quita a ocorrência de quem ELE pagou.
 *
 * O que faz quando o vínculo não passa na trava:
 *   · apaga o ReconciliationMatch;
 *   · se a ocorrência ficou sem nenhum vínculo vivo E não teve baixa manual
 *     (paidById nulo), reabre a ocorrência — ela nunca teve lastro;
 *   · solta o FK `bankTransactionId` órfão (marcado PAGO por um pagamento que
 *     já estava inteiramente alocado em outro lugar — o mês adiantado);
 *   · recalcula o estado derivado das transações tocadas.
 *
 * Não recria vínculo nenhum: quem religa é a varredura oficial, com as regras
 * novas. Rode `--apply` para escrever.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { RecurrentPayableService } from '../modules/financial/recurrent-payable/recurrent-payable.service';
import { deriveTransactionState } from '../modules/financial/reconciliation/transaction-status';

/** Vínculos que o reparo NÃO desfaz sozinho — ver o comentário no laço. */
const SKIP_MATCH_IDS: string[] = process.env.SKIP_MATCH_IDS?.split(',').filter(Boolean) ?? [];

async function main(): Promise<number> {
  const logger = new Logger('audit-recurrent-creditor');
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const service = app.get(RecurrentPayableService);

  try {
    const payables = await prisma.recurrentPayable.findMany({ include: { supplier: true } });
    const byId = new Map(payables.map(p => [p.id, p]));
    const occurrences = await prisma.recurrentPayableOccurrence.findMany({
      include: {
        reconciliationMatches: { where: { reversedAt: null }, include: { transaction: true } },
      },
      orderBy: [{ recurrentPayableId: 'asc' }, { dueDate: 'asc' }],
    });

    const wrong: any[] = [];
    const skipped: any[] = [];
    const orphanFk: any[] = [];
    const touchedTxIds = new Set<string>();

    for (const occ of occurrences) {
      const payable = byId.get(occ.recurrentPayableId);
      if (!payable) continue;
      let live = occ.reconciliationMatches.length;
      for (const m of occ.reconciliationMatches) {
        const tx = m.transaction;
        const ok = (service as any).identityMatches(payable, tx?.counterpartyCnpjCpf, tx?.counterpartyName);
        if (ok) continue;
        // Fica de fora do reparo automático: um PIX de R$340 para MOACIR FABIO
        // (CPF 033.817.119-38) quitando uma diária da Laide (CPF 020.435.129-43)
        // tanto pode ser vínculo errado quanto uma substituta paga na conta de
        // outra pessoa. Só quem estava lá sabe — reportar, nunca adivinhar.
        if (SKIP_MATCH_IDS.includes(m.id)) {
          skipped.push({ conta: payable.name, competencia: occ.competence, valor: String(m.allocatedAmount), pago_a: tx?.counterpartyName ?? '' });
          continue;
        }
        wrong.push({
          conta: payable.name,
          competencia: occ.competence,
          valor: String(m.allocatedAmount),
          pago_a: (tx?.counterpartyName ?? '').slice(0, 38),
          data: tx?.postedAt?.toISOString().slice(0, 10),
        });
        live--;
        if (apply) {
          touchedTxIds.add(m.transactionId);
          await prisma.reconciliationMatch.delete({ where: { id: m.id } });
        }
      }
      // Ocorrência carimbada PAGA por um pagamento que já estava INTEIRAMENTE
      // alocado a outra ocorrência: o varredor antigo fechava a próxima
      // ocorrência aberta e só DEPOIS descobria, no `writeOccurrenceMatch`, que
      // o débito não tinha mais saldo — e ele ficava PAGO sem vínculo nenhum.
      // É por isso que setembro (competência que ainda não aconteceu) aparece
      // pago em nove contas diferentes.
      //
      // O teste é o SALDO do pagamento, não a ausência de vínculo: uma
      // ocorrência da era anterior ao match row está igualmente sem vínculo, mas
      // o débito dela continua com saldo — essa é legítima e não se toca.
      if (live === 0 && occ.status === 'PAID' && occ.bankTransactionId) {
        const tx = await prisma.bankTransaction.findUnique({
          where: { id: occ.bankTransactionId },
          select: { amount: true },
        });
        const agg = await prisma.reconciliationMatch.aggregate({
          where: { transactionId: occ.bankTransactionId, reversedAt: null },
          _sum: { allocatedAmount: true },
        });
        const left = Math.abs(Number(tx?.amount ?? 0)) - Number(agg._sum.allocatedAmount ?? 0);
        if (left > 0.01) continue; // pagamento ainda tem lastro para esta linha
        orphanFk.push({
          conta: payable.name,
          competencia: occ.competence,
          status: occ.status,
          pago: occ.paidAmount ? String(occ.paidAmount) : '',
          baixa_manual: occ.paidById != null,
          sobra_do_pagamento: left.toFixed(2),
        });
        if (apply) {
          touchedTxIds.add(occ.bankTransactionId);
          await prisma.recurrentPayableOccurrence.update({
            where: { id: occ.id },
            // Baixa manual é declaração de gente: some só o vínculo bancário
            // falso, o "pago" declarado fica.
            data: occ.paidById
              ? { bankTransactionId: null, reconciledAt: null }
              : {
                  status: 'PENDING',
                  paidAmount: null,
                  paidAt: null,
                  bankTransactionId: null,
                  reconciledAt: null,
                },
          });
        }
      }
    }

    console.log(`Vínculos de credor errado: ${wrong.length}`);
    if (wrong.length) console.table(wrong);
    if (skipped.length) {
      console.log(`Vínculos suspeitos MANTIDOS (decisão humana): ${skipped.length}`);
      console.table(skipped);
    }
    console.log(`Ocorrências carimbadas PAGAS sem lastro: ${orphanFk.length}`);
    if (orphanFk.length) console.table(orphanFk);

    if (!apply) {
      console.log('DRY-RUN — nada foi escrito. Rode com --apply.');
      return 0;
    }

    for (const id of touchedTxIds) {
      const state = await deriveTransactionState(prisma, id);
      await prisma.bankTransaction.update({
        where: { id },
        data: { reconciliationStatus: state.status, expectsFiscalDocument: state.expectsFiscalDocument },
      });
    }
    console.log(`Estado derivado recalculado em ${touchedTxIds.size} transação(ões).`);

    const settled = await service.reconcilePendingFromBank();
    console.log(`Varredura oficial: ${settled} ocorrência(s) religada(s) corretamente.`);
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
