/**
 * smoke-test-bonus-eligibility-events.ts
 *
 * Prova, em produção e pelo caminho REAL (`UserService.update`), que mudar a
 * data de demissão de um colaborador JÁ desligado dispara a reconciliação da
 * bonificação — o furo que existia até 2026-08-11, em que só a TRANSIÇÃO para
 * TERMINATED emitia evento.
 *
 * POR QUE É SEGURO RODAR EM PRODUÇÃO
 * ----------------------------------
 * Só toca a conta de smoke-test (`plotter.ankaa@gmail.com`), que
 * `NON_PAYROLL_ACCOUNT_EMAILS` exclui da elegibilidade ANTES de qualquer conta:
 * ela nunca entra em `entries`, nunca soma no divisor e não tem linha `Bonus`.
 * Logo, o evento dispara e o listener roda ponta a ponta sem poder alterar o
 * bônus de ninguém.
 *
 * A data original é RESTAURADA no fim, inclusive se o meio falhar.
 *
 *   npx ts-node -r tsconfig-paths/register --transpile-only \
 *     src/scripts/smoke-test-bonus-eligibility-events.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { UserService } from '../modules/people/user/user.service';
import { CacheService } from '../modules/common/cache/cache.service';
import { getCurrentPeriod } from '../utils/bonus';

const TEST_EMAIL = 'plotter.ankaa@gmail.com';
const log = new Logger('smoke-eligibility-events');

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);
  const userService = app.get(UserService);
  const cache = app.get(CacheService);
  const { year, month } = getCurrentPeriod();
  const cacheKey = `bonus:live-period:${year}:${month}`;

  const user = await prisma.user.findFirst({
    where: { email: TEST_EMAIL },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw new Error(`Conta de teste ${TEST_EMAIL} não encontrada.`);

  const contract = await prisma.employmentContract.findFirst({
    where: { userId: user.id, isCurrent: true },
    select: { id: true, status: true, terminationDate: true },
  });
  if (!contract) throw new Error('Conta de teste sem vínculo corrente.');
  if (contract.status !== 'TERMINATED') {
    throw new Error(
      `Este teste exige a conta de teste JÁ desligada (status atual: ${contract.status}).`,
    );
  }

  const original = contract.terminationDate;
  if (!original) throw new Error('Conta de teste sem data de desligamento.');

  // Nova data: 5 dias antes. 13:00 LOCAL é a âncora que o DateTimeInput usa em
  // todo campo de data do sistema — carimbar meia-noite faria a data aparecer
  // um dia adiantada em UTC.
  const novaData = new Date(original);
  novaData.setDate(novaData.getDate() - 5);
  novaData.setHours(13, 0, 0, 0);

  console.log(`\n${'='.repeat(78)}`);
  console.log(`Conta de teste: ${user.name} (${user.email})`);
  console.log(`Vínculo ${contract.id} — status ${contract.status}`);
  console.log(`Data ORIGINAL: ${original.toISOString()}`);
  console.log(`Data de TESTE: ${novaData.toISOString()}`);
  console.log(`Período corrente: ${String(month).padStart(2, '0')}/${year}`);
  console.log('='.repeat(78) + '\n');

  let restored = false;
  const restore = async () => {
    if (restored) return;
    restored = true;
    try {
      await userService.update(user.id, { terminationDate: original } as never, undefined, user.id);
      const back = await prisma.employmentContract.findUnique({
        where: { id: contract.id },
        select: { terminationDate: true },
      });
      const ok = back?.terminationDate?.getTime() === original.getTime();
      console.log(
        `\n[restauração] data de volta em ${back?.terminationDate?.toISOString()} — ${ok ? 'OK' : 'DIVERGENTE!'}`,
      );
      if (!ok) {
        console.log(
          `[restauração] ATENÇÃO: restaure à mão para ${original.toISOString()} ` +
            `(contrato ${contract.id}).`,
        );
      }
    } catch (err) {
      console.error(
        `\n[restauração] FALHOU. Restaure à mão a data ${original.toISOString()} ` +
          `no contrato ${contract.id}.`,
        err,
      );
    }
  };

  try {
    // Semeia o cache para provar que a invalidação acontece de verdade.
    await cache.setObject(cacheKey, { marcador: 'antes-do-evento' }, 3600);
    const antes = await cache.getObject(cacheKey);
    console.log(`[cache] semeado: ${JSON.stringify(antes)}`);

    console.log('\n--- alterando a data de demissão pelo caminho real ---\n');
    await userService.update(user.id, { terminationDate: novaData } as never, undefined, user.id);

    const gravada = await prisma.employmentContract.findUnique({
      where: { id: contract.id },
      select: { terminationDate: true },
    });
    console.log(`\n[banco] data gravada: ${gravada?.terminationDate?.toISOString()}`);

    // O cache é derrubado IMEDIATAMENTE (a tela não pode servir número velho);
    // a regravação das linhas é coalescida em 10 s.
    const depois = await cache.getObject(cacheKey);
    console.log(
      `[cache] logo após o evento: ${JSON.stringify(depois)} ` +
        `→ ${depois === null ? 'INVALIDADO ✓' : 'AINDA PRESENTE ✗'}`,
    );

    console.log('\n[aguardando 14 s a reconciliação coalescida do período corrente...]\n');
    await sleep(14_000);
  } finally {
    await restore();
    // A restauração dispara OUTRO evento, e a reconciliação dele é coalescida
    // em 10 s. Fechar o app antes disso derruba o Prisma no meio da consulta do
    // listener e produz um "Response from the Engine was empty" que parece bug
    // de produção e não é — é este script encerrando cedo demais.
    console.log('\n[aguardando a reconciliação da restauração antes de encerrar...]\n');
    await sleep(14_000);
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    log.error('Falha no smoke test', err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
