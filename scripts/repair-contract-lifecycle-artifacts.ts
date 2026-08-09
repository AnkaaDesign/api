/**
 * repair-contract-lifecycle-artifacts.ts
 *
 * Três resíduos de bugs de ciclo de vida do vínculo, todos já corrigidos no
 * código. Este script limpa o que ficou gravado.
 *
 * (A) FASE ABERTA EM QUEM FOI DESLIGADO
 *     A demissão não muda a modalidade do contrato, e a rotina que fecha a fase
 *     só disparava em mudança de modalidade — então `closeOpenContractPhase`
 *     nunca era chamada. 5 de 5 desligamentos desde o backfill de fases
 *     (22/06/2026) ficaram com a fase aberta.
 *     Não é cosmético: `BonusEligibilityService` lê "fase aberta iniciada depois
 *     da rescisão" como sinal de readmissão. Enquanto a fase começa ANTES da
 *     rescisão o sinal é falso; basta uma readmissão sobre o mesmo vínculo para
 *     virar um fantasma no divisor.
 *
 * (B) CARGO PROMOVIDO NO CONTRATO
 *     O cron de experiência que "efetivou" 13 desligados em 24/06/2026 escreveu
 *     o cargo promovido em DOIS lugares: `User.positionId` e
 *     `EmploymentContract.positionId`. O reparo anterior só desfez o primeiro.
 *     O segundo é auto-reincidente: `syncUserCurrentContract` espelha o cargo do
 *     contrato de volta no User, então qualquer edição futura desse contrato
 *     RE-PROMOVE a pessoa em silêncio, desfazendo o reparo.
 *
 * (C) HISTÓRICO DE CARGO FANTASMA
 *     O mesmo cron abriu linhas `UserPositionHistory` do tipo PROMOTION, em
 *     aberto, para gente que saiu da empresa anos antes. Para a maioria é o
 *     ÚNICO registro de cargo que existe.
 *
 * Uso:
 *   npx tsx scripts/repair-contract-lifecycle-artifacts.ts           # dry-run
 *   npx tsx scripts/repair-contract-lifecycle-artifacts.ts --apply
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const iso = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : '—');

/** Janela das varreduras que produziram os artefatos. */
const BAD_RUNS = ['2026-06-24', '2026-07-20'];

async function main(): Promise<void> {
  console.log(`\n=== Resíduos de ciclo de vida do vínculo (${APPLY ? 'APLICANDO' : 'DRY-RUN'}) ===\n`);

  // ── (A) fases abertas em vínculos encerrados ──────────────────────────────
  const terminated = await prisma.employmentContract.findMany({
    where: { status: 'TERMINATED', terminationDate: { not: null } },
    select: {
      id: true,
      terminationDate: true,
      user: { select: { name: true } },
      phaseHistory: {
        where: { endDate: null },
        select: { id: true, contractType: true, startDate: true },
      },
    },
  });

  const openPhases = terminated.filter(c => c.phaseHistory.length > 0);

  console.log(`(A) Fases abertas em vínculo encerrado: ${openPhases.length}`);
  for (const c of openPhases) {
    for (const p of c.phaseHistory) {
      // Fase iniciada DEPOIS da rescisão é artefato de automação, não a fase
      // corrente do vínculo: fechá-la na data da rescisão criaria um intervalo
      // invertido (endDate < startDate). Essa é a assinatura do bug de
      // efetivação, tratada em `repair-spurious-effectivation.ts`.
      const inverted = p.startDate > c.terminationDate!;
      console.log(
        `    ${c.user?.name?.padEnd(34)} ${p.contractType} desde ${iso(p.startDate)} ` +
          `→ fechar em ${iso(c.terminationDate)}${inverted ? '   ⚠ INVERTIDO — pulando' : ''}`,
      );
    }
  }

  const closable = openPhases.flatMap(c =>
    c.phaseHistory
      .filter(p => p.startDate <= c.terminationDate!)
      .map(p => ({ phaseId: p.id, endDate: c.terminationDate! })),
  );

  // ── (B) cargo promovido que sobrou no contrato ────────────────────────────
  // ESCOPO ESTREITO, de propósito: só contratos cujo `positionId` ainda é
  // exatamente o cargo que a varredura promoveu — identificado pelo ChangeLog
  // de reversão que `repair-spurious-effectivation.ts` gravou (`oldValue` = o
  // cargo promovido, `newValue` = o cargo verdadeiro).
  //
  // Divergência User↔contrato NÃO é, por si só, sinal de erro: o vínculo CLT
  // encerrado do Kennedy guarda Senior IV enquanto o User dele, hoje PJ, não
  // tem cargo. Realinhar por diferença apagaria história legítima.
  const divergent = await prisma.$queryRaw<
    Array<{ contractId: string; name: string; userPos: string | null; contractPos: string | null }>
  >`
    SELECT ec.id            AS "contractId",
           u.name           AS "name",
           pu.name          AS "userPos",
           pc.name          AS "contractPos"
    FROM "EmploymentContract" ec
    JOIN "User" u        ON u.id = ec."userId"
    LEFT JOIN "Position" pu ON pu.id = u."positionId"
    LEFT JOIN "Position" pc ON pc.id = ec."positionId"
    WHERE ec."positionId" IS DISTINCT FROM u."positionId"
      AND EXISTS (
        SELECT 1 FROM "ChangeLog" cl
        WHERE cl."entityType" = 'USER'
          AND cl."entityId"   = u.id
          AND cl.field        = 'positionId'
          AND cl.metadata->>'script' = 'repair-spurious-effectivation'
          AND trim(both '"' from cl."oldValue"::text) = ec."positionId"
      )
  `;

  console.log(`\n(B) Cargo do contrato divergente do cargo do colaborador: ${divergent.length}`);
  for (const d of divergent) {
    console.log(
      `    ${d.name.padEnd(34)} User: ${(d.userPos ?? '—').padEnd(18)} | Contrato: ${d.contractPos ?? '—'}`,
    );
  }

  // ── (C) histórico de cargo fantasma ───────────────────────────────────────
  // O texto livre fica em `note`; `reason` é enum. O recorte é estreito de
  // propósito: PROMOTION automática da efetivação, aberta, iniciada numa das
  // varreduras defeituosas, para alguém que HOJE está desligado. Um efetivado
  // legítimo (José Moreira, 31/07) fica de fora por estar ACTIVE.
  const ghosts = await prisma.userPositionHistory.findMany({
    where: {
      endedAt: null,
      reason: 'PROMOTION',
      note: { contains: 'efetivação após período de experiência', mode: 'insensitive' },
      startedAt: { gte: new Date(`${BAD_RUNS[0]}T00:00:00.000Z`) },
      user: { currentContractStatus: 'TERMINATED' },
    },
    select: {
      id: true,
      startedAt: true,
      user: { select: { name: true } },
      position: { select: { name: true } },
    },
  });

  console.log(`\n(C) Histórico de cargo aberto para quem já estava desligado: ${ghosts.length}`);
  for (const g of ghosts) {
    console.log(
      `    ${g.user?.name?.padEnd(34)} → ${g.position?.name ?? '—'} em ${iso(g.startedAt)}`,
    );
  }

  console.log(
    `\nResumo: ${closable.length} fase(s) a fechar, ${divergent.length} cargo(s) de contrato a ` +
      `realinhar, ${ghosts.length} linha(s) de histórico a remover.\n`,
  );

  if (!APPLY) {
    console.log('Dry-run. Rode com --apply para gravar.\n');
    return;
  }

  await prisma.$transaction(async tx => {
    for (const c of closable) {
      await tx.contractPhaseHistory.update({
        where: { id: c.phaseId },
        data: { endDate: c.endDate },
      });
    }

    // O cargo do COLABORADOR é a verdade: foi ele que o reparo anterior
    // restaurou a partir do `oldValue` do ChangeLog da varredura.
    for (const d of divergent) {
      const user = await tx.employmentContract.findUnique({
        where: { id: d.contractId },
        select: { user: { select: { positionId: true } } },
      });
      await tx.employmentContract.update({
        where: { id: d.contractId },
        data: { positionId: user?.user.positionId ?? null },
      });
    }

    if (ghosts.length > 0) {
      await tx.userPositionHistory.deleteMany({ where: { id: { in: ghosts.map(g => g.id) } } });
    }
  });

  console.log('Aplicado.\n');
}

main()
  .catch(err => {
    console.error('\nFalhou:', err instanceof Error ? err.stack : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
