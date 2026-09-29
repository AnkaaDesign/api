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
  const service = new UserPositionHistoryService(buildPrismaMock(), {} as any, {
    emit: () => true,
  } as any);

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

// promote — o vínculo aberto precisa receber o cargo NA MESMA transação, e os
// efeitos colaterais (Secullum, bonificação) só podem sair depois do commit.
// Sem o vínculo, `syncUserCurrentContract` devolvia o cargo antigo ao User na
// próxima mexida no vínculo (promoções de 12/08/2026).
describe('UserPositionHistoryService.promote (vínculo + efeitos colaterais)', () => {
  function buildPromoteHarness(contract: { id: string; sequence: number; positionId: string | null } | null) {
    const calls: string[] = [];
    const contractUpdates: any[] = [];
    const contractFindWheres: any[] = [];
    const logs: any[] = [];
    let committed = false;

    const tx: any = {
      user: {
        findUnique: async () => ({
          id: 'u1',
          name: 'Davyd',
          positionId: 'posA',
          position: { id: 'posA', name: 'Junior IV' },
        }),
        update: async () => {
          calls.push('user.update');
        },
      },
      position: {
        findUnique: async () => ({ id: 'posB', name: 'Pleno I' }),
        findMany: async ({ where }: any) =>
          [
            { id: 'posA', name: 'Junior IV' },
            { id: 'posB', name: 'Pleno I' },
          ].filter(p => where.id.in.includes(p.id)),
      },
      employmentContract: {
        findFirst: async ({ where }: any) => {
          contractFindWheres.push(where);
          return contract;
        },
        update: async (args: any) => {
          calls.push('contract.update');
          contractUpdates.push(args);
        },
      },
      userPositionHistory: {
        updateMany: async () => undefined,
        create: async () => ({ id: 'h1', userId: 'u1', positionId: 'posB' }),
      },
    };
    const prisma: any = {
      $transaction: async (fn: any) => {
        const r = await fn(tx);
        committed = true;
        return r;
      },
    };
    const changeLog: any = {
      logChange: async (p: any) => {
        logs.push(p);
      },
    };
    const emitted: Array<{ event: string; payload: any; committed: boolean }> = [];
    const emitter: any = {
      emit: (event: string, payload: any) => {
        emitted.push({ event, payload, committed });
        return true;
      },
    };
    const service = new UserPositionHistoryService(prisma, changeLog, emitter);
    return { service, calls, contractUpdates, contractFindWheres, logs, emitted };
  }

  it('leva o cargo ao vínculo aberto, loga como contractPositionId e emite após o commit', async () => {
    const h = buildPromoteHarness({ id: 'c1', sequence: 1, positionId: 'posA' });
    await h.service.promote({ userId: 'u1', toPositionId: 'posB', reason: 'PROMOTION' } as any, undefined, 'admin');

    expect(h.calls).toEqual(['user.update', 'contract.update']);
    expect(h.contractUpdates[0]).toEqual({ where: { id: 'c1' }, data: { positionId: 'posB' } });
    // Só vínculo NÃO encerrado.
    expect(h.contractFindWheres[0]).toMatchObject({ userId: 'u1', terminationDate: null });
    expect(h.contractFindWheres[0].status).toEqual({ not: 'TERMINATED' });

    const contractLog = h.logs.find(l => l.field === 'contractPositionId');
    expect(contractLog).toMatchObject({ oldValue: 'Junior IV', newValue: 'Pleno I', entityId: 'u1' });
    // O eixo que a bonificação rebobina tem UM registro, com o cargo do USER.
    const positionLogs = h.logs.filter(l => l.field === 'positionId');
    expect(positionLogs).toHaveLength(1);
    expect(positionLogs[0]).toMatchObject({ oldValue: 'posA', newValue: 'posB' });

    const events = h.emitted.map(e => e.event);
    expect(events).toEqual(['secullum.user.updated', 'bonus.eligibility.changed']);
    expect(h.emitted.every(e => e.committed)).toBe(true);
    expect(h.emitted[1].payload).toEqual({ userId: 'u1', reason: 'POSITION_CHANGED' });
  });

  it('sem vínculo aberto (desligado): não toca vínculo nenhum', async () => {
    const h = buildPromoteHarness(null);
    await h.service.promote({ userId: 'u1', toPositionId: 'posB', reason: 'PROMOTION' } as any);
    expect(h.calls).toEqual(['user.update']);
    expect(h.logs.some(l => l.field === 'contractPositionId')).toBe(false);
  });

  it('vínculo já no cargo: não regrava nem loga', async () => {
    const h = buildPromoteHarness({ id: 'c1', sequence: 1, positionId: 'posB' });
    await h.service.promote({ userId: 'u1', toPositionId: 'posB', reason: 'PROMOTION' } as any);
    expect(h.calls).toEqual(['user.update']);
  });
});
