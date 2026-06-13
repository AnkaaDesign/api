// termination-calculation.service.spec.ts
//
// Pure-function tests for the verbas-rescisórias engine (no DB, no Nest
// context). Legal references: CLT 477 §6º/§8º, 479, 480, 482, 483, 484-A,
// 487 §§1º-2º, 488; Lei 12.506/2011 (aviso proporcional); Lei 4.090/62 (13º);
// CLT 146 parágrafo único (férias proporcionais, fração > 14 dias).

import {
  EMPLOYER_NOTICE_TYPES,
  TerminationCalculationService,
  TerminationCalculationInput,
} from './termination-calculation.service';
import { NOTICE_TYPE, TERMINATION_ITEM_TYPE, TERMINATION_TYPE } from '../../../constants';

const service = new TerminationCalculationService();

const baseInput = (overrides: Partial<TerminationCalculationInput>): TerminationCalculationInput => ({
  type: TERMINATION_TYPE.WITHOUT_CAUSE,
  noticeType: null,
  noticeDays: null,
  terminationDate: new Date(2026, 5, 10), // 2026-06-10
  projectedEndDate: null,
  baseRemuneration: 3000,
  fgtsBalance: null,
  accruedVacationPeriods: 0,
  exp1StartAt: new Date(2020, 0, 2), // 2020-01-02
  experienceEndAt: null,
  ...overrides,
});

const itemsOf = (input: TerminationCalculationInput) => service.calculate(input);
const find = (items: ReturnType<typeof itemsOf>, type: TERMINATION_ITEM_TYPE) =>
  items.find(item => item.type === type);
const findAll = (items: ReturnType<typeof itemsOf>, type: TERMINATION_ITEM_TYPE) =>
  items.filter(item => item.type === type);

describe('TerminationCalculationService', () => {
  describe('computeNoticeDays (Lei 12.506 / CLT 487)', () => {
    it('employer dismissal: 30 + 3×completed years', () => {
      expect(
        service.computeNoticeDays(
          TERMINATION_TYPE.WITHOUT_CAUSE,
          new Date(2026, 0, 1),
          new Date(2026, 5, 10),
        ),
      ).toBe(30); // 0 completed years
      expect(
        service.computeNoticeDays(
          TERMINATION_TYPE.WITHOUT_CAUSE,
          new Date(2021, 5, 1),
          new Date(2026, 5, 10),
        ),
      ).toBe(45); // 5 completed years
    });

    it('caps at 90 days (20+ years)', () => {
      expect(
        service.computeNoticeDays(
          TERMINATION_TYPE.WITHOUT_CAUSE,
          new Date(2000, 0, 1),
          new Date(2026, 5, 10),
        ),
      ).toBe(90);
    });

    it('INDIRECT (rescisão indireta, CLT 483) is proportional like employer dismissal', () => {
      expect(
        service.computeNoticeDays(
          TERMINATION_TYPE.INDIRECT,
          new Date(2021, 5, 1),
          new Date(2026, 5, 10),
        ),
      ).toBe(45);
    });

    it('RESIGNATION and MUTUAL_AGREEMENT are flat 30 (proportionality is employer-only)', () => {
      expect(
        service.computeNoticeDays(
          TERMINATION_TYPE.RESIGNATION,
          new Date(2000, 0, 1),
          new Date(2026, 5, 10),
        ),
      ).toBe(30);
      expect(
        service.computeNoticeDays(
          TERMINATION_TYPE.MUTUAL_AGREEMENT,
          new Date(2000, 0, 1),
          new Date(2026, 5, 10),
        ),
      ).toBe(30);
    });

    it('no notice for just cause, fixed-term/experience ends and death', () => {
      for (const type of [
        TERMINATION_TYPE.WITH_CAUSE,
        TERMINATION_TYPE.EXPERIENCE_END,
        TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYER,
        TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYEE,
        TERMINATION_TYPE.DEATH,
      ]) {
        expect(service.computeNoticeDays(type, new Date(2020, 0, 1), new Date(2026, 5, 10))).toBeNull();
      }
    });
  });

  describe('SALARY_BALANCE', () => {
    it('BR/30 × days worked in the termination month', () => {
      const items = itemsOf(baseInput({}));
      const salary = find(items, TERMINATION_ITEM_TYPE.SALARY_BALANCE);
      expect(salary?.amount).toBe(1000); // 3000/30 × 10
      expect(salary?.referenceQuantity).toBe(10);
    });
  });

  describe('NOTICE_INDEMNIFIED (CLT 487 §1º / 484-A)', () => {
    it('full value when the employer dismisses without cause', () => {
      const items = itemsOf(
        baseInput({ noticeType: NOTICE_TYPE.INDEMNIFIED, noticeDays: 30 }),
      );
      expect(find(items, TERMINATION_ITEM_TYPE.NOTICE_INDEMNIFIED)?.amount).toBe(3000);
    });

    it('halved for MUTUAL_AGREEMENT (CLT 484-A I a)', () => {
      const items = itemsOf(
        baseInput({
          type: TERMINATION_TYPE.MUTUAL_AGREEMENT,
          noticeType: NOTICE_TYPE.INDEMNIFIED,
          noticeDays: 30,
        }),
      );
      expect(find(items, TERMINATION_ITEM_TYPE.NOTICE_INDEMNIFIED)?.amount).toBe(1500);
    });

    it('never paid on resignation, worked or waived notice', () => {
      const resignation = itemsOf(
        baseInput({
          type: TERMINATION_TYPE.RESIGNATION,
          noticeType: NOTICE_TYPE.INDEMNIFIED,
          noticeDays: 30,
        }),
      );
      expect(find(resignation, TERMINATION_ITEM_TYPE.NOTICE_INDEMNIFIED)).toBeUndefined();

      const worked = itemsOf(baseInput({ noticeType: NOTICE_TYPE.WORKED, noticeDays: 30 }));
      expect(find(worked, TERMINATION_ITEM_TYPE.NOTICE_INDEMNIFIED)).toBeUndefined();
    });
  });

  describe('NOTICE_DISCOUNT (CLT 487 §2º)', () => {
    it('discounts the unworked notice when the employee resigns', () => {
      const items = itemsOf(
        baseInput({
          type: TERMINATION_TYPE.RESIGNATION,
          noticeType: NOTICE_TYPE.INDEMNIFIED,
          noticeDays: 30,
        }),
      );
      expect(find(items, TERMINATION_ITEM_TYPE.NOTICE_DISCOUNT)?.amount).toBe(-3000);
    });

    it('no discount when the notice is worked or waived by the employer', () => {
      for (const noticeType of [NOTICE_TYPE.WORKED, NOTICE_TYPE.WAIVED]) {
        const items = itemsOf(
          baseInput({ type: TERMINATION_TYPE.RESIGNATION, noticeType, noticeDays: 30 }),
        );
        expect(find(items, TERMINATION_ITEM_TYPE.NOTICE_DISCOUNT)).toBeUndefined();
      }
    });
  });

  describe('THIRTEENTH_PROPORTIONAL (Lei 4.090/62)', () => {
    it('counts avos in the calendar year, fraction ≥15 days = 1 month', () => {
      // Jan–May full months + 10 days of June (<15) = 5 avos
      const items = itemsOf(baseInput({}));
      const thirteenth = find(items, TERMINATION_ITEM_TYPE.THIRTEENTH_PROPORTIONAL);
      expect(thirteenth?.referenceQuantity).toBe(5);
      expect(thirteenth?.amount).toBe(1250); // 3000/12 × 5
    });

    it('projects to projectedEndDate for employer-paid indemnified notice (CLT 487 §1º)', () => {
      // Projection to 2026-07-10 adds June (now full) but not July (10 days)
      const items = itemsOf(
        baseInput({
          noticeType: NOTICE_TYPE.INDEMNIFIED,
          noticeDays: 30,
          projectedEndDate: new Date(2026, 6, 10),
        }),
      );
      expect(find(items, TERMINATION_ITEM_TYPE.THIRTEENTH_PROPORTIONAL)?.referenceQuantity).toBe(6);
    });

    it('does NOT project for a resignation with unworked notice', () => {
      const items = itemsOf(
        baseInput({
          type: TERMINATION_TYPE.RESIGNATION,
          noticeType: NOTICE_TYPE.INDEMNIFIED,
          noticeDays: 30,
          projectedEndDate: new Date(2026, 6, 10), // must be ignored
        }),
      );
      expect(find(items, TERMINATION_ITEM_TYPE.THIRTEENTH_PROPORTIONAL)?.referenceQuantity).toBe(5);
    });

    it('emits one item per calendar year when the projection crosses the year', () => {
      // Termination 2026-12-06 + 45 days notice → projected 2027-01-20
      const items = itemsOf(
        baseInput({
          terminationDate: new Date(2026, 11, 6),
          noticeType: NOTICE_TYPE.INDEMNIFIED,
          noticeDays: 45,
          projectedEndDate: new Date(2027, 0, 20),
        }),
      );
      const thirteenths = findAll(items, TERMINATION_ITEM_TYPE.THIRTEENTH_PROPORTIONAL);
      expect(thirteenths).toHaveLength(2);
      expect(thirteenths[0].referenceQuantity).toBe(12); // 2026 full year
      expect(thirteenths[1].referenceQuantity).toBe(1); // 2027: Jan 1–20 ≥ 15 days
    });

    it('skipped entirely for WITH_CAUSE (justa causa)', () => {
      const items = itemsOf(baseInput({ type: TERMINATION_TYPE.WITH_CAUSE }));
      expect(find(items, TERMINATION_ITEM_TYPE.THIRTEENTH_PROPORTIONAL)).toBeUndefined();
    });
  });

  describe('vacations', () => {
    it('ACCRUED_VACATION pays BR × periods × 4/3 even for WITH_CAUSE', () => {
      const items = itemsOf(
        baseInput({ type: TERMINATION_TYPE.WITH_CAUSE, accruedVacationPeriods: 1 }),
      );
      expect(find(items, TERMINATION_ITEM_TYPE.ACCRUED_VACATION)?.amount).toBe(4000);
    });

    it('PROPORTIONAL_VACATION counts avos in the current acquisitive period × 4/3', () => {
      // exp1StartAt 2025-01-10 → current period started 2026-01-10;
      // up to 2026-06-10 = 5 avos → 3000/12 × 5 × 4/3 = 1666.67
      const items = itemsOf(baseInput({ exp1StartAt: new Date(2025, 0, 10) }));
      const proportional = find(items, TERMINATION_ITEM_TYPE.PROPORTIONAL_VACATION);
      expect(proportional?.referenceQuantity).toBe(5);
      expect(proportional?.amount).toBe(1666.67);
    });

    it('PROPORTIONAL_VACATION skipped for WITH_CAUSE', () => {
      const items = itemsOf(
        baseInput({ type: TERMINATION_TYPE.WITH_CAUSE, exp1StartAt: new Date(2025, 0, 10) }),
      );
      expect(find(items, TERMINATION_ITEM_TYPE.PROPORTIONAL_VACATION)).toBeUndefined();
    });
  });

  describe('FGTS_FINE', () => {
    it('40% for WITHOUT_CAUSE / INDIRECT / EXPERIENCE_EARLY_EMPLOYER', () => {
      for (const type of [
        TERMINATION_TYPE.WITHOUT_CAUSE,
        TERMINATION_TYPE.INDIRECT,
        TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYER,
      ]) {
        const items = itemsOf(baseInput({ type, fgtsBalance: 10000 }));
        expect(find(items, TERMINATION_ITEM_TYPE.FGTS_FINE)?.amount).toBe(4000);
      }
    });

    it('20% for MUTUAL_AGREEMENT (CLT 484-A I b)', () => {
      const items = itemsOf(
        baseInput({ type: TERMINATION_TYPE.MUTUAL_AGREEMENT, fgtsBalance: 10000 }),
      );
      expect(find(items, TERMINATION_ITEM_TYPE.FGTS_FINE)?.amount).toBe(2000);
    });

    it('no fine for resignation, just cause, experience end or death', () => {
      for (const type of [
        TERMINATION_TYPE.RESIGNATION,
        TERMINATION_TYPE.WITH_CAUSE,
        TERMINATION_TYPE.EXPERIENCE_END,
        TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYEE,
        TERMINATION_TYPE.DEATH,
      ]) {
        const items = itemsOf(baseInput({ type, fgtsBalance: 10000 }));
        expect(find(items, TERMINATION_ITEM_TYPE.FGTS_FINE)).toBeUndefined();
      }
    });
  });

  describe('ART479_INDEMNITY (early experience-contract end by the employer)', () => {
    it('pays 50% of the remaining experience days', () => {
      const items = itemsOf(
        baseInput({
          type: TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYER,
          experienceEndAt: new Date(2026, 6, 10), // 30 days after termination
        }),
      );
      expect(find(items, TERMINATION_ITEM_TYPE.ART479_INDEMNITY)?.amount).toBe(1500); // 0.5 × 100 × 30
    });

    it('only applies to EXPERIENCE_EARLY_EMPLOYER', () => {
      const items = itemsOf(
        baseInput({ type: TERMINATION_TYPE.EXPERIENCE_END, experienceEndAt: new Date(2026, 6, 10) }),
      );
      expect(find(items, TERMINATION_ITEM_TYPE.ART479_INDEMNITY)).toBeUndefined();
    });
  });

  describe('verbas matrix per type', () => {
    it('WITH_CAUSE: only salary balance + accrued vacation', () => {
      const items = itemsOf(
        baseInput({ type: TERMINATION_TYPE.WITH_CAUSE, accruedVacationPeriods: 1, fgtsBalance: 10000 }),
      );
      expect(items.map(item => item.type).sort()).toEqual(
        [TERMINATION_ITEM_TYPE.ACCRUED_VACATION, TERMINATION_ITEM_TYPE.SALARY_BALANCE].sort(),
      );
    });

    it('DEATH: 13º + vacations but no notice and no FGTS fine', () => {
      const items = itemsOf(
        baseInput({ type: TERMINATION_TYPE.DEATH, fgtsBalance: 10000, accruedVacationPeriods: 1 }),
      );
      const types = items.map(item => item.type);
      expect(types).toContain(TERMINATION_ITEM_TYPE.THIRTEENTH_PROPORTIONAL);
      expect(types).toContain(TERMINATION_ITEM_TYPE.ACCRUED_VACATION);
      expect(types).toContain(TERMINATION_ITEM_TYPE.PROPORTIONAL_VACATION);
      expect(types).not.toContain(TERMINATION_ITEM_TYPE.NOTICE_INDEMNIFIED);
      expect(types).not.toContain(TERMINATION_ITEM_TYPE.NOTICE_DISCOUNT);
      expect(types).not.toContain(TERMINATION_ITEM_TYPE.FGTS_FINE);
    });

    it('the engine never emits custom items', () => {
      const items = itemsOf(baseInput({ fgtsBalance: 10000, accruedVacationPeriods: 2 }));
      expect(items.every(item => item.isCustom === false)).toBe(true);
    });
  });

  describe('validation', () => {
    it('requires terminationDate and a positive baseRemuneration', () => {
      expect(() => itemsOf(baseInput({ terminationDate: null }))).toThrow();
      expect(() => itemsOf(baseInput({ baseRemuneration: null }))).toThrow();
      expect(() => itemsOf(baseInput({ baseRemuneration: 0 }))).toThrow();
    });
  });

  describe('EMPLOYER_NOTICE_TYPES', () => {
    it('contains exactly the employer-paid-notice modalities', () => {
      expect([...EMPLOYER_NOTICE_TYPES].sort()).toEqual(
        [
          TERMINATION_TYPE.WITHOUT_CAUSE,
          TERMINATION_TYPE.INDIRECT,
          TERMINATION_TYPE.MUTUAL_AGREEMENT,
        ].sort(),
      );
    });
  });
});
