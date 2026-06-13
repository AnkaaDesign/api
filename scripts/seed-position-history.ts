/**
 * Seed: UserPositionHistory backfill + sample promotions + one historical
 * SalaryAdjustment (Área Andressa / Departamento Pessoal — a4-reajustes).
 *
 * What it does (all steps idempotent — safe to re-run):
 *
 * 1. BACKFILL — for every user that has a positionId and ZERO
 *    UserPositionHistory rows, creates one open ADMISSION row.
 *    Admission date preference: exp1StartAt (real hire date) >>
 *    effectedAt >> user.createdAt (LAST resort — createdAt is when the
 *    row was inserted in the system, not when the person was hired).
 *
 * 1b. REPAIR — for ADMISSION rows previously created by this script
 *    (guarded by the note marker 'Seed: registro de admissão (backfill)'),
 *    re-computes the preferred admission date and updates startedAt when
 *    it differs (day precision). Idempotent; never touches rows created
 *    by the application or the synthesized sample rows.
 *
 * 2. SAMPLE PROMOTIONS — picks 4 deterministic users (active, with position,
 *    ordered by name/id) and synthesizes a realistic prior history:
 *    an earlier position row (endedAt set) + the current open row with reason
 *    PROMOTION, 6–18 months apart, pt-BR notes. The users' CURRENT positionId
 *    is NEVER changed. Users that already have a PROMOTION row (or more than
 *    one history row) are skipped.
 *
 * 3. HISTORICAL SALARY ADJUSTMENT — if positions have MonetaryValue history
 *    (> 1 value), derives one SalaryAdjustment from the most recent change
 *    date (items previous→new per position). Otherwise synthesizes one
 *    DISSIDIO_CCT 4.5% record dated 2026-01-01 with items back-computed from
 *    the current values (note "Seed: dissídio 2026"). Never touches
 *    MonetaryValue rows — it only records history. Skipped if any
 *    SalaryAdjustment already exists.
 *
 * Usage (DO NOT run while the DB is being restored):
 *   cd api && npx ts-node -r tsconfig-paths/register scripts/seed-position-history.ts
 *   # preview only (no writes):
 *   cd api && npx ts-node -r tsconfig-paths/register scripts/seed-position-history.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');

const BACKFILL_NOTE_MARKER = 'Seed: registro de admissão (backfill)';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface AdmissionDateSource {
  exp1StartAt: Date | null;
  effectedAt: Date | null;
  createdAt: Date;
}

/**
 * Preferred admission date: exp1StartAt (start of the first experience
 * period = real hire date) >> effectedAt >> createdAt LAST (system row
 * insertion date — almost never the real admission date).
 */
function preferredAdmissionDate(user: AdmissionDateSource): { date: Date; source: string } {
  if (user.exp1StartAt) return { date: user.exp1StartAt, source: 'exp1StartAt' };
  if (user.effectedAt) return { date: user.effectedAt, source: 'effectedAt' };
  return { date: user.createdAt, source: 'createdAt (último recurso)' };
}

function monthsAgo(months: number, from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  d.setMonth(d.getMonth() - months);
  return d;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function backfillAdmissions(): Promise<number> {
  const users = await prisma.user.findMany({
    where: {
      positionId: { not: null },
      positionHistories: { none: {} },
    },
    select: { id: true, name: true, positionId: true, exp1StartAt: true, effectedAt: true, createdAt: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });

  let created = 0;
  for (const user of users) {
    const { date, source } = preferredAdmissionDate(user);
    if (DRY_RUN) {
      console.log(`  [dry-run] criaria ADMISSION para ${user.name}: startedAt=${dayKey(date)} (fonte: ${source})`);
      created++;
      continue;
    }
    await prisma.userPositionHistory.create({
      data: {
        userId: user.id,
        positionId: user.positionId,
        previousPositionId: null,
        reason: 'ADMISSION',
        startedAt: date,
        endedAt: null,
        note: BACKFILL_NOTE_MARKER,
        changedById: null,
      },
    });
    created++;
  }

  console.log(
    `[1/4] Backfill${DRY_RUN ? ' (dry-run)' : ''}: ${created} registro(s) ADMISSION ${DRY_RUN ? 'seriam criados' : 'criado(s)'} (${users.length} usuário(s) sem histórico).`,
  );
  return created;
}

/**
 * REPAIR — re-aligns startedAt of ADMISSION rows previously created by this
 * script (note marker guard) with the preferred admission date. Idempotent:
 * rows already on the preferred date are skipped.
 */
async function repairBackfilledAdmissions(): Promise<number> {
  const rows = await prisma.userPositionHistory.findMany({
    where: { reason: 'ADMISSION', note: BACKFILL_NOTE_MARKER },
    select: {
      id: true,
      startedAt: true,
      user: {
        select: { id: true, name: true, exp1StartAt: true, effectedAt: true, createdAt: true },
      },
    },
    orderBy: { startedAt: 'asc' },
  });

  let repaired = 0;
  for (const row of rows) {
    const { date, source } = preferredAdmissionDate(row.user);
    if (dayKey(row.startedAt) === dayKey(date)) continue; // already correct (day precision)

    console.log(
      `  ${DRY_RUN ? '[dry-run] corrigiria' : 'corrigindo'} ${row.user.name}: startedAt ${dayKey(row.startedAt)} -> ${dayKey(date)} (fonte: ${source})`,
    );
    if (!DRY_RUN) {
      await prisma.userPositionHistory.update({
        where: { id: row.id },
        data: { startedAt: date },
      });
    }
    repaired++;
  }

  console.log(
    `[2/4] Reparo${DRY_RUN ? ' (dry-run)' : ''}: ${repaired} de ${rows.length} registro(s) de backfill ${DRY_RUN ? 'seriam corrigidos' : 'corrigido(s)'}.`,
  );
  return repaired;
}

const SAMPLE_NOTES = [
  'Promoção por desempenho',
  'Promoção após avaliação anual',
  'Promoção por mérito — reconhecimento de resultados',
  'Promoção interna — plano de carreira',
];

async function synthesizeSamplePromotions(): Promise<number> {
  // Deterministic candidates: active users with a position, stable ordering.
  const candidates = await prisma.user.findMany({
    where: {
      positionId: { not: null },
      contractKind: { not: 'DISMISSED' },
    },
    select: { id: true, name: true, positionId: true, exp1StartAt: true, effectedAt: true, createdAt: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 12, // headroom: some may be skipped
  });

  const positions = await prisma.position.findMany({
    select: { id: true, name: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });

  if (positions.length < 2) {
    console.log('[3/4] Amostras: pulado — menos de 2 cargos cadastrados.');
    return 0;
  }

  let synthesized = 0;
  let sampleIndex = 0;

  for (const user of candidates) {
    if (synthesized >= 4) break;

    const rows = await prisma.userPositionHistory.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: 'asc' },
    });

    // Idempotency / safety: only touch users whose history is exactly the
    // single backfilled (or naturally created) ADMISSION row, still open,
    // pointing at the current position.
    const hasPromotion = rows.some(r => r.reason === 'PROMOTION');
    if (hasPromotion || rows.length !== 1) continue;
    const admission = rows[0];
    if (admission.reason !== 'ADMISSION' || admission.endedAt !== null) continue;
    if (admission.positionId !== user.positionId) continue;

    // Deterministic prior position: the next position (by name) after the
    // current one, wrapping around — always different from the current.
    const currentIdx = positions.findIndex(p => p.id === user.positionId);
    const prior = positions[(Math.max(currentIdx, 0) + 1) % positions.length];
    if (!prior || prior.id === user.positionId) continue;

    // 6 / 10 / 14 / 18 months ago, deterministic per sample slot.
    const promotionDate = monthsAgo(6 + sampleIndex * 4);
    const baseAdmission = preferredAdmissionDate(user).date;
    // Earlier row must start before the promotion (at least ~12 months).
    const earlierStart =
      baseAdmission.getTime() < promotionDate.getTime() - 360 * MS_PER_DAY
        ? baseAdmission
        : monthsAgo(12, promotionDate);

    if (DRY_RUN) {
      console.log(
        `  [dry-run] sintetizaria para ${user.name}: ${prior.name} -> (cargo atual) em ${dayKey(promotionDate)} (PROMOTION)`,
      );
      synthesized++;
      sampleIndex++;
      continue;
    }

    await prisma.$transaction([
      // Rewrite the admission row as the earlier (closed) position row.
      prisma.userPositionHistory.update({
        where: { id: admission.id },
        data: {
          positionId: prior.id,
          previousPositionId: null,
          reason: 'ADMISSION',
          startedAt: earlierStart,
          endedAt: promotionDate,
          note: 'Seed: admissão (histórico sintetizado para testes)',
        },
      }),
      // Current open row — PROMOTION into the user's REAL current position.
      prisma.userPositionHistory.create({
        data: {
          userId: user.id,
          positionId: user.positionId,
          previousPositionId: prior.id,
          reason: 'PROMOTION',
          startedAt: promotionDate,
          endedAt: null,
          note: `Seed: ${SAMPLE_NOTES[sampleIndex % SAMPLE_NOTES.length]}`,
          changedById: null,
        },
      }),
    ]);

    console.log(
      `  - ${user.name}: ${prior.name} -> (cargo atual) em ${dayKey(promotionDate)} (PROMOTION)`,
    );
    synthesized++;
    sampleIndex++;
  }

  console.log(`[3/4] Amostras${DRY_RUN ? ' (dry-run)' : ''}: ${synthesized} promoção(ões) ${DRY_RUN ? 'seriam sintetizadas' : 'sintetizada(s)'}.`);
  return synthesized;
}

async function seedHistoricalSalaryAdjustment(): Promise<void> {
  const existing = await prisma.salaryAdjustment.count();
  if (existing > 0) {
    console.log(`[4/4] Reajuste histórico: pulado — já existe(m) ${existing} SalaryAdjustment(s).`);
    return;
  }

  // Try to DERIVE from MonetaryValue history: positions with > 1 value.
  const positions = await prisma.position.findMany({
    select: {
      id: true,
      name: true,
      remunerations: {
        select: { id: true, value: true, current: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });

  type DerivedItem = { positionId: string; previousValue: number; newValue: number; date: Date };
  const transitions: DerivedItem[] = [];

  for (const position of positions) {
    const values = position.remunerations;
    for (let i = 1; i < values.length; i++) {
      transitions.push({
        positionId: position.id,
        previousValue: values[i - 1].value,
        newValue: values[i].value,
        date: values[i].createdAt,
      });
    }
  }

  if (transitions.length > 0) {
    // Group by day; use the most recent day with the most transitions.
    const byDay = new Map<string, DerivedItem[]>();
    for (const t of transitions) {
      const key = dayKey(t.date);
      const bucket = byDay.get(key) ?? [];
      bucket.push(t);
      byDay.set(key, bucket);
    }

    const bestDay = [...byDay.entries()].sort(
      (a, b) => b[1].length - a[1].length || b[0].localeCompare(a[0]),
    )[0];
    const [, items] = bestDay;

    // Uniform percentage? (all items within 0.01 p.p.)
    const pcts = items
      .filter(i => i.previousValue > 0)
      .map(i => ((i.newValue - i.previousValue) / i.previousValue) * 100);
    const uniform =
      pcts.length === items.length &&
      pcts.length > 0 &&
      Math.max(...pcts) - Math.min(...pcts) < 0.01;
    const percentage = uniform ? Math.round(pcts[0] * 100) / 100 : null;

    if (DRY_RUN) {
      console.log(
        `[4/4] Reajuste histórico (dry-run): DERIVADO seria criado — ${items.length} item(ns), ` +
          `percentual ${percentage !== null ? `${percentage}%` : 'personalizado'}, data ${dayKey(items[0].date)}.`,
      );
      return;
    }

    const created = await prisma.salaryAdjustment.create({
      data: {
        type: 'OTHER',
        percentage,
        effectiveDate: items[0].date,
        note: 'Seed: reajuste derivado do histórico de remunerações dos cargos',
        appliedById: null,
        items: {
          create: items.map(i => ({
            positionId: i.positionId,
            previousValue: i.previousValue,
            newValue: i.newValue,
          })),
        },
      },
    });

    console.log(
      `[4/4] Reajuste histórico DERIVADO criado (${created.id}): ${items.length} item(ns), ` +
        `percentual ${percentage !== null ? `${percentage}%` : 'personalizado'}, data ${dayKey(items[0].date)}.`,
    );
    return;
  }

  // SYNTHESIZE: DISSIDIO_CCT 4.5% dated 2026-01-01, back-computed from current values.
  const PCT = 4.5;
  const itemsData = positions
    .map(position => {
      const current = position.remunerations.find(v => v.current) ?? position.remunerations.at(-1);
      if (!current || current.value <= 0) return null;
      const previousValue = Math.round((current.value / (1 + PCT / 100)) * 100) / 100;
      return { positionId: position.id, previousValue, newValue: current.value };
    })
    .filter((i): i is NonNullable<typeof i> => i !== null);

  if (itemsData.length === 0) {
    console.log('[4/4] Reajuste histórico: pulado — nenhum cargo com remuneração definida.');
    return;
  }

  if (DRY_RUN) {
    console.log(`[4/4] Reajuste histórico (dry-run): SINTETIZADO seria criado — DISSIDIO_CCT ${PCT}%, ${itemsData.length} item(ns), data 2026-01-01.`);
    return;
  }

  const created = await prisma.salaryAdjustment.create({
    data: {
      type: 'DISSIDIO_CCT',
      percentage: PCT,
      effectiveDate: new Date('2026-01-01T12:00:00.000Z'),
      note: 'Seed: dissídio 2026',
      appliedById: null,
      items: { create: itemsData },
    },
  });

  console.log(
    `[4/4] Reajuste histórico SINTETIZADO criado (${created.id}): DISSIDIO_CCT ${PCT}%, ` +
      `${itemsData.length} item(ns), data 2026-01-01.`,
  );
}

async function main(): Promise<void> {
  console.log(`Seed position-history — início${DRY_RUN ? ' (DRY-RUN: nenhuma escrita será feita)' : ''}`);
  await backfillAdmissions();
  await repairBackfilledAdmissions();
  await synthesizeSamplePromotions();
  await seedHistoricalSalaryAdjustment();
  console.log('Seed position-history — concluído');
}

main()
  .catch(error => {
    console.error('Seed position-history falhou:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
