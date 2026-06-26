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
  isUnderStability,
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
    // The multa incides over the FGTS base = fgtsBalance + 8% × (aviso indenizado
    // + 13º proporcional), NOT the raw informed balance (Súmula TST 305 / Lei
    // 8.036 art. 15 §1º). baseInput (WITHOUT_CAUSE, no notice, exp1 2020-01-02,
    // termination 2026-06-10, BR 3000) produces a 13º of 5/12 avos = 1250 (June
    // has < 15 worked days, so it does not count) and no indemnified notice, so
    // base = 10000 + 0.08×1250 = 10100.
    it('40% over the FGTS base for WITHOUT_CAUSE / INDIRECT / EXPERIENCE_EARLY_EMPLOYER', () => {
      for (const type of [
        TERMINATION_TYPE.WITHOUT_CAUSE,
        TERMINATION_TYPE.INDIRECT,
        TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYER,
      ]) {
        const items = itemsOf(baseInput({ type, fgtsBalance: 10000 }));
        const fine = find(items, TERMINATION_ITEM_TYPE.FGTS_FINE);
        // base 10000 + 8% × 1250 (13º) = 10100 → 40% = 4040
        expect(fine?.baseValue).toBe(10100);
        expect(fine?.amount).toBe(4040);
      }
    });

    it('20% over the FGTS base for MUTUAL_AGREEMENT (CLT 484-A I b)', () => {
      const items = itemsOf(
        baseInput({ type: TERMINATION_TYPE.MUTUAL_AGREEMENT, fgtsBalance: 10000 }),
      );
      const fine = find(items, TERMINATION_ITEM_TYPE.FGTS_FINE);
      // base 10000 + 8% × 1250 (13º) = 10100 → 20% = 2020
      expect(fine?.baseValue).toBe(10100);
      expect(fine?.amount).toBe(2020);
    });

    it('the base projects the aviso indenizado + 13º (Súmula TST 305)', () => {
      // Hand-check (contract): fgtsBalance 10000 + aviso 3000 + 13º 1500
      //   → base 10000 + 0.08 × (3000 + 1500) = 10360 → 40% = 4144.
      // The notice projection (projectedEndDate 2026-07-10) extends the 13º to
      // 6/12 avos = 1500 (July's anniversary day clears the ≥15-day fraction).
      const items = itemsOf(
        baseInput({
          type: TERMINATION_TYPE.WITHOUT_CAUSE,
          fgtsBalance: 10000,
          noticeType: NOTICE_TYPE.INDEMNIFIED,
          noticeDays: 30, // BR/30 × 30 = 3000 aviso indenizado
          projectedEndDate: new Date(2026, 6, 10), // 2026-07-10
        }),
      );
      const notice = find(items, TERMINATION_ITEM_TYPE.NOTICE_INDEMNIFIED);
      const thirteenths = findAll(items, TERMINATION_ITEM_TYPE.THIRTEENTH_PROPORTIONAL);
      const thirteenthTotal = thirteenths.reduce((s, i) => s + i.amount, 0);
      expect(notice?.amount).toBe(3000);
      expect(thirteenthTotal).toBe(1500);
      const fine = find(items, TERMINATION_ITEM_TYPE.FGTS_FINE);
      expect(fine?.baseValue).toBe(10360);
      expect(fine?.amount).toBe(4144);
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

  describe('SALARY_BALANCE mid-month admission (Part G)', () => {
    it('counts from the 1st when admission is in a previous month', () => {
      // Admission 2020-01-02, termination 2026-06-20 → 20 days (1st–20th)
      const items = itemsOf(
        baseInput({ terminationDate: new Date(2026, 5, 20), exp1StartAt: new Date(2020, 0, 2) }),
      );
      const salary = find(items, TERMINATION_ITEM_TYPE.SALARY_BALANCE);
      expect(salary?.referenceQuantity).toBe(20);
      expect(salary?.amount).toBe(2000); // 3000/30 × 20
    });

    it('counts only the days worked when admission is mid-month (same month as termination)', () => {
      // Admitted 2026-06-12, terminated 2026-06-20 → 9 days inclusive, NOT 20
      const items = itemsOf(
        baseInput({
          type: TERMINATION_TYPE.EXPERIENCE_END,
          terminationDate: new Date(2026, 5, 20),
          exp1StartAt: new Date(2026, 5, 12),
        }),
      );
      const salary = find(items, TERMINATION_ITEM_TYPE.SALARY_BALANCE);
      expect(salary?.referenceQuantity).toBe(9);
      expect(salary?.amount).toBe(900); // 3000/30 × 9
    });

    it('exposes daysWorkedInTerminationMonth directly', () => {
      expect(
        service.daysWorkedInTerminationMonth(new Date(2026, 5, 20), new Date(2026, 5, 12)),
      ).toBe(9);
      expect(
        service.daysWorkedInTerminationMonth(new Date(2026, 5, 20), new Date(2020, 0, 2)),
      ).toBe(20);
      expect(service.daysWorkedInTerminationMonth(new Date(2026, 5, 20), null)).toBe(20);
    });
  });

  describe('ART480_INDEMNITY (employee breaks the fixed-term/experiência early — CLT 480)', () => {
    it('lances a DISCOUNT of 50% of the remaining fixed-term days (FIXED_TERM_EARLY_EMPLOYEE)', () => {
      // 30 remaining days → 0.5 × (3000/30) × 30 = 1500, owed BY the employee
      const items = itemsOf(
        baseInput({
          type: TERMINATION_TYPE.FIXED_TERM_EARLY_EMPLOYEE,
          experienceEndAt: new Date(2026, 6, 10), // 30 days after 2026-06-10
        }),
      );
      const indemnity = find(items, TERMINATION_ITEM_TYPE.ART479_INDEMNITY);
      expect(indemnity?.amount).toBe(-1500); // negative = discount owed by employee
      expect(indemnity?.description).toContain('Art. 480');
    });

    it('also applies to EXPERIENCE_EARLY_EMPLOYEE', () => {
      const items = itemsOf(
        baseInput({
          type: TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYEE,
          experienceEndAt: new Date(2026, 6, 10),
        }),
      );
      expect(find(items, TERMINATION_ITEM_TYPE.ART479_INDEMNITY)?.amount).toBe(-1500);
    });

    it('employer art. 479 stays positive (owed BY the employer)', () => {
      const items = itemsOf(
        baseInput({
          type: TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYER,
          experienceEndAt: new Date(2026, 6, 10),
        }),
      );
      const indemnity = find(items, TERMINATION_ITEM_TYPE.ART479_INDEMNITY);
      expect(indemnity?.amount).toBe(1500);
      expect(indemnity?.description).toContain('Art. 479');
    });

    it('no FGTS fine for an employee-side early fixed-term termination', () => {
      const items = itemsOf(
        baseInput({
          type: TERMINATION_TYPE.FIXED_TERM_EARLY_EMPLOYEE,
          fgtsBalance: 10000,
          experienceEndAt: new Date(2026, 6, 10),
        }),
      );
      expect(find(items, TERMINATION_ITEM_TYPE.FGTS_FINE)).toBeUndefined();
    });
  });

  describe('ART481 cláusula assecuratória (early fixed-term → indeterminate regime)', () => {
    it('employer-side early termination with the clause gets 40% FGTS and NO art. 479', () => {
      const items = itemsOf(
        baseInput({
          type: TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYER,
          hasArt481Clause: true,
          fgtsBalance: 10000,
          experienceEndAt: new Date(2026, 6, 10),
          noticeType: NOTICE_TYPE.INDEMNIFIED,
          noticeDays: 30,
          projectedEndDate: new Date(2026, 6, 10),
        }),
      );
      // 40% FGTS fine (indeterminate regime) over the projected base.
      // refEnd projects to 2026-07-10 → 13º = 6/12 avos = 1500, aviso = 3000.
      // base = 10000 + 0.08 × (3000 + 1500) = 10360 → 40% = 4144.
      expect(find(items, TERMINATION_ITEM_TYPE.FGTS_FINE)?.baseValue).toBe(10360);
      expect(find(items, TERMINATION_ITEM_TYPE.FGTS_FINE)?.amount).toBe(4144);
      // no art. 479/480 indemnity
      expect(find(items, TERMINATION_ITEM_TYPE.ART479_INDEMNITY)).toBeUndefined();
      // employer pays the indemnified notice (mapped to WITHOUT_CAUSE)
      expect(find(items, TERMINATION_ITEM_TYPE.NOTICE_INDEMNIFIED)?.amount).toBe(3000);
    });

    it('employee-side early termination with the clause follows resignation (no art. 480, no fine)', () => {
      const items = itemsOf(
        baseInput({
          type: TERMINATION_TYPE.FIXED_TERM_EARLY_EMPLOYEE,
          hasArt481Clause: true,
          fgtsBalance: 10000,
          experienceEndAt: new Date(2026, 6, 10),
        }),
      );
      expect(find(items, TERMINATION_ITEM_TYPE.ART479_INDEMNITY)).toBeUndefined();
      expect(find(items, TERMINATION_ITEM_TYPE.FGTS_FINE)).toBeUndefined();
    });
  });

  describe('INTERMITTENT_END', () => {
    it('pays saldo + 13º/férias proporcionais but no notice and no FGTS fine', () => {
      const items = itemsOf(
        baseInput({
          type: TERMINATION_TYPE.INTERMITTENT_END,
          fgtsBalance: 10000,
          exp1StartAt: new Date(2025, 0, 10),
        }),
      );
      const types = items.map(i => i.type);
      expect(types).toContain(TERMINATION_ITEM_TYPE.SALARY_BALANCE);
      expect(types).toContain(TERMINATION_ITEM_TYPE.THIRTEENTH_PROPORTIONAL);
      expect(types).toContain(TERMINATION_ITEM_TYPE.PROPORTIONAL_VACATION);
      expect(types).not.toContain(TERMINATION_ITEM_TYPE.NOTICE_INDEMNIFIED);
      expect(types).not.toContain(TERMINATION_ITEM_TYPE.FGTS_FINE);
      expect(types).not.toContain(TERMINATION_ITEM_TYPE.ART479_INDEMNITY);
    });
  });

  describe('computeTaxAssist (tax/FGTS incidence — Part G)', () => {
    it('taxes saldo + worked notice; exempts férias/aviso indenizado/multa FGTS', () => {
      const assist = service.computeTaxAssist({
        taxable: { salaryBalance: 3000, workedNotice: 0, thirteenth: 3000 },
        fgtsBalance: 10000,
        indemnifiedNotice: 0,
        dependentsCount: 0,
        year: 2026,
      });
      // monthly base = saldo only (no exempt verba mixed in)
      expect(assist.monthlyInssBase).toBe(3000);
      expect(assist.monthlyInss).toBeGreaterThan(0);
      // 13º taxed on its own exclusive base
      expect(assist.thirteenthInssBase).toBe(3000);
      expect(assist.thirteenthInss).toBeGreaterThan(0);
      expect(assist.totalInss).toBe(
        Math.round((assist.monthlyInss + assist.thirteenthInss) * 100) / 100,
      );
    });

    it('FGTS-multa base includes 8% of the aviso indenizado projeção + 8% of the 13º', () => {
      const assist = service.computeTaxAssist({
        taxable: { salaryBalance: 3000, workedNotice: 0, thirteenth: 1500 },
        fgtsBalance: 10000,
        indemnifiedNotice: 3000,
        dependentsCount: 0,
        year: 2026,
      });
      // 10000 + 0.08 × (3000 + 1500) = 10000 + 360 = 10360
      expect(assist.fgtsFineBase).toBe(10360);
    });

    it('zero thirteenth produces zero 13º taxes', () => {
      const assist = service.computeTaxAssist({
        taxable: { salaryBalance: 1000, workedNotice: 0, thirteenth: 0 },
        fgtsBalance: null,
        indemnifiedNotice: 0,
        year: 2026,
      });
      expect(assist.thirteenthInss).toBe(0);
      expect(assist.thirteenthIrrf).toBe(0);
      expect(assist.fgtsFineBase).toBe(0);
    });
  });

  describe('isUnderStability (estabilidade guard predicate)', () => {
    it('true when the date is within [stabilityStart, stabilityEnd]', () => {
      const contract = {
        stabilityStart: new Date(2026, 0, 1),
        stabilityEnd: new Date(2026, 11, 31),
      };
      expect(isUnderStability(contract, new Date(2026, 5, 10))).toBe(true);
    });

    it('false outside the window or when no window is set', () => {
      const contract = {
        stabilityStart: new Date(2026, 0, 1),
        stabilityEnd: new Date(2026, 2, 31),
      };
      expect(isUnderStability(contract, new Date(2026, 5, 10))).toBe(false);
      expect(isUnderStability({ stabilityStart: null, stabilityEnd: null }, new Date())).toBe(false);
      expect(isUnderStability(null, new Date())).toBe(false);
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
