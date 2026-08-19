/**
 * "Telefone - Claro" ainda estava com `expectsNf = true` — a edição que o
 * usuário achou ter feito não chegou ao servidor (o ChangeLog da conta está
 * vazio; quem foi atualizado às 12:50 foi a Monte Sião). Por isso as
 * competências dela seguem em "Aguardando nota".
 *
 * Desliga a espera de nota na conta E nas competências já fechadas, pelo mesmo
 * caminho auditado do formulário (`applyExpectsNfToPast`), e alinha a ocorrência
 * futura da Monte Sião que ficou para trás: ela estava PAGA quando a edição
 * rodou, então não entrou nem na janela retroativa (vence depois de hoje) nem na
 * de reprecificação (que só toca ocorrência em aberto).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { RecurrentPayableService } from '../modules/financial/recurrent-payable/recurrent-payable.service';

const CLARO = '0caece87-ab9d-4fe8-9404-029c7ac14af8';

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const service = app.get(RecurrentPayableService);
  try {
    const before = await prisma.recurrentPayableOccurrence.findMany({
      where: { expectsNf: true, fiscalDocumentId: null },
      include: { recurrentPayable: { select: { name: true, expectsNf: true } } },
      orderBy: [{ recurrentPayableId: 'asc' }, { dueDate: 'asc' }],
    });
    console.table(
      before.map(o => ({
        conta: o.recurrentPayable.name,
        conta_espera_nf: o.recurrentPayable.expectsNf,
        competencia: o.competence,
        status: o.status,
      })),
    );
    if (!apply) {
      console.log('DRY-RUN — nada foi escrito. Rode com --apply.');
      return 0;
    }

    const res = await service.update(CLARO, {
      expectsNf: false,
      applyExpectsNfToPast: true,
    } as any);
    console.log(`Claro: ${res.message}`);

    // Qualquer ocorrência que ficou esperando nota de uma conta que não espera
    // mais — inclusive as futuras, que nenhuma das duas janelas alcança.
    const orphan = await prisma.recurrentPayableOccurrence.updateMany({
      where: { expectsNf: true, fiscalDocumentId: null, recurrentPayable: { expectsNf: false } },
      data: { expectsNf: false },
    });
    console.log(`Ocorrências alinhadas com a conta: ${orphan.count}`);

    const after = await prisma.recurrentPayableOccurrence.count({
      where: { expectsNf: true, fiscalDocumentId: null, recurrentPayable: { expectsNf: false } },
    });
    console.log(`Divergentes restantes: ${after}`);
    return 0;
  } catch (e) {
    console.error(`FALHOU: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    await Promise.race([app.close(), new Promise(r => setTimeout(r, 15_000))]).catch(() => undefined);
  }
}
main().then(c => process.exit(c));
