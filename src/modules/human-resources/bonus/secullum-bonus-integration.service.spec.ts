import { Test } from '@nestjs/testing';
import { SecullumBonusIntegrationService } from './secullum-bonus-integration.service';
import { SecullumService } from '@modules/integrations/secullum/secullum.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { CacheService } from '@modules/common/cache/cache.service';

// Fake "today" for deterministic rolling-90-day math.
//   today            = 2026-04-22
//   today - 90 days  = 2026-01-22
//   periodStart      = 2026-03-26 (April/2026 bonus period)
//   periodStart - 1d = 2026-03-25
// Therefore the prior-atestado window is [2026-01-22, 2026-03-25].
const FIXED_NOW = new Date('2026-04-22T12:00:00-03:00').getTime();
const APRIL_2026_PERIOD_START = new Date('2026-03-26T00:00:00-03:00');
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

    it('returns false when no atestado exists in the 90-day window', async () => {
      secullum.getTimeEntriesBySecullumIdCached.mockResolvedValue([]);
      const result = await callPrivate(APRIL_2026_PERIOD_START);
      expect(result).toBe(false);
      expect(cache.set).toHaveBeenCalledWith(
        `bonus:atestado-90d:${EMP_ID}:2026-03-26`,
        false,
        43200,
      );
    });

    it('returns true when an ATESTADO tag appears in any entry in the window', async () => {
      secullum.getTimeEntriesBySecullumIdCached.mockResolvedValue([
        { Data: '2026-03-08', Entrada1: '08:00', Saida1: '12:00' },
        { Data: '2026-03-09', Entrada1: 'ATESTADO', Saida1: 'ATESTADO' },
      ]);
      const result = await callPrivate(APRIL_2026_PERIOD_START);
      expect(result).toBe(true);
      expect(cache.set).toHaveBeenCalledWith(
        `bonus:atestado-90d:${EMP_ID}:2026-03-26`,
        true,
        43200,
      );
    });

    it('queries Secullum for exactly [today-90d, periodStart-1d]', async () => {
      secullum.getTimeEntriesBySecullumIdCached.mockResolvedValue([]);
      await callPrivate(APRIL_2026_PERIOD_START);
      expect(secullum.getTimeEntriesBySecullumIdCached).toHaveBeenCalledWith(
        EMP_ID,
        '2026-01-22',
        '2026-03-25',
      );
    });

    it('detects atestado tag on lowercase field variants', async () => {
      secullum.getTimeEntriesBySecullumIdCached.mockResolvedValue([
        { Data: '2026-02-14', entrada2: 'Atestado 14:00' },
      ]);
      const result = await callPrivate(APRIL_2026_PERIOD_START);
      expect(result).toBe(true);
    });

    it('fails safe (returns true, no forgiveness) when Secullum throws', async () => {
      secullum.getTimeEntriesBySecullumIdCached.mockRejectedValue(new Error('Secullum down'));
      const result = await callPrivate(APRIL_2026_PERIOD_START);
      expect(result).toBe(true);
    });

    it('uses the Redis memoization on repeated calls (no second Secullum fetch)', async () => {
      // First call: cache miss → Secullum fetch → cache write.
      cache.get.mockResolvedValueOnce(null);
      secullum.getTimeEntriesBySecullumIdCached.mockResolvedValue([]);
      await callPrivate(APRIL_2026_PERIOD_START);
      expect(secullum.getTimeEntriesBySecullumIdCached).toHaveBeenCalledTimes(1);

      // Second call: cache hit (returns the memoized false).
      cache.get.mockResolvedValueOnce(false as unknown as null);
      const result2 = await callPrivate(APRIL_2026_PERIOD_START);
      expect(result2).toBe(false);
      expect(secullum.getTimeEntriesBySecullumIdCached).toHaveBeenCalledTimes(1);
    });

    it('returns true (no forgiveness) when the window is empty/invalid', async () => {
      // periodStart more than 90 days in the past relative to today → inverted window.
      const ancientPeriodStart = new Date('2025-01-01T00:00:00-03:00');
      const result = await callPrivate(ancientPeriodStart);
      expect(result).toBe(true);
      // No Secullum call should be made for an invalid window.
      expect(secullum.getTimeEntriesBySecullumIdCached).not.toHaveBeenCalled();
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
