// user-position-history.service.spec.ts
// Tests for the historical salary resolver getUserSalaryAt / getUsersSalaryAt (Part F).
//
// Scenario (Kennedy-like): a worker who:
//   - held cargo A (Junior) from 2024-01-01, with MonetaryValue 2000 (effective 2024-01-01)
//     then a reajuste to 2200 (effective 2025-01-01)
//   - was PROMOTED to cargo B (Pleno) on 2025-06-15, MonetaryValue 3000 (effective 2025-06-15)
//     then a reajuste to 3300 (effective 2026-01-01)
//
// The resolver must return the salary the user HAD at the queried date, honoring
// both the position-history window AND the MonetaryValue effectiveDate boundary.

import { UserPositionHistoryService } from './user-position-history.service';

const PROMO_DATE = new Date('2025-06-15T00:00:00.000Z');

const positions = [
  { id: 'posA', name: 'Junior' },
  { id: 'posB', name: 'Pleno' },
];

// UserPositionHistory windows (one open at the end).
const history = [
  {
    userId: 'u1',
    positionId: 'posA',
    startedAt: new Date('2024-01-01T00:00:00.000Z'),
    endedAt: PROMO_DATE,
  },
  {
    userId: 'u1',
    positionId: 'posB',
    startedAt: PROMO_DATE,
    endedAt: null,
  },
];

// MonetaryValue rows (effectiveDate-dated).
const monetary = [
  { positionId: 'posA', value: 2000, effectiveDate: new Date('2024-01-01T00:00:00.000Z') },
  { positionId: 'posA', value: 2200, effectiveDate: new Date('2025-01-01T00:00:00.000Z') },
  { positionId: 'posB', value: 3000, effectiveDate: new Date('2025-06-15T00:00:00.000Z') },
  { positionId: 'posB', value: 3300, effectiveDate: new Date('2026-01-01T00:00:00.000Z') },
];

const users = [{ id: 'u1', positionId: 'posB', createdAt: new Date('2024-01-01T00:00:00.000Z') }];

function buildPrismaMock() {
  return {
    userPositionHistory: {
      findMany: async ({ where, orderBy }: any) => {
        const date: Date = where.startedAt.lte;
        const ids: string[] = where.userId.in;
        let rows = history.filter(
          h =>
            ids.includes(h.userId) &&
            h.startedAt <= date &&
            (h.endedAt === null || h.endedAt > date),
        );
        // orderBy startedAt desc
        rows = [...rows].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
        return rows.map(r => ({ userId: r.userId, positionId: r.positionId, startedAt: r.startedAt }));
      },
      groupBy: async ({ where }: any) => {
        const ids: string[] = where.userId.in;
        const present = new Set(history.filter(h => ids.includes(h.userId)).map(h => h.userId));
        return Array.from(present).map(userId => ({ userId, _count: { _all: 1 } }));
      },
    },
    user: {
      findMany: async ({ where }: any) => {
        const ids: string[] = where.id.in;
        return users
          .filter(u => ids.includes(u.id))
          .map(u => ({ id: u.id, positionId: u.positionId, createdAt: u.createdAt }));
      },
    },
    monetaryValue: {
      findMany: async ({ where, orderBy }: any) => {
        const date: Date = where.effectiveDate.lte;
        const ids: string[] = where.positionId.in;
        let rows = monetary.filter(m => ids.includes(m.positionId) && m.effectiveDate <= date);
        rows = [...rows].sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime());
        return rows.map(r => ({
          positionId: r.positionId,
          value: r.value,
          effectiveDate: r.effectiveDate,
        }));
      },
    },
    position: {
      findMany: async ({ where }: any) => {
        const ids: string[] = where.id.in;
        return positions.filter(p => ids.includes(p.id));
      },
    },
  } as any;
}

describe('UserPositionHistoryService.getUserSalaryAt (historical salary resolver)', () => {
  const service = new UserPositionHistoryService(buildPrismaMock(), {} as any);

  it('resolves the early salary (cargo A, first MonetaryValue)', async () => {
    const r = await service.getUserSalaryAt('u1', new Date('2024-06-01T00:00:00.000Z'));
    expect(r.positionId).toBe('posA');
    expect(r.positionName).toBe('Junior');
    expect(r.salary).toBe(2000);
    expect(r.source).toBe('HISTORY');
  });

  it('honors the reajuste boundary within the same cargo (2200 after 2025-01-01)', async () => {
    const before = await service.getUserSalaryAt('u1', new Date('2024-12-31T00:00:00.000Z'));
    expect(before.salary).toBe(2000);
    const after = await service.getUserSalaryAt('u1', new Date('2025-02-01T00:00:00.000Z'));
    expect(after.positionId).toBe('posA');
    expect(after.salary).toBe(2200);
  });

  it('mid-year promotion boundary: day before promotion = cargo A', async () => {
    const r = await service.getUserSalaryAt('u1', new Date('2025-06-14T00:00:00.000Z'));
    expect(r.positionId).toBe('posA');
    expect(r.salary).toBe(2200);
  });

  it('mid-year promotion boundary: on/after promotion = cargo B', async () => {
    const onDay = await service.getUserSalaryAt('u1', PROMO_DATE);
    expect(onDay.positionId).toBe('posB');
    expect(onDay.salary).toBe(3000);
    expect(onDay.positionName).toBe('Pleno');
  });

  it('resolves the latest reajuste on cargo B (3300 after 2026-01-01)', async () => {
    const r = await service.getUserSalaryAt('u1', new Date('2026-03-01T00:00:00.000Z'));
    expect(r.positionId).toBe('posB');
    expect(r.salary).toBe(3300);
  });

  it('returns NONE for a date before the first history row', async () => {
    const r = await service.getUserSalaryAt('u1', new Date('2023-01-01T00:00:00.000Z'));
    expect(r.salary).toBeNull();
    expect(r.source).toBe('NONE');
    expect(r.reason).toContain('anterior');
  });

  it('batch variant resolves multiple dates consistently', async () => {
    const map = await service.getUsersSalaryAt(['u1'], new Date('2025-06-14T00:00:00.000Z'));
    expect(map.get('u1')?.salary).toBe(2200);
  });
});
