// bonus-calculation.service.spec.ts
//
// Golden-value tests for the salary-based bonus algorithm.
// Reference: bonus-simulator.html — every expected value below was produced
// by running the simulator's exact JavaScript formula in Node and capturing
// the output. If the algorithm is ever changed, these values must be
// regenerated and BONUS_CALCULATION_VERSION must be bumped.

import {
  BonusCalculationService,
  DEFAULT_BONUS_CONFIG,
  PERFORMANCE_MULTIPLIERS,
  BONUS_CALCULATION_VERSION,
} from './bonus-calculation.service';

const POSITIONS = [
  { name: 'Junior I', salary: 2257.67 },
  { name: 'Junior II', salary: 2393.13 },
  { name: 'Junior III', salary: 2536.72 },
  { name: 'Junior IV', salary: 2688.92 },
  { name: 'Pleno I', salary: 2850.26 },
  { name: 'Pleno II', salary: 3021.28 },
  { name: 'Pleno III', salary: 3202.56 },
  { name: 'Pleno IV', salary: 3394.7 },
  { name: 'Senior I', salary: 3572.52 },
  { name: 'Senior II', salary: 3800.55 },
  { name: 'Senior III', salary: 4043.14 },
  { name: 'Senior IV', salary: 4285.73 },
];

const SALARY_RANGE = { min: 2257.67, max: 4285.73 };

// Captured from running bonus-simulator.html JS at:
//   B1 = 4, k = 3.5, x0 = 0.26, piso = 0.075, pscale = 0.40, ceil = 6, adj = 0
// 12 positions × 5 performance levels.
const GOLDEN_B1_4: Record<string, Record<number, number>> = {
  'Junior I': { 1: 45.64, 2: 91.27, 3: 136.91, 4: 159.73, 5: 182.54 },
  'Junior II': { 1: 106.2, 2: 212.41, 3: 318.61, 4: 371.72, 5: 424.82 },
  'Junior III': { 1: 172.53, 2: 345.06, 3: 517.59, 4: 603.86, 5: 690.13 },
  'Junior IV': { 1: 241.76, 2: 483.53, 3: 725.29, 4: 846.17, 5: 967.06 },
  'Pleno I': { 1: 310.51, 2: 621.03, 3: 931.54, 4: 1086.8, 5: 1242.06 },
  'Pleno II': { 1: 375.48, 2: 750.96, 3: 1126.44, 4: 1314.18, 5: 1501.92 },
  'Pleno III': { 1: 434.06, 2: 868.11, 3: 1302.17, 4: 1519.19, 5: 1736.22 },
  'Pleno IV': { 1: 484.67, 2: 969.34, 3: 1454.01, 4: 1696.35, 5: 1938.68 },
  'Senior I': { 1: 522.07, 2: 1044.14, 3: 1566.21, 4: 1827.25, 5: 2088.28 },
  'Senior II': { 1: 559.01, 2: 1118.02, 3: 1677.04, 4: 1956.54, 5: 2236.05 },
  'Senior III': { 1: 587.74, 2: 1175.48, 3: 1763.22, 4: 2057.09, 5: 2350.96 },
  'Senior IV': { 1: 608.48, 2: 1216.96, 3: 1825.44, 4: 2129.68, 5: 2433.92 },
};

describe('BonusCalculationService', () => {
  let service: BonusCalculationService;

  beforeEach(() => {
    service = new BonusCalculationService();
  });

  describe('default-config B1=4 — golden values from HTML simulator', () => {
    for (const position of POSITIONS) {
      for (const perfLevel of [1, 2, 3, 4, 5] as const) {
        it(`${position.name} @ perf ${perfLevel} = R$ ${GOLDEN_B1_4[position.name][perfLevel]}`, () => {
          const result = service.calculate({
            salary: position.salary,
            performanceLevel: perfLevel,
            averageTasksPerUser: 4,
            salaryRange: SALARY_RANGE,
          });
          expect(result.bonus).toBe(GOLDEN_B1_4[position.name][perfLevel]);
        });
      }
    }
  });

  describe('algebraic identities (must hold for any valid config)', () => {
    it('salary = sMin → ratio = piso', () => {
      const r = service.calculate({
        salary: SALARY_RANGE.min,
        performanceLevel: 1,
        averageTasksPerUser: 4,
        salaryRange: SALARY_RANGE,
      });
      expect(r.ratio).toBeCloseTo(DEFAULT_BONUS_CONFIG.piso, 10);
      // Also: bonus = anchor · piso · perfMult(1) = anchor · piso
      expect(r.bonus).toBe(45.64);
    });

    it('salary = sMax → ratio = 1', () => {
      const r = service.calculate({
        salary: SALARY_RANGE.max,
        performanceLevel: 1,
        averageTasksPerUser: 4,
        salaryRange: SALARY_RANGE,
      });
      expect(r.ratio).toBeCloseTo(1, 10);
      // bonus = anchor · 1 · perfMult(1) = anchor (= 608.48)
      expect(r.bonus).toBe(608.48);
    });

    it('Senior IV at perf 1 equals the anchor itself', () => {
      const r = service.calculate({
        salary: 4285.73,
        performanceLevel: 1,
        averageTasksPerUser: 4,
        salaryRange: SALARY_RANGE,
      });
      expect(r.anchor).toBe(608.48);
      expect(r.bonus).toBe(608.48);
    });
  });

  describe('B1 edge cases', () => {
    it('B1 = 0 → bonus = 0 (anchor is negative, clipped)', () => {
      const r = service.calculate({
        salary: 2850,
        performanceLevel: 3,
        averageTasksPerUser: 0,
        salaryRange: SALARY_RANGE,
      });
      expect(r.bonus).toBe(0);
    });

    it('B1 < 0 → bonus = 0', () => {
      const r = service.calculate({
        salary: 2850,
        performanceLevel: 3,
        averageTasksPerUser: -1,
        salaryRange: SALARY_RANGE,
      });
      expect(r.bonus).toBe(0);
    });

    it('B1 > ceil clamps to ceil (B1=10 equals B1=6 with default ceil=6)', () => {
      const at10 = service.calculate({
        salary: 2850,
        performanceLevel: 3,
        averageTasksPerUser: 10,
        salaryRange: SALARY_RANGE,
      });
      const at6 = service.calculate({
        salary: 2850,
        performanceLevel: 3,
        averageTasksPerUser: 6,
        salaryRange: SALARY_RANGE,
      });
      expect(at10.bonus).toBe(at6.bonus);
    });

    it('NaN B1 treated as 0', () => {
      const r = service.calculate({
        salary: 2850,
        performanceLevel: 3,
        averageTasksPerUser: Number.NaN,
        salaryRange: SALARY_RANGE,
      });
      expect(r.bonus).toBe(0);
    });
  });

  describe('performance level handling', () => {
    it.each([0, -1, 6, 99])('performanceLevel %s → bonus = 0', perf => {
      const r = service.calculate({
        salary: 2850,
        performanceLevel: perf,
        averageTasksPerUser: 4,
        salaryRange: SALARY_RANGE,
      });
      expect(r.bonus).toBe(0);
    });

    it('multipliers are exactly {1:1, 2:2, 3:3, 4:3.5, 5:4}', () => {
      expect(PERFORMANCE_MULTIPLIERS[1]).toBe(1.0);
      expect(PERFORMANCE_MULTIPLIERS[2]).toBe(2.0);
      expect(PERFORMANCE_MULTIPLIERS[3]).toBe(3.0);
      expect(PERFORMANCE_MULTIPLIERS[4]).toBe(3.5);
      expect(PERFORMANCE_MULTIPLIERS[5]).toBe(4.0);
    });

    it('perfLevel scales bonus linearly', () => {
      const ref = service.calculate({
        salary: 2850.26, // Pleno I
        performanceLevel: 1,
        averageTasksPerUser: 4,
        salaryRange: SALARY_RANGE,
      });
      const at3 = service.calculate({
        salary: 2850.26,
        performanceLevel: 3,
        averageTasksPerUser: 4,
        salaryRange: SALARY_RANGE,
      });
      // 310.51 * 3 = 931.53 → rounded golden is 931.54 (rounding once at the end)
      expect(at3.bonus).toBe(931.54);
      expect(ref.bonus).toBe(310.51);
    });
  });

  describe('salary edge cases', () => {
    it('salary = 0 → bonus = 0', () => {
      const r = service.calculate({
        salary: 0,
        performanceLevel: 3,
        averageTasksPerUser: 4,
        salaryRange: SALARY_RANGE,
      });
      expect(r.bonus).toBe(0);
    });

    it('salary = -100 → bonus = 0', () => {
      const r = service.calculate({
        salary: -100,
        performanceLevel: 3,
        averageTasksPerUser: 4,
        salaryRange: SALARY_RANGE,
      });
      expect(r.bonus).toBe(0);
    });

    it('NaN salary → bonus = 0', () => {
      const r = service.calculate({
        salary: Number.NaN,
        performanceLevel: 3,
        averageTasksPerUser: 4,
        salaryRange: SALARY_RANGE,
      });
      expect(r.bonus).toBe(0);
    });

    it('single-position pool (sMax = sMin) → ratio = piso', () => {
      const r = service.calculate({
        salary: 3000,
        performanceLevel: 1,
        averageTasksPerUser: 4,
        salaryRange: { min: 3000, max: 3000 },
      });
      expect(r.ratio).toBe(DEFAULT_BONUS_CONFIG.piso);
    });
  });

  describe('config overrides', () => {
    it('adjustment +10% multiplies bonus by exactly 1.10', () => {
      const baseline = service.calculate({
        salary: 3000,
        performanceLevel: 3,
        averageTasksPerUser: 4,
        salaryRange: SALARY_RANGE,
      });
      const adjusted = service.calculate({
        salary: 3000,
        performanceLevel: 3,
        averageTasksPerUser: 4,
        salaryRange: SALARY_RANGE,
        config: { adjustment: 0.1 },
      });
      // Allow 1¢ rounding tolerance
      expect(Math.abs(adjusted.bonus - baseline.bonus * 1.1)).toBeLessThanOrEqual(0.01);
    });

    it('pscale change scales anchor proportionally', () => {
      const at40 = service.calculate({
        salary: 4285.73,
        performanceLevel: 1,
        averageTasksPerUser: 4,
        salaryRange: SALARY_RANGE,
      });
      const at80 = service.calculate({
        salary: 4285.73,
        performanceLevel: 1,
        averageTasksPerUser: 4,
        salaryRange: SALARY_RANGE,
        config: { pscale: 0.8 },
      });
      // pscale doubled → anchor doubles → bonus at sMax (ratio=1) doubles
      expect(at80.bonus).toBeCloseTo(at40.bonus * 2, 1);
    });

    it('config snapshot in breakdown reflects overrides', () => {
      const r = service.calculate({
        salary: 3000,
        performanceLevel: 3,
        averageTasksPerUser: 4,
        salaryRange: SALARY_RANGE,
        config: { k: 5, x0: 0.5 },
      });
      expect(r.config.k).toBe(5);
      expect(r.config.x0).toBe(0.5);
      expect(r.config.piso).toBe(DEFAULT_BONUS_CONFIG.piso);
    });
  });

  describe('breakdown completeness', () => {
    it('returns x in [0, 1] for salaries within range', () => {
      for (const p of POSITIONS) {
        const r = service.calculate({
          salary: p.salary,
          performanceLevel: 3,
          averageTasksPerUser: 4,
          salaryRange: SALARY_RANGE,
        });
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x).toBeLessThanOrEqual(1);
      }
    });

    it('S0 < S1 with default k=3.5, x0=0.26', () => {
      const r = service.calculate({
        salary: 2850,
        performanceLevel: 3,
        averageTasksPerUser: 4,
        salaryRange: SALARY_RANGE,
      });
      expect(r.S0).toBeLessThan(r.S1);
      expect(r.S0).toBeGreaterThan(0);
      expect(r.S1).toBeLessThan(1);
    });

    it('clampedB1 reflects ceil clamping', () => {
      const r = service.calculate({
        salary: 2850,
        performanceLevel: 3,
        averageTasksPerUser: 10,
        salaryRange: SALARY_RANGE,
      });
      expect(r.clampedB1).toBe(DEFAULT_BONUS_CONFIG.ceil);
    });
  });

  describe('calculateMany batch', () => {
    it('returns one result per user, preserving order', () => {
      const results = service.calculateMany(
        POSITIONS.map(p => ({ salary: p.salary, performanceLevel: 3, name: p.name })),
        4,
        SALARY_RANGE,
      );
      expect(results.length).toBe(POSITIONS.length);
      results.forEach((r, i) => {
        expect(r.name).toBe(POSITIONS[i].name);
        expect(r.calculation.bonus).toBe(GOLDEN_B1_4[POSITIONS[i].name][3]);
      });
    });
  });

  describe('Page-2 fixture (16 employees, B1=2.19, custom config)', () => {
    // Captured from running bonus-simulator.html page 2 with k=3.8, x0=0.24,
    // piso=0.12, pscale=0.5, ceil=5.8, adj=+5%
    const fixture = [
      { positionName: 'Junior III', performanceLevel: 3, expected: 86.65 },
      { positionName: 'Junior IV', performanceLevel: 3, expected: 116.68 },
      { positionName: 'Junior I', performanceLevel: 5, expected: 41.89 },
      { positionName: 'Junior II', performanceLevel: 3, expected: 57.73 },
      { positionName: 'Pleno I', performanceLevel: 3, expected: 146.07 },
      { positionName: 'Pleno I', performanceLevel: 3, expected: 146.07 },
      { positionName: 'Pleno I', performanceLevel: 3, expected: 146.07 },
      { positionName: 'Senior III', performanceLevel: 3, expected: 254.79 },
      { positionName: 'Junior I', performanceLevel: 5, expected: 41.89 },
      { positionName: 'Junior IV', performanceLevel: 3, expected: 116.68 },
      { positionName: 'Pleno I', performanceLevel: 3, expected: 146.07 },
      { positionName: 'Pleno I', performanceLevel: 3, expected: 146.07 },
      { positionName: 'Pleno IV', performanceLevel: 3, expected: 216.92 },
      { positionName: 'Senior III', performanceLevel: 3, expected: 254.79 },
      { positionName: 'Junior II', performanceLevel: 3, expected: 57.73 },
      { positionName: 'Junior IV', performanceLevel: 3, expected: 116.68 },
    ];
    const customConfig = { k: 3.8, x0: 0.24, piso: 0.12, pscale: 0.5, ceil: 5.8, adjustment: 0.05 };

    it.each(fixture)('%s perf=%s → R$ %s', ({ positionName, performanceLevel, expected }) => {
      const pos = POSITIONS.find(p => p.name === positionName)!;
      const r = service.calculate({
        salary: pos.salary,
        performanceLevel,
        averageTasksPerUser: 2.19,
        salaryRange: SALARY_RANGE,
        config: customConfig,
      });
      expect(r.bonus).toBe(expected);
    });

    it('total across 16 employees = R$ 2.092,78', () => {
      const total = fixture.reduce((sum, f) => {
        const pos = POSITIONS.find(p => p.name === f.positionName)!;
        const r = service.calculate({
          salary: pos.salary,
          performanceLevel: f.performanceLevel,
          averageTasksPerUser: 2.19,
          salaryRange: SALARY_RANGE,
          config: customConfig,
        });
        return sum + r.bonus;
      }, 0);
      expect(Math.round(total * 100) / 100).toBe(2092.78);
    });
  });

  describe('audit-trail snapshot', () => {
    it('buildParamsSnapshot captures version, salary, range, B1, full config', () => {
      const snap = service.buildParamsSnapshot({
        salary: 3000,
        salaryRange: SALARY_RANGE,
        averageTasksPerUser: 4,
      });
      expect(snap.version).toBe(BONUS_CALCULATION_VERSION);
      expect(snap.salary).toBe(3000);
      expect(snap.salaryRange).toEqual(SALARY_RANGE);
      expect(snap.averageTasksPerUser).toBe(4);
      expect(snap.config).toEqual(DEFAULT_BONUS_CONFIG);
    });

    it('snapshot config is the merged effective config when overrides given', () => {
      const snap = service.buildParamsSnapshot({
        salary: 3000,
        salaryRange: SALARY_RANGE,
        averageTasksPerUser: 4,
        config: { adjustment: 0.05 },
      });
      expect(snap.config.adjustment).toBe(0.05);
      expect(snap.config.k).toBe(DEFAULT_BONUS_CONFIG.k);
    });
  });
});
