/**
 * repair-spurious-effectivation.ts
 *
 * Desfaz as "efetivações" que o cron de período de experiência aplicou sobre
 * vínculos JÁ RESCINDIDOS.
 *
 * O QUE ACONTECEU
 * ---------------
 * `processExperiencePeriodTransitions` filtrava por `isCurrent: true` +
 * `contractType = EXPERIENCE_*`, sem olhar o status. Mas `isCurrent` quer dizer
 * "o vínculo mais recente da pessoa", não "vínculo aberto": quem foi desligado
 * DURANTE a experiência continua `isCurrent` e continua em `EXPERIENCE_*`.
 *
 * Em 24/06/2026 04:00 (e 20/07/2026 para um caso) o cron varreu esses contratos
 * e, para cada um, gravou:
 *   • `contractType` → INDETERMINATE          (efetivação)
 *   • `effectedAt`   → a data da varredura
 *   • uma fase INDETERMINATE ABERTA (endDate null) começando na data da varredura
 *   • `User.performanceLevel` → 3
 *   • `User.positionId` → promovido um nível na hierarquia
 *
 * O efeito visível foi na bonificação: `BonusEligibilityService` lê uma fase
 * aberta iniciada depois da rescisão como readmissão, então 13 pessoas
 * desligadas entre 2022 e 2025 voltaram ao divisor do período com peso 1 —
 * levando o divisor de 07/2026 de 18 para 29 e derrubando o bônus de todo mundo.
 *
 * O QUE ESTE SCRIPT FAZ
 * ---------------------
 * Reconstrói o estado anterior a partir do próprio `ChangeLog` da varredura
 * (nada é adivinhado: `oldValue` é a fonte) e registra a reversão em novos
 * `ChangeLog`, para o histórico não ficar com um salto inexplicado.
 *
 * USO
 *   npx tsx scripts/repair-spurious-effectivation.ts           # dry-run
 *   npx tsx scripts/repair-spurious-effectivation.ts --apply   # grava
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/** Janela em que uma fase e os ChangeLog da MESMA varredura caem. */
const RUN_WINDOW_MS = 5 * 60 * 1000;

const iso = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '—');

/** ChangeLog grava Json; `"EXP_1"` chega com aspas. */
const unquote = (v: unknown): string | null => {
  if (v == null) return null;
  const s = typeof v === 'string' ? v : String(v);
  const t = s.replace(/^"|"$/g, '').trim();
  return t === '' ? null : t;
};

interface Repair {
  userId: string;
  userName: string;
  contractId: string;
  sequence: number;
  terminationDate: Date;
  /** Instante da varredura que corrompeu o vínculo. */
  runAt: Date;
  phaseIdsToDelete: string[];
  contractTypeFrom: string | null;
  contractTypeTo: string | null;
  clearEffectedAt: boolean;
  effectedAtWas: Date | null;
  performanceFrom: number | null;
  performanceTo: number | null;
  positionFrom: string | null;
  positionTo: string | null;
}

async function detect(): Promise<Repair[]> {
  // Vínculos ENCERRADOS com fase aberta iniciada DEPOIS da rescisão — a
  // assinatura exata do estrago. Um vínculo realmente reaberto teria a pessoa
  // com `currentContractStatus = ACTIVE`, então esses ficam de fora.
  const contracts = await prisma.employmentContract.findMany({
    where: {
      status: 'TERMINATED',
      terminationDate: { not: null },
      phaseHistory: { some: { endDate: null } },
    },
    select: {
      id: true,
      sequence: true,
      contractType: true,
      effectedAt: true,
      terminationDate: true,
      userId: true,
      user: { select: { name: true, currentContractStatus: true, performanceLevel: true, positionId: true } },
      phaseHistory: {
        select: { id: true, contractType: true, startDate: true, endDate: true, createdAt: true },
        orderBy: { startDate: 'asc' },
      },
    },
  });

  const repairs: Repair[] = [];

  for (const c of contracts) {
    const openPhase = c.phaseHistory.find(p => p.endDate === null);
    if (!openPhase || !c.terminationDate) continue;
    if (openPhase.startDate <= c.terminationDate) continue;

    if (c.user.currentContractStatus !== 'TERMINATED') {
      console.log(
        `  ~ ${c.user.name}: fase aberta pós-rescisão, mas a pessoa está ` +
          `${c.user.currentContractStatus} hoje — pode ser readmissão real. PULANDO.`,
      );
      continue;
    }

    const runAt = openPhase.createdAt;
    const lo = new Date(runAt.getTime() - RUN_WINDOW_MS);
    const hi = new Date(runAt.getTime() + RUN_WINDOW_MS);

    // Toda fase criada NA MESMA varredura sai junto: a promoção exp1→exp2 do
    // mesmo cron também deixou fases de um dia (start = end = data da varredura).
    const phaseIdsToDelete = c.phaseHistory
      .filter(p => p.createdAt >= lo && p.createdAt <= hi)
      .map(p => p.id);

    const logs = await prisma.changeLog.findMany({
      where: {
        entityType: 'USER',
        entityId: c.userId,
        field: { in: ['currentContractType', 'performanceLevel', 'positionId'] },
        createdAt: { gte: lo, lte: hi },
      },
      select: { field: true, oldValue: true, newValue: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const firstOld = (field: string): string | null => {
      const hit = logs.find(l => l.field === field);
      return hit ? unquote(hit.oldValue) : null;
    };

    const contractTypeTo = firstOld('currentContractType');
    const perfOldRaw = firstOld('performanceLevel');
    const positionTo = firstOld('positionId');

    repairs.push({
      userId: c.userId,
      userName: c.user.name,
      contractId: c.id,
      sequence: c.sequence,
      terminationDate: c.terminationDate,
      runAt,
      phaseIdsToDelete,
      contractTypeFrom: c.contractType,
      contractTypeTo,
      // `effectedAt` só é limpo quando foi carimbado NA varredura — nunca se
      // vier de uma efetivação legítima anterior. A comparação é por DIA, não
      // por instante: o cron grava `today` à meia-noite, e a varredura roda às
      // 04:00, então as duas marcas nunca coincidem no relógio.
      clearEffectedAt: c.effectedAt != null && iso(c.effectedAt) === iso(runAt),
      effectedAtWas: c.effectedAt,
      performanceFrom: c.user.performanceLevel,
      performanceTo: perfOldRaw != null ? Number(perfOldRaw) : null,
      positionFrom: c.user.positionId,
      positionTo,
    });
  }

  return repairs;
}

async function logReversal(
  tx: Prisma.TransactionClient,
  entityId: string,
  field: string,
  oldValue: unknown,
  newValue: unknown,
  reason: string,
): Promise<void> {
  await tx.changeLog.create({
    data: {
      id: randomUUID(),
      entityType: 'USER',
      entityId,
      action: 'UPDATE',
      field,
      oldValue: oldValue as Prisma.InputJsonValue,
      newValue: newValue as Prisma.InputJsonValue,
      reason,
      triggeredBy: 'SYSTEM',
      triggeredById: entityId,
      // userId fica NULL: não há pessoa por trás. Ver ACTOR_SENTINELS em
      // ChangeLogService — 'system' é FK inválida e derruba a transação.
      metadata: { script: 'repair-spurious-effectivation', timestamp: new Date().toISOString() },
    },
  });
}

async function apply(repairs: Repair[]): Promise<void> {
  for (const r of repairs) {
    await prisma.$transaction(async tx => {
      if (r.phaseIdsToDelete.length > 0) {
        await tx.contractPhaseHistory.deleteMany({ where: { id: { in: r.phaseIdsToDelete } } });
      }

      await tx.employmentContract.update({
        where: { id: r.contractId },
        data: {
          ...(r.contractTypeTo
            ? { contractType: r.contractTypeTo as Prisma.EmploymentContractUpdateInput['contractType'] }
            : {}),
          ...(r.clearEffectedAt ? { effectedAt: null } : {}),
        },
      });

      const userData: Prisma.UserUpdateInput = {};
      if (r.contractTypeTo) {
        userData.currentContractType =
          r.contractTypeTo as Prisma.UserUpdateInput['currentContractType'];
      }
      if (r.performanceTo != null && r.performanceTo !== r.performanceFrom) {
        userData.performanceLevel = r.performanceTo;
      }
      if (r.positionTo && r.positionTo !== r.positionFrom) {
        userData.position = { connect: { id: r.positionTo } };
      }
      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id: r.userId }, data: userData });
      }

      const why =
        `Reversão da efetivação automática indevida de ${iso(r.runAt)}: o vínculo já ` +
        `estava rescindido em ${iso(r.terminationDate)} (cron de experiência não filtrava status).`;

      if (r.contractTypeTo && r.contractTypeTo !== r.contractTypeFrom) {
        await logReversal(tx, r.userId, 'currentContractType', r.contractTypeFrom, r.contractTypeTo, why);
      }
      if (r.performanceTo != null && r.performanceTo !== r.performanceFrom) {
        await logReversal(
          tx,
          r.userId,
          'performanceLevel',
          String(r.performanceFrom),
          String(r.performanceTo),
          why,
        );
      }
      if (r.positionTo && r.positionTo !== r.positionFrom) {
        await logReversal(tx, r.userId, 'positionId', r.positionFrom, r.positionTo, why);
      }
    });

    console.log(`  ✔ ${r.userName}`);
  }
}

async function main(): Promise<void> {
  console.log(
    `\n=== Reversão de efetivação sobre vínculo rescindido (${APPLY ? 'APLICANDO' : 'DRY-RUN'}) ===\n`,
  );

  const repairs = await detect();

  if (repairs.length === 0) {
    console.log('Nada a corrigir.\n');
    return;
  }

  for (const r of repairs) {
    console.log(`${r.userName}  (seq ${r.sequence}, rescindido em ${iso(r.terminationDate)})`);
    console.log(`   varredura            : ${r.runAt.toISOString()}`);
    console.log(`   fases a remover      : ${r.phaseIdsToDelete.length}`);
    console.log(`   contractType         : ${r.contractTypeFrom} → ${r.contractTypeTo ?? '(sem ChangeLog — mantido)'}`);
    console.log(`   effectedAt           : ${iso(r.effectedAtWas)} → ${r.clearEffectedAt ? 'null' : '(mantido)'}`);
    console.log(`   performanceLevel     : ${r.performanceFrom} → ${r.performanceTo ?? '(mantido)'}`);
    console.log(
      `   positionId           : ${r.positionFrom ?? '—'} → ${r.positionTo ?? '(mantido)'}`,
    );
    console.log('');
  }

  console.log(`Total: ${repairs.length} vínculo(s).\n`);

  const missing = repairs.filter(r => !r.contractTypeTo);
  if (missing.length > 0) {
    console.log(
      `ATENÇÃO: ${missing.length} sem ChangeLog da varredura — o contractType não será ` +
        `revertido automaticamente: ${missing.map(r => r.userName).join(', ')}\n`,
    );
  }

  if (!APPLY) {
    console.log('Dry-run. Rode com --apply para gravar.\n');
    return;
  }

  await apply(repairs);
  console.log(`\n${repairs.length} vínculo(s) corrigido(s).\n`);
}

main()
  .catch(err => {
    console.error('\nFalhou:', err instanceof Error ? err.stack : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
