/**
 * OS ORÇAMENTOS QUE FICARAM APROVADOS DEPOIS DE PERDER AS ASSINATURAS.
 *
 * Um orçamento APROVADO afirma que alguém concordou com AQUELE documento.
 * Quando uma alteração material derruba a coleta, o documento aceito deixou de
 * existir — e o status ficava de pé. A tela mostrava "Aprovado" ao lado do aviso
 * de que as assinaturas foram invalidadas.
 *
 * A partir de agora `BudgetService.markInvalidatedBySignature` cuida disso no
 * ato. Este script é para o passivo, e chama O MESMO método — ele conhece as
 * guardas (a trava do dinheiro, os estados que não regridem) e grava a trilha.
 *
 * ⚠️ A SELEÇÃO EXCLUI QUEM FOI REAPROVADO DEPOIS. Se a última mudança de status
 * é MAIS NOVA que a invalidação, alguém olhou o orçamento já invalidado e
 * decidiu aprová-lo assim mesmo. Reverter isso desfaria uma decisão humana — e
 * em produção esse é o caso da MAIORIA (4 de 5 em 17/09/2026). É a diferença
 * entre corrigir um esquecimento do sistema e sobrescrever uma pessoa.
 *
 * Rodar:  npx ts-node -r tsconfig-paths/register --transpile-only \
 *           src/scripts/revert-budgets-with-invalidated-signatures.ts   (ensaio)
 *         … --apply                                                    (grava)
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { BudgetService } from '../modules/production/budget/budget.service';

async function main() {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService, { strict: false });
    const budgets = app.get(BudgetService, { strict: false });

    const actor = await prisma.user.findFirst({
      where: { sector: { privileges: 'ADMIN' }, currentContractStatus: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    if (!actor) throw new Error('Nenhum usuário ADMIN ativo para assinar o ChangeLog.');

    const candidates = await prisma.budget.findMany({
      where: {
        status: { in: ['APPROVED', 'SIGNED'] },
        signatureEnvelopes: { some: { status: 'INVALIDATED' } },
      },
      select: {
        id: true,
        budgetNumber: true,
        status: true,
        signatureEnvelopes: {
          where: { status: 'INVALIDATED' },
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: { updatedAt: true, invalidatedReason: true },
        },
      },
      orderBy: { budgetNumber: 'asc' },
    });

    console.log(`\n▸ ${candidates.length} orçamento(s) aprovado(s) com envelope invalidado`);
    console.log(`  Autor do ChangeLog: ${actor.name}`);
    console.log(`  Modo: ${apply ? 'GRAVANDO' : 'ENSAIO (use --apply para gravar)'}\n`);

    for (const b of candidates) {
      const envelope = b.signatureEnvelopes[0];
      const label = `  nº ${String(b.budgetNumber).padStart(4, '0')}  ${b.status.padEnd(8)}`;

      // A última mudança de status registrada na trilha.
      const lastStatus = await prisma.changeLog.findFirst({
        where: { entityType: 'TASK_QUOTE', entityId: b.id, field: 'status' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      if (lastStatus && envelope && lastStatus.createdAt > envelope.updatedAt) {
        console.log(`${label} → PULADO: reaprovado em ${lastStatus.createdAt.toLocaleString('pt-BR')}, depois da invalidação`);
        continue;
      }

      if (!apply) {
        console.log(`${label} → reverteria para PENDENTE`);
        continue;
      }

      await budgets.markInvalidatedBySignature(
        b.id,
        envelope?.invalidatedReason ?? 'o orçamento mudou depois da coleta',
        actor.id,
      );
      const after = await prisma.budget.findUnique({
        where: { id: b.id },
        select: { status: true },
      });
      // O método sai em silêncio quando a trava do dinheiro o impede. Conferir o
      // estado DEPOIS é o que separa "reverteu" de "achou que reverteu".
      console.log(`${label} → ${after?.status === 'PENDING' ? 'PENDENTE' : `mantido (${after?.status}) — ver o aviso no log`}`);
    }

    console.log('');
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
