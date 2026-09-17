/**
 * O PASSIVO QUE A AUDITORIA DE 17/09/2026 MEDIU NO BANCO DE PRODUÇÃO.
 *
 * Três classes de linha, e elas NÃO se corrigem do mesmo jeito — por isso um
 * script só, com três passos explícitos, e não três scripts parecidos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PASSO 1 · COBRANÇA "PENDENTE" EM ORÇAMENTO CANCELADO  (23 linhas em 17/09)
 * ─────────────────────────────────────────────────────────────────────────────
 * `cancelForTaskCancellation` zerava o carimbo e carimbava o orçamento, mas não
 * chamava a cascata — e `Billing.status` é PERSISTIDO, com um escritor só. As 51
 * linhas do lote de 16/09 estão CANCELLED porque vieram do backfill da migração;
 * as 23 de 17/09 vieram pelo CÓDIGO e ficaram para trás. A correção do código já
 * foi feita; isto limpa o que ficou.
 *
 * Reparo: `BillingStatusCascadeService.recomputeForQuote`. A primeira regra do
 * `resolve` é justamente "orçamento cancelado cancela as cobranças dele", então
 * não há valor inventado aqui — é o derivador rodando onde não rodou.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PASSO 2 · ORÇAMENTO SEM NENHUM VEÍCULO  (105 linhas, 83 com faturamento)
 * ─────────────────────────────────────────────────────────────────────────────
 * A FK mora na TAREFA, então apagar o último caminhão deixava o orçamento de pé,
 * sem ninguém. Eram invisíveis enquanto a lista consultava tarefas; quando ela
 * passou a consultar orçamentos, tomaram a primeira página — e 81 das 355 linhas
 * "Pendente" da lista de Faturamento são cobranças desses órfãos.
 *
 * ⚠️ O script irmão (`cancel-orphan-cancelled-budgets.ts`) NÃO os alcança: ele
 * exige `some` + `every` sobre as tarefas, e `some` é falso para lista vazia.
 * Foi deliberado lá ("outro problema, de outra causa"); esta é a outra causa.
 *
 * Reparo: `cancelForTaskCancellation`, o MESMO método da cascata — ele dá baixa
 * em boleto no Sicredi, cancela NFS-e na prefeitura, encerra cerimônia de
 * assinatura e RECUSA quando há dinheiro recebido. CANCELA, não apaga: o número
 * é o que o cliente tem no e-mail, e cancelar é reversível.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PASSO 3 · FATURA QUE NÃO FECHA COM AS PRÓPRIAS PARCELAS  (5 linhas)
 * ─────────────────────────────────────────────────────────────────────────────
 * SÓ RELATA, e é de propósito. A fatura do orçamento 115 diz R$ 18.235,00 e a
 * única parcela emitida é de R$ 16.187,50: são R$ 2.047,50 que nunca viraram
 * boleto e que o cliente nunca viu. Escolher sozinho entre "emitir a diferença",
 * "baixar o valor da fatura" ou "cobrar por fora" seria decidir sobre dinheiro do
 * cliente sem quem responde por ele. A guarda nova já impede que nasçam outras.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { BudgetService } from '../modules/production/budget/budget.service';
import { BillingStatusCascadeService } from '../modules/financial/billing/billing-status-cascade.service';

const REASON = 'Orçamento cancelado: ficou sem nenhum veículo';
const brl = (n: unknown) => `R$ ${Number(n).toFixed(2)}`;

async function main() {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  try {
    const prisma = app.get(PrismaService, { strict: false });
    const budgets = app.get(BudgetService, { strict: false });
    const cascade = app.get(BillingStatusCascadeService, { strict: false });

    // O ator do ChangeLog. Mesma escolha das outras correções em lote: o admin
    // mais antigo com vínculo ativo. Linha sem autor é linha que ninguém explica
    // daqui a um ano.
    const actor = await prisma.user.findFirst({
      where: { sector: { privileges: 'ADMIN' }, currentContractStatus: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    if (!actor) throw new Error('Nenhum usuário ADMIN ativo para assinar o ChangeLog.');

    console.log(`\n${apply ? '=== APLICANDO ===' : '=== ENSAIO (use --apply para gravar) ==='}`);
    console.log(`Ator do ChangeLog: ${actor.name}\n`);

    // ── PASSO 1 ────────────────────────────────────────────────────────────
    const desalinhadas = (await (prisma as any).billing.findMany({
      where: { quote: { status: 'CANCELLED' }, status: { not: 'CANCELLED' } },
      select: { id: true, status: true, quoteId: true, quote: { select: { budgetNumber: true } } },
    })) as Array<{ id: string; status: string; quoteId: string; quote: { budgetNumber: number } }>;

    console.log(`[1] Cobranças fora de sincronia com orçamento cancelado: ${desalinhadas.length}`);
    for (const b of desalinhadas) {
      console.log(`    orçamento ${b.quote.budgetNumber}: ${b.status} → CANCELLED`);
    }
    if (apply) {
      const quoteIds = [...new Set(desalinhadas.map(b => b.quoteId))];
      for (const quoteId of quoteIds) await cascade.recomputeForQuote(quoteId);
      console.log(`    ✓ ${quoteIds.length} orçamento(s) recalculado(s).`);
    }

    // ── PASSO 2 ────────────────────────────────────────────────────────────
    const orfaos = await prisma.budget.findMany({
      where: { status: { not: 'CANCELLED' }, tasks: { none: {} } },
      select: {
        id: true,
        budgetNumber: true,
        status: true,
        total: true,
        _count: { select: { billings: true, customerConfigs: true } },
      },
      orderBy: { budgetNumber: 'asc' },
    });

    console.log(`\n[2] Orçamentos sem nenhum veículo: ${orfaos.length}`);
    for (const q of orfaos) {
      console.log(
        `    nº ${q.budgetNumber} (${q.status}, ${brl(q.total)}, ` +
          `${q._count.billings} faturamento(s), ${q._count.customerConfigs} pagador(es))`,
      );
    }
    let cancelados = 0;
    const recusados: string[] = [];
    if (apply) {
      for (const q of orfaos) {
        try {
          await budgets.cancelForTaskCancellation(q.id, actor.id, REASON);
          cancelados++;
        } catch (err) {
          // A recusa é o método fazendo o seu trabalho — dinheiro recebido não se
          // cancela por varredura. Registra e segue: um órfão travado não pode
          // impedir os outros cento e quatro.
          recusados.push(
            `nº ${q.budgetNumber}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      console.log(`    ✓ ${cancelados} cancelado(s), ${recusados.length} recusado(s).`);
      for (const r of recusados) console.log(`      ⚠ ${r}`);
    }

    // ── PASSO 3 · SÓ RELATO ────────────────────────────────────────────────
    const faturas = await prisma.invoice.findMany({
      where: { status: { not: 'CANCELLED' } },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        installments: { where: { status: { not: 'CANCELLED' } }, select: { amount: true } },
        customerConfig: { select: { quote: { select: { budgetNumber: true } } } },
      },
    });
    const naoFecham = faturas
      .map(i => {
        const soma = i.installments.reduce((s, z) => s + Number(z.amount), 0);
        return { ...i, soma, diff: Number((Number(i.totalAmount) - soma).toFixed(2)) };
      })
      .filter(i => Math.abs(i.diff) > 0.01);

    console.log(`\n[3] Faturas que não fecham com as próprias parcelas: ${naoFecham.length} (SÓ RELATO)`);
    let buraco = 0;
    for (const i of naoFecham) {
      buraco += i.diff;
      console.log(
        `    orçamento ${i.customerConfig?.quote?.budgetNumber ?? '—'} · ${i.status} · ` +
          `fatura ${brl(i.totalAmount)} · parcelas ${brl(i.soma)} (${i.installments.length}) · ` +
          `diferença ${brl(i.diff)}`,
      );
    }
    if (naoFecham.length > 0) {
      console.log(`    Total nunca cobrado: ${brl(buraco)} — decisão do financeiro, não deste script.`);
    }

    console.log(
      `\n${apply ? 'Concluído.' : 'Ensaio concluído — nada foi gravado. Rode com --apply.'}\n`,
    );
  } finally {
    await app.close();
  }
}

// `process.exit` explícito: Baileys e Redis seguram o event loop mesmo depois do
// `app.close()`, e sem isto o script fica pendurado para sempre.
main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
