import { Test } from '@nestjs/testing';
import { SecullumBonusIntegrationService } from './secullum-bonus-integration.service';
import { SecullumService } from '@modules/integrations/secullum/secullum.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { CacheService } from '@modules/common/cache/cache.service';

// The prior-justified-absence window is anchored on periodStart (NOT today):
//   periodStart       = 2026-03-26 (April/2026 bonus period)
//   periodStart - 90d = 2025-12-26
//   periodStart - 1d  = 2026-03-25
// Therefore the window is [2025-12-26, 2026-03-25]. FIXED_NOW is kept only for
// determinism of other date math; it no longer affects the window.
const FIXED_NOW = new Date('2026-04-22T12:00:00-03:00').getTime();
const APRIL_2026_PERIOD_START = new Date('2026-03-26T00:00:00-03:00');
const WINDOW_START = '2025-12-26';
const WINDOW_END = '2026-03-25';
const CACHE_KEY = (id: number) => `bonus:atestado-90d:v2:${id}:2026-03-26`;
const EMP_ID = 42;

describe('SecullumBonusIntegrationService', () => {
  let service: SecullumBonusIntegrationService;
  let secullum: jest.Mocked<SecullumService>;
  let cache: jest.Mocked<CacheService>;

  beforeAll(() => {
    jest.useFakeTimers({ now: FIXED_NOW });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(async () => {
    secullum = {
      getEmployees: jest.fn(),
      getHolidays: jest.fn().mockResolvedValue({ success: true, data: [] }),
      getTimeEntriesBySecullumIdCached: jest.fn(),
      getCalculationsBySecullumId: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<SecullumService>;

    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      getObject: jest.fn().mockResolvedValue(null),
      setObject: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CacheService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        SecullumBonusIntegrationService,
        { provide: SecullumService, useValue: secullum },
        { provide: PrismaService, useValue: {} },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = moduleRef.get(SecullumBonusIntegrationService);
  });

  describe('hasAtestadoInPriorNinetyDays (private)', () => {
    const callPrivate = (periodStart: Date) =>
      (
        service as unknown as {
          hasAtestadoInPriorNinetyDays: (id: number, s: Date) => Promise<boolean>;
        }
      ).hasAtestadoInPriorNinetyDays(EMP_ID, periodStart);

    it('returns false (and caches briefly) when no justified absence exists', async () => {
      secullum.getTimeEntriesBySecullumIdCached.mockResolvedValue([]);
      secullum.getCalculationsBySecullumId.mockResolvedValue(null as any);
      const result = await callPrivate(APRIL_2026_PERIOD_START);
      expect(result).toBe(false);
      // Negative verdict cached only 5 min (300s) — a late-entered justification
      // must not stay frozen for 12h. Key is versioned.
      expect(cache.set).toHaveBeenCalledWith(CACHE_KEY(EMP_ID), false, 300);
    });

    it('returns true (12h cache) when an ATESTADO tag appears in /Batidas', async () => {
      secullum.getTimeEntriesBySecullumIdCached.mockResolvedValue([
        { Data: '2026-03-08', Entrada1: '08:00', Saida1: '12:00' },
        { Data: '2026-03-09', Entrada1: 'ATESTADO', Saida1: 'ATESTADO' },
      ]);
      const result = await callPrivate(APRIL_2026_PERIOD_START);
      expect(result).toBe(true);
      expect(cache.set).toHaveBeenCalledWith(CACHE_KEY(EMP_ID), true, 43200);
    });

    it('counts a prior DECLARAÇÃO the same as an atestado', async () => {
      secullum.getTimeEntriesBySecullumIdCached.mockResolvedValue([
        { Data: '2026-02-10', Entrada2: 'DECL', Saida2: 'DECL' },
      ]);
      const result = await callPrivate(APRIL_2026_PERIOD_START);
      expect(result).toBe(true);
    });

    it('detects a FULL-DAY prior atestado via /Calculos when /Batidas is empty', async () => {
      // Full-day atestado returns EMPTY /Batidas stamps but surfaces as "ATESTADO"
      // text in the /Calculos Entrada column.
      secullum.getTimeEntriesBySecullumIdCached.mockResolvedValue([]);
      secullum.getCalculationsBySecullumId.mockResolvedValue({
        Colunas: [{ Nome: 'Data' }, { Nome: 'Entrada1' }, { Nome: 'Carga' }, { Nome: 'Normais' }],
        Totais: ['', '', '', ''],
        Linhas: [['2026-02-10', 'ATESTADO', '08:00', '00:00']],
      } as any);
      const result = await callPrivate(APRIL_2026_PERIOD_START);
      expect(result).toBe(true);
    });

    it('queries Secullum for [periodStart-90d, periodStart-1d]', async () => {
      secullum.getTimeEntriesBySecullumIdCached.mockResolvedValue([]);
      secullum.getCalculationsBySecullumId.mockResolvedValue(null as any);
      await callPrivate(APRIL_2026_PERIOD_START);
      expect(secullum.getTimeEntriesBySecullumIdCached).toHaveBeenCalledWith(
        EMP_ID,
        WINDOW_START,
        WINDOW_END,
      );
    });

    it('detects atestado tag on lowercase field variants', async () => {
      secullum.getTimeEntriesBySecullumIdCached.mockResolvedValue([
        { Data: '2026-02-14', entrada2: 'Atestado 14:00' },
      ]);
      const result = await callPrivate(APRIL_2026_PERIOD_START);
      expect(result).toBe(true);
    });

    it('fails safe (returns true, no forgiveness, no cache) when Secullum throws', async () => {
      secullum.getTimeEntriesBySecullumIdCached.mockRejectedValue(new Error('Secullum down'));
      secullum.getCalculationsBySecullumId.mockResolvedValue(null as any);
      const result = await callPrivate(APRIL_2026_PERIOD_START);
      expect(result).toBe(true);
      // A fetch-failure verdict must NOT be cached (so the next run re-checks).
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('uses the Redis memoization on repeated calls (no second Secullum fetch)', async () => {
      cache.get.mockResolvedValueOnce(null);
      secullum.getTimeEntriesBySecullumIdCached.mockResolvedValue([]);
      secullum.getCalculationsBySecullumId.mockResolvedValue(null as any);
      await callPrivate(APRIL_2026_PERIOD_START);
      expect(secullum.getTimeEntriesBySecullumIdCached).toHaveBeenCalledTimes(1);

      cache.get.mockResolvedValueOnce(false as unknown as null);
      const result2 = await callPrivate(APRIL_2026_PERIOD_START);
      expect(result2).toBe(false);
      expect(secullum.getTimeEntriesBySecullumIdCached).toHaveBeenCalledTimes(1);
    });
  });

  // Tier tables — bônus discount + graded assiduidade loss (hours-based).
  // Mirrors the rule matrix shown in the bonus rules modal (web + mobile).
  describe('absence tier tables', () => {
    const svc = () =>
      service as unknown as {
        getUnjustifiedDiscountPercentage(h: number): number;
        getAtestadoDiscountPercentage(h: number): number;
        getUnjustifiedAssiduidadeLoss(h: number): string;
        getAtestadoAssiduidadeLoss(h: number): string;
      };

    describe('sem justificativa — bônus discount', () => {
      it.each([
        [0, 0],
        [2, 0],
        [2.5, 25],
        [4, 25],
        [6, 50],
        [8, 50],
        [9, 100],
        [40, 100],
      ])('%ph → %s%%', (hours, expected) => {
        expect(svc().getUnjustifiedDiscountPercentage(hours)).toBe(expected);
      });
    });

    describe('sem justificativa — assiduidade loss', () => {
      it.each([
        [0, 'none'],
        [1, 'perde-o-dia'],
        [2, 'perde-o-dia'],
        [3, 'half'],
        [4, 'half'],
        [5, 'full'],
        [10, 'full'],
      ])('%ph → %s', (hours, expected) => {
        expect(svc().getUnjustifiedAssiduidadeLoss(hours)).toBe(expected);
      });
    });

    describe('atestado — bônus discount', () => {
      it.each([
        [0, 0],
        [2, 0],
        [4, 0],
        [5, 25],
        [8, 25],
        [16, 50],
        [25, 50],
        [26, 100],
      ])('%ph → %s%%', (hours, expected) => {
        expect(svc().getAtestadoDiscountPercentage(hours)).toBe(expected);
      });
    });

    describe('atestado — assiduidade loss (até 2h keeps the +1%)', () => {
      it.each([
        [0, 'none'],
        [2, 'none'],
        [3, 'perde-o-dia'],
        [4, 'perde-o-dia'],
        [6, 'half'],
        [8, 'half'],
        [9, 'full'],
        [30, 'full'],
      ])('%ph → %s', (hours, expected) => {
        expect(svc().getAtestadoAssiduidadeLoss(hours)).toBe(expected);
      });
    });
  });
});
