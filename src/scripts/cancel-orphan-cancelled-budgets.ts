/**
 * OS ORÇAMENTOS QUE FICARAM DE PÉ DEPOIS DE TODOS OS CAMINHÕES CAÍREM.
 *
 * O QUE ACONTECEU
 * ─────────────────────────────────────────────────────────────────────────────
 * A cascata "tarefa cancelada → orçamento cancelado" existe, mas só passou a
 * existir depois; e, enquanto existiu com o multitarefa, disparava no PRIMEIRO
 * veículo cancelado — o que a fazia recusar ou errar em grupo. O resultado é um
 * passivo: orçamentos PENDENTES e APROVADOS cujos veículos já foram TODOS
 * cancelados. A lista mostra proposta viva onde não há mais trabalho nenhum.
 *
 * Este script NÃO reimplementa o cancelamento. Ele chama
 * `BudgetService.cancelForTaskCancellation`, o MESMO método que a cascata chama
 * hoje — e é essa a razão de subir o Nest inteiro em vez de escrever no banco
 * direto. O método dá baixa em boleto no Sicredi, cancela NFS-e na prefeitura,
 * encerra envelope de assinatura em curso, grava ChangeLog e RECUSA quando há
 * dinheiro recebido. Um `UPDATE status='CANCELLED'` em SQL faria o estado
 * parecer certo e deixaria um boleto pagável no banco.
 *
 * A guarda de veículo ativo vive DENTRO do método, então o script não precisa
 * repeti-la: se algum veículo tiver voltado a ficar ativo entre a medição e a
 * execução, o método sai sozinho sem fazer nada.
 *
 * Rodar:  npx ts-node -r tsconfig-paths/register --transpile-only \
 *           src/scripts/cancel-orphan-cancelled-budgets.ts          (ensaio)
 *         … --apply                                                 (grava)
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { BudgetService } from '../modules/production/budget/budget.service';

const RAZAO = 'Orçamento cancelado: todos os veículos cobertos estão cancelados';

async function main() {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService, { strict: false });
    const budgets = app.get(BudgetService, { strict: false });

    // O ator. O cancelamento vira ChangeLog, e ChangeLog sem autor é uma linha
    // que ninguém sabe explicar daqui a um ano. Usa o admin mais antigo — o
    // mesmo critério de outras correções em lote deste repositório.
    const ator = await prisma.user.findFirst({
      // `User` não tem `status` — quem diz se a pessoa ainda trabalha aqui é
      // `currentContractStatus`. Um script que filtra pelo campo errado não
      // falha: o zod não passa por aqui e o Prisma recusa em tempo de tipo.
      where: { sector: { privileges: 'ADMIN' }, currentContractStatus: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    if (!ator) throw new Error('Nenhum usuário ADMIN ativo para assinar o ChangeLog.');

    // TEM veículo, e TODOS cancelados. `some` + `every` juntos de propósito:
    // `every` sozinho é verdadeiro para lista VAZIA, e orçamento sem veículo
    // nenhum é outro problema (105 linhas, de outra causa) que este script não
    // resolve e não deve tocar.
    const alvos = await prisma.budget.findMany({
      where: {
        status: { not: 'CANCELLED' },
        tasks: { some: {}, every: { status: 'CANCELLED' } },
      },
      select: {
        id: true,
        budgetNumber: true,
        status: true,
        total: true,
        _count: { select: { tasks: true } },
      },
      orderBy: { budgetNumber: 'asc' },
    });

    if (alvos.length === 0) {
      console.log('\nNenhum orçamento nessa condição. Nada a fazer.\n');
      return;
    }

    console.log(`\n▸ ${alvos.length} orçamento(s) com TODOS os veículos cancelados`);
    console.log(`  Autor do ChangeLog: ${ator.name}`);
    console.log(`  Modo: ${apply ? 'GRAVANDO' : 'ENSAIO (use --apply para gravar)'}\n`);

    for (const b of alvos) {
      const rotulo =
        `  nº ${String(b.budgetNumber).padStart(4, '0')}  ${b.status.padEnd(9)} ` +
        `${b._count.tasks} veíc.  R$ ${Number(b.total).toFixed(2)}`;

      if (!apply) {
        console.log(`${rotulo}   → cancelaria`);
        continue;
      }

      try {
        await budgets.cancelForTaskCancellation(b.id, ator.id, RAZAO);
        const depois = await prisma.budget.findUnique({
          where: { id: b.id },
          select: { status: true },
        });
        // O método sai em silêncio quando decide não agir (veículo que voltou a
        // ficar ativo). Conferir o estado DEPOIS é o que separa "cancelou" de
        // "achou que cancelou".
        console.log(`${rotulo}   → ${depois?.status === 'CANCELLED' ? 'CANCELADO' : `mantido (${depois?.status})`}`);
      } catch (e: any) {
        console.log(`${rotulo}   → RECUSADO: ${e?.message ?? e}`);
      }
    }

    const restantes = await prisma.budget.count({
      where: { status: { not: 'CANCELLED' }, tasks: { some: {}, every: { status: 'CANCELLED' } } },
    });
    console.log(`\n▸ Restam ${restantes} nessa condição.\n`);
  } finally {
    await app.close();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
