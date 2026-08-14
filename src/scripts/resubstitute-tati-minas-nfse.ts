/**
 * Substituição da NFS-e 3199 — tarefa "Tati Minas 8,50" (placa EKH7691, orçamento 546).
 *
 * POR QUE: a NF 3199 foi emitida em 04/08/2026 SEM o número de pedido do cliente
 * (`Pedido: 16677`), porque `TaskQuoteCustomerConfig.orderNumber` ainda estava vazio naquele
 * momento — a discriminação saiu só com o veículo e os serviços. A nota está fiscalmente
 * errada para o cliente, então tem de ser substituída, não mantida.
 *
 * A tentativa de 13/08 falhou porque o revert pedia o cancelamento ANTES de existir uma nota
 * substituta, e o fiscal de Ibiporã recusa exatamente isso ("informando o MOTIVO do
 * cancelamento e o NÚMERO da nota fiscal substituta"). A nota ficou em CANCEL_REJECTED, o
 * portão de boleto exigia AUTHORIZED literal, e os 3 boletos travaram em CREATING — que por
 * sua vez bloqueavam qualquer novo revert. Deadlock.
 *
 * O QUE ESTE SCRIPT FAZ, na ordem correta do fluxo novo:
 *   1. Confere as pré-condições (orderNumber preenchido, nenhuma parcela paga).
 *   2. Reverte o faturamento — agora destrava, porque boleto CREATING com nossoNumero `TMP-`
 *      comprovadamente nunca chegou ao Sicredi. A NF 3199 PERMANECE viva e vinculada.
 *   3. Aprova o faturamento de novo — emite a NF nova JÁ COM o pedido, registra os 3 boletos
 *      contra ela, e `supersedePreviousNfses` pede o cancelamento da 3199 citando a nova
 *      como substituta.
 *   4. Audita o resultado final: nota nova, boletos registrados, estado da 3199.
 *
 * Idempotente o bastante para ser reexecutado: se o orçamento já estiver em BUDGET_APPROVED
 * ele pula o revert; se já houver nota nova autorizada ele só audita.
 *
 * Run:
 *   NODE_ENV=production npx tsx -r tsconfig-paths/register src/scripts/resubstitute-tati-minas-nfse.ts          # dry-run
 *   NODE_ENV=production npx tsx -r tsconfig-paths/register src/scripts/resubstitute-tati-minas-nfse.ts --apply
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { TaskQuoteService } from '../modules/production/task-quote/task-quote.service';

const QUOTE_ID = 'c9a7e245-5270-4c8d-ba76-017c63d6ac0e';
const TASK_ID = '455200bc-57b8-4796-a5eb-98b363feede3';
const OLD_NFSE_NUMBER = 3199;

// Autor da ação no ChangeLog: o mesmo operador que conduziu o faturamento (FINANCIAL).
// NUNCA usar a string 'system' como userId — isso reverte a transação inteira.
const ACTING_USER_ID = '566f8124-38fd-4aea-a31b-81b47086d600';

const APPLY = process.argv.includes('--apply');

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function snapshot(prisma: PrismaService, label: string) {
  const quote = await prisma.taskQuote.findUnique({
    where: { id: QUOTE_ID },
    select: { status: true, total: true, budgetNumber: true },
  });
  const notes = await prisma.nfseDocument.findMany({
    where: { taskId: TASK_ID },
    select: {
      nfseNumber: true,
      status: true,
      invoiceId: true,
      supersededByNfseNumber: true,
      cancelRequestStatus: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const slips = await prisma.bankSlip.findMany({
    where: { installment: { invoice: { taskId: TASK_ID } } },
    select: {
      nossoNumero: true,
      status: true,
      amount: true,
      dueDate: true,
      errorMessage: true,
      installment: { select: { number: true } },
    },
    orderBy: { dueDate: 'asc' },
  });

  console.log(`\n───── ${label} ─────`);
  console.log(`Orçamento ${quote?.budgetNumber}: ${quote?.status} — R$ ${quote?.total}`);
  console.log('NFS-e da tarefa:');
  for (const n of notes) {
    console.log(
      `  nº ${n.nfseNumber ?? '(sem número)'} · ${n.status}` +
        `${n.invoiceId ? ' · com fatura' : ' · SEM fatura'}` +
        `${n.supersededByNfseNumber ? ` · substituída pela nº ${n.supersededByNfseNumber}` : ''}` +
        `${n.cancelRequestStatus ? ` · pedido de cancelamento ${n.cancelRequestStatus}` : ''}`,
    );
  }
  console.log('Boletos:');
  if (slips.length === 0) console.log('  (nenhum)');
  for (const s of slips) {
    console.log(
      `  parcela ${s.installment.number} · ${s.status} · ${s.nossoNumero} · ` +
        `R$ ${s.amount} · vence ${s.dueDate.toISOString().slice(0, 10)}` +
        `${s.errorMessage ? ` · ERRO: ${s.errorMessage}` : ''}`,
    );
  }
  return { quote, notes, slips };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const taskQuoteService = app.get(TaskQuoteService);

    // ── Pré-condições ────────────────────────────────────────────────────────
    const config = await prisma.taskQuoteCustomerConfig.findFirst({
      where: { quoteId: QUOTE_ID },
      select: { id: true, orderNumber: true, generateInvoice: true, generateBankSlip: true },
    });

    if (!config?.orderNumber?.trim()) {
      throw new Error(
        'ABORTADO: o número do pedido está VAZIO na configuração do cliente. Reemitir agora ' +
          'produziria uma nota com o mesmo defeito da 3199. Preencha o pedido antes.',
      );
    }
    console.log(`✓ Número do pedido presente: "${config.orderNumber}" — a nota nova o levará.`);
    console.log(
      `✓ generateInvoice=${config.generateInvoice}, generateBankSlip=${config.generateBankSlip}`,
    );

    const paid = await prisma.installment.count({
      where: { invoice: { taskId: TASK_ID }, status: 'PAID' },
    });
    if (paid > 0) {
      throw new Error(
        `ABORTADO: ${paid} parcela(s) já paga(s). Um faturamento com pagamento registrado não ` +
          'pode ser revertido — resolva o pagamento antes.',
      );
    }
    console.log('✓ Nenhuma parcela paga.');

    await snapshot(prisma, 'ESTADO ATUAL');

    if (!APPLY) {
      console.log(
        '\nDRY-RUN: nada foi alterado. Rode com --apply para executar a substituição.\n' +
          'O que aconteceria:\n' +
          '  1. Reverter o faturamento (a NF 3199 CONTINUA viva e vinculada à tarefa)\n' +
          '  2. Aprovar o faturamento novamente → emite NF nova COM "Pedido: ' +
          `${config.orderNumber}"\n` +
          '  3. Registrar os 3 boletos no Sicredi contra a NF nova\n' +
          `  4. Pedir o cancelamento da NF ${OLD_NFSE_NUMBER} citando a nova como substituta`,
      );
      return;
    }

    // ── 1. Revert ────────────────────────────────────────────────────────────
    const quote = await prisma.taskQuote.findUnique({
      where: { id: QUOTE_ID },
      select: { status: true },
    });

    if (quote?.status === 'BUDGET_APPROVED') {
      console.log('\n▸ Orçamento já está em BUDGET_APPROVED — revert já feito, pulando.');
    } else {
      console.log('\n▸ Revertendo o faturamento...');
      await taskQuoteService.revertBillingApproval(QUOTE_ID, ACTING_USER_ID);
      console.log('✓ Faturamento revertido. A NF 3199 permanece ATIVA na prefeitura.');
      await snapshot(prisma, 'APÓS O REVERT');
    }

    // ── 2. Reaprovar → nova NF + boletos + substituição ───────────────────────
    console.log('\n▸ Aprovando o faturamento novamente (emite NF nova, registra boletos)...');
    await taskQuoteService.internalApprove(QUOTE_ID, ACTING_USER_ID);
    console.log('✓ Faturamento aprovado.');

    // A emissão e o registro são síncronos no internalApprove, mas o pedido de cancelamento
    // na Elotech resolve de forma assíncrona (AGUARDANDO_FISCAL). Dá um respiro antes de auditar.
    await sleep(3000);

    // ── 3. Auditoria ─────────────────────────────────────────────────────────
    const final = await snapshot(prisma, 'ESTADO FINAL');

    const newNote = final.notes.find(
      n => n.status === 'AUTHORIZED' && n.nfseNumber !== OLD_NFSE_NUMBER,
    );
    const oldNote = final.notes.find(n => n.nfseNumber === OLD_NFSE_NUMBER);
    const unregistered = final.slips.filter(
      s => s.status === 'CREATING' || s.status === 'REGISTERING' || s.nossoNumero.startsWith('TMP-'),
    );

    console.log('\n═════ VEREDITO ═════');
    console.log(
      newNote
        ? `✓ NF nova emitida e autorizada: nº ${newNote.nfseNumber}`
        : '✗ NENHUMA nota nova autorizada — verifique os logs da emissão.',
    );
    console.log(
      unregistered.length === 0
        ? `✓ Todos os ${final.slips.length} boleto(s) registrados no Sicredi.`
        : `✗ ${unregistered.length} boleto(s) ainda sem registro: ` +
            unregistered.map(s => `parcela ${s.installment.number} (${s.status})`).join(', '),
    );
    if (oldNote) {
      if (oldNote.status === 'CANCELLED') {
        console.log(`✓ NF ${OLD_NFSE_NUMBER} cancelada na prefeitura.`);
      } else if (oldNote.status === 'CANCEL_REQUESTED') {
        console.log(
          `⏳ NF ${OLD_NFSE_NUMBER}: cancelamento solicitado citando a nº ` +
            `${oldNote.supersededByNfseNumber}, aguardando o fiscal. O cron ` +
            '`nfse-cancellation-reconcile` acompanha e notifica o desfecho.',
        );
      } else {
        console.log(
          `⚠ NF ${OLD_NFSE_NUMBER} segue ${oldNote.status}` +
            `${oldNote.supersededByNfseNumber ? ` (substituta nº ${oldNote.supersededByNfseNumber} registrada)` : ''}. ` +
            'O cron reenvia o pedido a cada 24h; acompanhe pelo card "Histórico de NFS-e" da tarefa.',
        );
      }
    }
  } finally {
    // O encerramento derruba as conexões do ioredis e costuma emitir EPIPE/"Connection is
    // closed" DEPOIS de todo o trabalho já ter sido feito. Engolir aqui evita que um ruído
    // de shutdown se disfarce de falha da substituição.
    await app.close().catch(() => undefined);
  }
}

main()
  .then(() => {
    // O contexto standalone mantém as filas Bull/Redis e os crons vivos, então o processo
    // não encerra sozinho mesmo depois de `app.close()`. Sair explicitamente — a esta altura
    // todo o trabalho já está gravado no banco.
    process.exit(0);
  })
  .catch(err => {
    console.error('\n✗ FALHOU:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
