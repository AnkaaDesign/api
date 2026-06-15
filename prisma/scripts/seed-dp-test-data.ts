/**
 * Departamento Pessoal — test data seed (June 2026)
 *
 * 1. Benefits: Vale Transporte / Vale Alimentação / Vale Refeição / Plano de
 *    Saúde (upsert by unique name).
 * 2. Adesões (UserBenefit) for every non-DISMISSED user:
 *    - VT for ~70% of users (deterministic per user id), 6% discount,
 *      monthlyValue = R$5,50 × 2 passagens × dias úteis (20–24, deterministic);
 *    - VA OR VR for every user (value/discount from the benefit defaults);
 *    - Plano de Saúde for a deterministic subset, R$125,00 fixed discount.
 *    Skips users that already have an ACTIVE enrollment for the benefit.
 * 3. UserPositionHistory backfill from ChangeLog (entityType USER, field
 *    'positionId', chronological per user): ADMISSION row at exp1StartAt
 *    (createdAt fallback) + one row per historical change (PROMOTION /
 *    DEMOTION by current position remuneration, else TRANSFER), endedAt
 *    chains closed, final row open-ended matching user.positionId.
 *    Skips users that already have history rows.
 *
 * Deterministic (FNV-1a hash of user id — no Math.random), idempotent,
 * safe to re-run. Never deletes data.
 *
 * Run: npx tsx prisma/scripts/seed-dp-test-data.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Deterministic hash (FNV-1a 32-bit) ──────────────────────────────────────
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ChangeLog oldValue/newValue may be stored as plain ids or JSON-encoded
// strings ("\"uuid\""); normalize both to a plain id (or null).
function parseChangeLogId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let v: unknown = value;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed.startsWith('"') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        v = JSON.parse(trimmed);
      } catch {
        v = trimmed;
      }
    } else {
      v = trimmed;
    }
  }
  if (typeof v !== 'string' || v.length === 0 || v === 'null') return null;
  return v;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Benefit registry ────────────────────────────────────────────────────────
const BENEFITS = [
  {
    name: 'Vale Transporte',
    kind: 'TRANSPORT_VOUCHER',
    provider: 'VB Transporte',
    defaultValue: null as number | null,
    defaultEmployeeDiscountPercent: 6,
    notes: 'Desconto do colaborador limitado a 6% do salário (CLT / Decreto 95.247/87).',
  },
  {
    name: 'Vale Alimentação',
    kind: 'FOOD_VOUCHER',
    provider: 'Alelo',
    defaultValue: 440.0,
    defaultEmployeeDiscountPercent: 10,
    notes: 'Desconto do colaborador limitado a 20% do custo (PAT).',
  },
  {
    name: 'Vale Refeição',
    kind: 'MEAL_VOUCHER',
    provider: 'VR Benefícios',
    defaultValue: 330.0,
    defaultEmployeeDiscountPercent: 15,
    notes: 'Desconto do colaborador limitado a 20% do custo (PAT).',
  },
  {
    name: 'Plano de Saúde',
    kind: 'HEALTH_PLAN',
    provider: 'Unimed',
    defaultValue: 250.0,
    defaultEmployeeDiscountPercent: null as number | null,
    notes: 'Coparticipação do colaborador definida por adesão.',
  },
] as const;

async function main() {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  SEED: Departamento Pessoal — dados de teste');
  console.log('══════════════════════════════════════════════════════════');

  const summary = {
    benefitsCreated: 0,
    benefitsExisting: 0,
    enrollmentsCreated: 0,
    enrollmentsSkipped: 0,
    historyUsersBackfilled: 0,
    historyRowsCreated: 0,
    historyUsersSkipped: 0,
  };

  // ── 1. Benefits (upsert by unique name) ────────────────────────────────────
  console.log('\n  Benefícios:');
  const benefitByName = new Map<string, { id: string; kind: string; defaultValue: number | null; defaultEmployeeDiscountPercent: number | null }>();

  for (const b of BENEFITS) {
    const existing = await prisma.benefit.findUnique({ where: { name: b.name } });
    if (existing) {
      benefitByName.set(b.name, existing as any);
      summary.benefitsExisting++;
      console.log(`  ⤳ ${b.name} — já existe`);
    } else {
      const created = await prisma.benefit.create({
        data: {
          name: b.name,
          kind: b.kind as any,
          provider: b.provider,
          defaultValue: b.defaultValue,
          defaultEmployeeDiscountPercent: b.defaultEmployeeDiscountPercent,
          isActive: true,
          notes: b.notes,
        },
      });
      benefitByName.set(b.name, created as any);
      summary.benefitsCreated++;
      console.log(`  ＋ ${b.name} — criado`);
    }
  }

  // ── 2. Adesões para usuários não-desligados ────────────────────────────────
  console.log('\n  Adesões (UserBenefit):');

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  console.log(`  ${users.length} colaboradores ativos (isActive = true)`);

  // Existing ACTIVE enrollments → idempotency set "userId:benefitId"
  const existingActive = await prisma.userBenefit.findMany({
    where: { status: 'ACTIVE' as any },
    select: { userId: true, benefitId: true },
  });
  const activeSet = new Set(existingActive.map(e => `${e.userId}:${e.benefitId}`));

  const startDate = new Date();
  startDate.setDate(1);
  startDate.setHours(0, 0, 0, 0);

  const vt = benefitByName.get('Vale Transporte')!;
  const va = benefitByName.get('Vale Alimentação')!;
  const vr = benefitByName.get('Vale Refeição')!;
  const ps = benefitByName.get('Plano de Saúde')!;

  type EnrollmentPlan = {
    benefitId: string;
    monthlyValue: number;
    employeeDiscountValue: number | null;
    employeeDiscountPercent: number | null;
    dailyTickets: number | null;
  };

  for (const user of users) {
    const hash = fnv1a(user.id);
    const plans: EnrollmentPlan[] = [];

    // VT for ~70% of users — fare R$5,50 × 2 tickets/day × 20–24 working days
    // (base 22 → R$242,00, deterministic ±variation per user).
    if (hash % 10 < 7) {
      const workingDays = 20 + ((hash >>> 3) % 5); // 20..24
      plans.push({
        benefitId: vt.id,
        monthlyValue: Math.round(5.5 * 2 * workingDays * 100) / 100,
        employeeDiscountValue: null,
        employeeDiscountPercent: 6,
        dailyTickets: 2,
      });
    }

    // VA OR VR for every user (defaults from the benefit).
    const food = (hash >>> 5) % 2 === 0 ? va : vr;
    plans.push({
      benefitId: food.id,
      monthlyValue: food.defaultValue ?? 0,
      employeeDiscountValue: null,
      employeeDiscountPercent: food.defaultEmployeeDiscountPercent ?? null,
      dailyTickets: null,
    });

    // Plano de Saúde for a deterministic subset (~11%), fixed R$125,00 discount.
    if (hash % 9 === 0) {
      plans.push({
        benefitId: ps.id,
        monthlyValue: ps.defaultValue ?? 250,
        employeeDiscountValue: 125.0,
        employeeDiscountPercent: null,
        dailyTickets: null,
      });
    }

    for (const plan of plans) {
      const key = `${user.id}:${plan.benefitId}`;
      if (activeSet.has(key)) {
        summary.enrollmentsSkipped++;
        continue;
      }
      await prisma.userBenefit.create({
        data: {
          userId: user.id,
          benefitId: plan.benefitId,
          status: 'ACTIVE' as any,
          statusOrder: 1,
          startDate,
          monthlyValue: plan.monthlyValue,
          employeeDiscountValue: plan.employeeDiscountValue,
          employeeDiscountPercent: plan.employeeDiscountPercent,
          dailyTickets: plan.dailyTickets,
        },
      });
      activeSet.add(key);
      summary.enrollmentsCreated++;
    }
  }
  console.log(`  ＋ ${summary.enrollmentsCreated} adesões criadas, ${summary.enrollmentsSkipped} já existentes (puladas)`);

  // ── 3. UserPositionHistory backfill from ChangeLog ─────────────────────────
  console.log('\n  Histórico de cargos (UserPositionHistory):');

  // Current remuneration per position (MonetaryValue current-flag pattern).
  const positions = await prisma.position.findMany({
    select: {
      id: true,
      remunerations: {
        where: { current: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { value: true },
      },
    },
  });
  const remunerationByPosition = new Map<string, number | null>(
    positions.map(p => [p.id, p.remunerations[0]?.value ?? null]),
  );
  const positionIds = new Set(positions.map(p => p.id));

  function changeReason(fromId: string | null, toId: string | null): 'PROMOTION' | 'DEMOTION' | 'TRANSFER' {
    const from = fromId ? remunerationByPosition.get(fromId) : null;
    const to = toId ? remunerationByPosition.get(toId) : null;
    if (from !== null && from !== undefined && to !== null && to !== undefined) {
      if (to > from) return 'PROMOTION';
      if (to < from) return 'DEMOTION';
    }
    return 'TRANSFER';
  }

  // Users that already have history rows are skipped (today's user.service
  // hook may have created some).
  const usersWithHistory = await prisma.userPositionHistory.groupBy({ by: ['userId'] });
  const historySet = new Set(usersWithHistory.map(h => h.userId));

  const allUsers = await prisma.user.findMany({
    select: { id: true, name: true, positionId: true, createdAt: true, updatedAt: true },
    orderBy: { name: 'asc' },
  });

  // positionId changelogs, chronological, grouped per user.
  const positionLogs = await prisma.changeLog.findMany({
    where: { entityType: 'USER' as any, field: 'positionId' },
    orderBy: { createdAt: 'asc' },
    select: { entityId: true, oldValue: true, newValue: true, createdAt: true },
  });
  const logsByUser = new Map<string, typeof positionLogs>();
  for (const log of positionLogs) {
    if (!logsByUser.has(log.entityId)) logsByUser.set(log.entityId, []);
    logsByUser.get(log.entityId)!.push(log);
  }
  console.log(`  ${positionLogs.length} alterações de cargo encontradas no ChangeLog`);

  for (const user of allUsers) {
    if (historySet.has(user.id)) {
      summary.historyUsersSkipped++;
      continue;
    }

    const rawLogs = logsByUser.get(user.id) ?? [];
    // Normalize + drop entries whose ids don't resolve to known positions.
    const changes = rawLogs
      .map(log => ({
        from: parseChangeLogId(log.oldValue),
        to: parseChangeLogId(log.newValue),
        at: log.createdAt,
      }))
      .filter(c => {
        const fromOk = c.from === null || (UUID_RE.test(c.from) && positionIds.has(c.from));
        const toOk = c.to === null || (UUID_RE.test(c.to) && positionIds.has(c.to));
        return fromOk && toOk && (c.from !== c.to);
      });

    // Earliest known position: first change's oldValue, else the current one.
    const earliestPosition = changes.length > 0 ? changes[0].from : user.positionId;
    if (earliestPosition === null && changes.length === 0 && user.positionId === null) {
      continue; // nothing to record
    }

    // Admission row starts at exp1StartAt (createdAt fallback), clamped so it
    // never starts after the first recorded change.
    let admissionAt = user.createdAt;
    if (changes.length > 0 && admissionAt > changes[0].at) {
      admissionAt = changes[0].at;
    }

    type Row = {
      positionId: string | null;
      previousPositionId: string | null;
      reason: string;
      startedAt: Date;
      endedAt: Date | null;
    };
    const rows: Row[] = [
      {
        positionId: earliestPosition,
        previousPositionId: null,
        reason: 'ADMISSION',
        startedAt: admissionAt,
        endedAt: null,
      },
    ];

    for (const change of changes) {
      rows.push({
        positionId: change.to,
        previousPositionId: change.from,
        reason: changeReason(change.from, change.to),
        startedAt: change.at,
        endedAt: null,
      });
    }

    // Final row must match the user's current position; append a correction
    // row when the changelog chain drifted from reality.
    const last = rows[rows.length - 1];
    if (last.positionId !== (user.positionId ?? null)) {
      rows.push({
        positionId: user.positionId ?? null,
        previousPositionId: last.positionId,
        reason: changeReason(last.positionId, user.positionId ?? null),
        startedAt: user.updatedAt > last.startedAt ? user.updatedAt : new Date(),
        endedAt: null,
      });
    }

    // Close the endedAt chain (each row ends when the next one starts).
    for (let i = 0; i < rows.length - 1; i++) {
      rows[i].endedAt = rows[i + 1].startedAt;
    }

    await prisma.userPositionHistory.createMany({
      data: rows.map(row => ({
        userId: user.id,
        positionId: row.positionId,
        previousPositionId: row.previousPositionId,
        reason: row.reason as any,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        note: 'Backfill automático (seed-dp-test-data)',
      })),
    });
    summary.historyUsersBackfilled++;
    summary.historyRowsCreated += rows.length;
  }
  console.log(
    `  ＋ ${summary.historyRowsCreated} registros criados para ${summary.historyUsersBackfilled} colaboradores, ${summary.historyUsersSkipped} já tinham histórico (pulados)`,
  );

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  RESUMO');
  console.log(`  Benefícios criados:            ${summary.benefitsCreated} (${summary.benefitsExisting} já existiam)`);
  console.log(`  Adesões criadas:               ${summary.enrollmentsCreated} (${summary.enrollmentsSkipped} puladas)`);
  console.log(`  Históricos de cargo criados:   ${summary.historyRowsCreated} registros / ${summary.historyUsersBackfilled} colaboradores (${summary.historyUsersSkipped} pulados)`);
  console.log('──────────────────────────────────────────────────────────');
  console.log('  Concluído com sucesso.');
  console.log('══════════════════════════════════════════════════════════\n');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
