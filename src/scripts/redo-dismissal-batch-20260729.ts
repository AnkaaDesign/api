/**
 * redo-dismissal-batch-20260729.ts
 *
 * Reaplica o lote de desligamento de 29/07/2026 17:45 que foi revertido em
 * 30/07/2026 19:32 ("Manual rollback of accidental dismissal").
 *
 * A reversão foi feita porque, no desenho antigo, demitir alguém removia a
 * pessoa do divisor RETROATIVAMENTE — inflando o bônus de toda a folha — e
 * ainda a fazia sumir da tela de bonificação. Com o divisor proporcional ao
 * tempo de elegibilidade, os dois problemas deixaram de existir: quem trabalhou
 * parte do período entra no denominador com o peso desse tempo e recebe a mesma
 * fração.
 *
 * Passa por `UserService.update`, não por SQL, de propósito: é o caminho que
 * dispara o `ChangeLog`, a ponte do Secullum e o novo fechamento de bonificação
 * no ato do desligamento (`BonusTerminationListener`).
 *
 * Datas: as originais do lote. 29/07 cai no período de AGOSTO (26/07–25/08),
 * então julho — já fechado e recalculado — não se move.
 *
 * Uso:
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     src/scripts/redo-dismissal-batch-20260729.ts [--apply]
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { UserService } from '../modules/people/user/user.service';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { CONTRACT_STATUS, TERMINATION_TYPE } from '../constants/enums';

const log = new Logger('redo-dismissal');
const APPLY = process.argv.includes('--apply');

/** Quem executa a ação — aparece como autor no ChangeLog. */
const ACTOR_USER_ID = '41fcb3fe-e1b6-43e9-bd72-41c072154100'; // Kennedy Campos

const BATCH: Array<{ id: string; name: string; terminationDate: string }> = [
  {
    id: '75005fe4-2746-434d-adb2-bb9357b7fcdf',
    name: 'Hugo Henrique Canheti Carvalho',
    terminationDate: '2026-07-29T17:45:25.619Z',
  },
  {
    // Único do lote cuja data foi corrigida depois da demissão original.
    id: 'e1d53cf9-4e54-4d1a-af5b-a19f7c07861b',
    name: 'Igor Santos Faria',
    terminationDate: '2026-07-27T16:00:00.000Z',
  },
  {
    id: 'f5e065b7-b65c-4e44-b040-3e8858f6f7d6',
    name: 'João Vitor Neves Silva',
    terminationDate: '2026-07-29T17:45:25.619Z',
  },
  {
    id: 'b5030d04-c928-4883-bd0d-dcf19f84fae2',
    name: 'Pedro Henrique Canheti',
    terminationDate: '2026-07-29T17:45:25.619Z',
  },
];

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const userService = app.get(UserService);

    log.log(`=== Lote de desligamento 29/07/2026 (${APPLY ? 'APLICANDO' : 'DRY-RUN'}) ===`);

    for (const p of BATCH) {
      const user = await prisma.user.findUnique({
        where: { id: p.id },
        select: {
          name: true,
          currentContractStatus: true,
          currentContractType: true,
          position: { select: { name: true, bonifiable: true } },
        },
      });

      if (!user) {
        log.error(`${p.name}: usuário não encontrado — PULANDO.`);
        continue;
      }
      if (user.currentContractStatus === CONTRACT_STATUS.TERMINATED) {
        log.warn(`${user.name}: já está TERMINATED — PULANDO.`);
        continue;
      }

      log.log(
        `${user.name}  [${user.position?.name ?? 'sem cargo'}, ` +
          `${user.position?.bonifiable ? 'bonificável' : 'NÃO bonificável'}, ` +
          `${user.currentContractType}]  →  TERMINATED em ${p.terminationDate.slice(0, 10)}`,
      );

      if (!APPLY) continue;

      await userService.update(
        p.id,
        {
          contractStatus: CONTRACT_STATUS.TERMINATED,
          terminationDate: new Date(p.terminationDate),
          terminationType: TERMINATION_TYPE.WITHOUT_CAUSE,
        } as never,
        undefined,
        ACTOR_USER_ID,
      );

      log.log(`  ✔ ${user.name} desligado.`);
    }

    if (!APPLY) {
      log.log('Dry-run. Rode com --apply para gravar.');
      return;
    }

    // O fechamento da bonificação roda de forma assíncrona no listener; dá o
    // tempo de ele terminar antes de derrubar o contexto do Nest.
    await new Promise(r => setTimeout(r, 45_000));

    const rows = await prisma.bonus.findMany({
      where: { year: 2026, month: 8, userId: { in: BATCH.map(b => b.id) } },
      select: {
        userId: true,
        eligibilityWeight: true,
        eligibleDays: true,
        periodBusinessDays: true,
        baseBonus: true,
        netBonus: true,
        terminatedAt: true,
        user: { select: { name: true } },
      },
    });

    log.log('--- Bonificação 08/2026 gravada no ato do desligamento ---');
    for (const r of rows) {
      log.log(
        `  ${r.user.name}: peso ${r.eligibilityWeight} (${r.eligibleDays}/${r.periodBusinessDays} d.ú.), ` +
          `base R$ ${r.baseBonus}, líquido R$ ${r.netBonus}, desligado ${r.terminatedAt?.toISOString().slice(0, 10) ?? '—'}`,
      );
    }
    if (rows.length === 0) {
      log.warn('  Nenhuma linha gravada — verifique o log do BonusTerminationListener.');
    }
  } finally {
    await app.close();
  }
}

main().catch(err => {
  log.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
