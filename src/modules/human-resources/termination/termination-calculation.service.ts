// termination-calculation.service.ts
// Motor de cálculo das verbas rescisórias (contract §2).
//
// Implements (BR = baseRemuneration):
//   SALARY_BALANCE          = BR/30 × daysWorkedInMonth(terminationDate)
//   NOTICE_INDEMNIFIED      = BR/30 × noticeDays (noticeType INDEMNIFIED; halved for
//                             MUTUAL_AGREEMENT per CLT 484-A)
//   NOTICE_DISCOUNT         = −BR/30 × noticeDays (RESIGNATION with noticeType
//                             INDEMNIFIED — employee left without working the
//                             notice, CLT 487 §2º)
//   THIRTEENTH_PROPORTIONAL = BR/12 × months (fraction ≥15 days = 1 month; counted to
//                             projectedEndDate — CLT 487 §1º projection, employer-paid
//                             notice only; one item per calendar year when the
//                             projection crosses a year boundary)
//   ACCRUED_VACATION        = BR × accruedVacationPeriods × 4/3
//   PROPORTIONAL_VACATION   = BR/12 × monthsInCurrentAcquisitivePeriod × 4/3
//                             (period anniversary from User.exp1StartAt; skipped for WITH_CAUSE)
//   FGTS_FINE               = 40% × fgtsBalance (WITHOUT_CAUSE/INDIRECT/EXPERIENCE_EARLY_EMPLOYER);
//                             20% for MUTUAL_AGREEMENT (CLT 484-A)
//   ART479_INDEMNITY        = 50% × BR/30 × remaining experience-contract days
//                             (EXPERIENCE_EARLY_EMPLOYER only)
//
// INSS/IRRF (and any other discounts) are intentionally NOT auto-calculated —
// they are added by the user as custom items (isCustom = true), which this
// engine never touches.

import { BadRequestException, Injectable } from '@nestjs/common';
import { NOTICE_TYPE, TERMINATION_ITEM_TYPE, TERMINATION_TYPE } from '../../../constants';

export interface TerminationCalculationInput {
  type: TERMINATION_TYPE;
  noticeType: NOTICE_TYPE | null;
  noticeDays: number | null;
  terminationDate: Date | null;
  projectedEndDate: Date | null;
  baseRemuneration: number | null;
  fgtsBalance: number | null;
  accruedVacationPeriods: number;
  // From the User record
  exp1StartAt: Date | null;
  experienceEndAt: Date | null; // exp2EndAt ?? exp1EndAt
}

export interface ComputedTerminationItem {
  type: TERMINATION_ITEM_TYPE;
  description: string;
  referenceQuantity: number | null;
  baseValue: number | null;
  amount: number;
  isCustom: false;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const round2 = (value: number): number => Math.round(value * 100) / 100;

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addMonthsClamped = (date: Date, months: number): Date => {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setMonth(result.getMonth() + months);
  // Clamp overflow (e.g. Jan 31 + 1 month → Feb 28) back to the last day of the month
  if (result.getDate() !== day) {
    result.setDate(0);
  }
  return result;
};

const diffDaysInclusive = (from: Date, to: Date): number =>
  Math.floor((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS) + 1;

/**
 * Types where the notice is given (and, when indemnified, paid) BY THE
 * EMPLOYER. Only these project the contract end (CLT 487 §1º): a resigning
 * employee who does not work the notice indemnifies the EMPLOYER (487 §2º)
 * and gets no projection.
 */
export const EMPLOYER_NOTICE_TYPES: TERMINATION_TYPE[] = [
  TERMINATION_TYPE.WITHOUT_CAUSE,
  TERMINATION_TYPE.INDIRECT,
  TERMINATION_TYPE.MUTUAL_AGREEMENT,
];

@Injectable()
export class TerminationCalculationService {
  /**
   * Full years completed between two dates (CLT 487 §1º proportional notice base).
   */
  completedYears(from: Date, to: Date): number {
    let years = to.getFullYear() - from.getFullYear();
    const anniversary = new Date(from.getTime());
    anniversary.setFullYear(from.getFullYear() + years);
    if (anniversary > to) years--;
    return Math.max(0, years);
  }

  /**
   * Notice days per contract: 30 + 3×completedYears capped at 90 when the
   * employer dismisses (WITHOUT_CAUSE/INDIRECT — Lei 12.506 proportionality
   * applies only to employer dismissal); flat 30 for RESIGNATION (CLT 487)
   * and MUTUAL_AGREEMENT (484-A — value later halved, never proportional);
   * null for every other type (fixed-term/experience contracts and death
   * have no notice).
   */
  computeNoticeDays(
    type: TERMINATION_TYPE,
    exp1StartAt: Date | null,
    terminationDate: Date | null,
  ): number | null {
    if (type === TERMINATION_TYPE.WITHOUT_CAUSE || type === TERMINATION_TYPE.INDIRECT) {
      const years =
        exp1StartAt && terminationDate ? this.completedYears(exp1StartAt, terminationDate) : 0;
      return Math.min(90, 30 + 3 * years);
    }
    if (type === TERMINATION_TYPE.RESIGNATION || type === TERMINATION_TYPE.MUTUAL_AGREEMENT) {
      return 30;
    }
    return null;
  }

  /**
   * Months worked within the given 13º calendar year, clamped to refEnd,
   * where a fraction of ≥15 days within a month counts as a full month
   * (Lei 4.090/62 art. 1º §2º).
   */
  private thirteenthMonths(exp1StartAt: Date | null, year: number, refEnd: Date): number {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    let periodStart = yearStart;
    if (exp1StartAt && startOfDay(exp1StartAt) > yearStart) {
      periodStart = startOfDay(exp1StartAt);
    }
    const periodEnd = refEnd < yearEnd ? refEnd : yearEnd;
    if (periodStart > periodEnd || periodStart.getFullYear() > year) return 0;

    let months = 0;
    for (let month = periodStart.getMonth(); month <= periodEnd.getMonth(); month++) {
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0);
      const from = periodStart > monthStart ? periodStart : monthStart;
      const to = periodEnd < monthEnd ? periodEnd : monthEnd;
      if (diffDaysInclusive(from, to) >= 15) months++;
    }
    return Math.min(12, months);
  }

  /**
   * Months in the current vacation acquisitive period (anniversary cycle of
   * exp1StartAt) up to refEnd; remaining fraction of ≥15 days = 1 month.
   */
  private proportionalVacationMonths(exp1StartAt: Date | null, refEnd: Date): number {
    if (!exp1StartAt) return 0;
    const start = startOfDay(exp1StartAt);
    if (start > refEnd) return 0;

    // Latest acquisitive-period anniversary ≤ refEnd
    const completedPeriods = Math.max(0, this.completedYears(start, refEnd));
    const periodStart = new Date(start.getTime());
    periodStart.setFullYear(start.getFullYear() + completedPeriods);

    let months = 0;
    let cursor = periodStart;
    while (addMonthsClamped(cursor, 1) <= refEnd) {
      months++;
      cursor = addMonthsClamped(cursor, 1);
    }
    const remainderDays = diffDaysInclusive(cursor, refEnd);
    if (remainderDays >= 15) months++;

    return Math.min(12, months);
  }

  /**
   * Computes the auto-calculated verbas for a termination, applying the
   * verbas-per-type matrix. Custom items (isCustom) are never produced here.
   */
  calculate(input: TerminationCalculationInput): ComputedTerminationItem[] {
    const { type, baseRemuneration, terminationDate } = input;

    if (!terminationDate) {
      throw new BadRequestException(
        'A data da rescisão é obrigatória para calcular as verbas rescisórias.',
      );
    }
    if (!baseRemuneration || baseRemuneration <= 0) {
      throw new BadRequestException(
        'A remuneração base é obrigatória para calcular as verbas rescisórias.',
      );
    }

    const br = baseRemuneration;
    const dailyRate = br / 30;
    const end = startOfDay(terminationDate);
    // CLT 487 §1º: the indemnified notice paid by the EMPLOYER projects the
    // contract end for the time-proportional verbas (13º and proportional
    // vacation). A resigning employee's unworked notice never projects.
    const refEnd =
      input.noticeType === NOTICE_TYPE.INDEMNIFIED &&
      input.projectedEndDate &&
      EMPLOYER_NOTICE_TYPES.includes(type)
        ? startOfDay(input.projectedEndDate)
        : end;

    const items: ComputedTerminationItem[] = [];

    // --- SALARY_BALANCE (all types) ---
    const daysWorked = end.getDate();
    items.push({
      type: TERMINATION_ITEM_TYPE.SALARY_BALANCE,
      description: `Saldo de salário (${daysWorked} dia${daysWorked === 1 ? '' : 's'})`,
      referenceQuantity: daysWorked,
      baseValue: br,
      amount: round2(dailyRate * daysWorked),
      isCustom: false,
    });

    // --- NOTICE_INDEMNIFIED (employer pays the unworked notice) ---
    if (
      input.noticeType === NOTICE_TYPE.INDEMNIFIED &&
      input.noticeDays &&
      input.noticeDays > 0 &&
      EMPLOYER_NOTICE_TYPES.includes(type)
    ) {
      const isMutualAgreement = type === TERMINATION_TYPE.MUTUAL_AGREEMENT;
      const fullAmount = dailyRate * input.noticeDays;
      items.push({
        type: TERMINATION_ITEM_TYPE.NOTICE_INDEMNIFIED,
        description: isMutualAgreement
          ? `Aviso prévio indenizado (${input.noticeDays} dias — 50%, acordo mútuo CLT 484-A)`
          : `Aviso prévio indenizado (${input.noticeDays} dias)`,
        referenceQuantity: input.noticeDays,
        baseValue: br,
        amount: round2(isMutualAgreement ? fullAmount / 2 : fullAmount),
        isCustom: false,
      });
    }

    // --- NOTICE_DISCOUNT (CLT 487 §2º) ---
    // The employee resigned and did not work the notice: the employer may
    // discount the salaries corresponding to the notice period.
    if (
      type === TERMINATION_TYPE.RESIGNATION &&
      input.noticeType === NOTICE_TYPE.INDEMNIFIED &&
      input.noticeDays &&
      input.noticeDays > 0
    ) {
      items.push({
        type: TERMINATION_ITEM_TYPE.NOTICE_DISCOUNT,
        description: `Desconto do aviso prévio não cumprido (${input.noticeDays} dias — CLT 487 §2º)`,
        referenceQuantity: input.noticeDays,
        baseValue: br,
        amount: -round2(dailyRate * input.noticeDays),
        isCustom: false,
      });
    }

    // --- THIRTEENTH_PROPORTIONAL (all types except WITH_CAUSE) ---
    // One item per calendar year touched by [terminationDate, refEnd]: when
    // the notice projection crosses a year boundary, the closing year's avos
    // and the projected year's avos are both due.
    if (type !== TERMINATION_TYPE.WITH_CAUSE) {
      const crossesYear = refEnd.getFullYear() > end.getFullYear();
      for (let year = end.getFullYear(); year <= refEnd.getFullYear(); year++) {
        const months13 = this.thirteenthMonths(input.exp1StartAt, year, refEnd);
        if (months13 > 0) {
          items.push({
            type: TERMINATION_ITEM_TYPE.THIRTEENTH_PROPORTIONAL,
            description: crossesYear
              ? `13º salário proporcional ${year} (${months13}/12 avos)`
              : `13º salário proporcional (${months13}/12 avos)`,
            referenceQuantity: months13,
            baseValue: br,
            amount: round2((br / 12) * months13),
            isCustom: false,
          });
        }
      }
    }

    // --- ACCRUED_VACATION (+1/3) — all types, including WITH_CAUSE ---
    if (input.accruedVacationPeriods > 0) {
      items.push({
        type: TERMINATION_ITEM_TYPE.ACCRUED_VACATION,
        description: `Férias vencidas + 1/3 (${input.accruedVacationPeriods} período${
          input.accruedVacationPeriods === 1 ? '' : 's'
        })`,
        referenceQuantity: input.accruedVacationPeriods,
        baseValue: br,
        amount: round2(br * input.accruedVacationPeriods * (4 / 3)),
        isCustom: false,
      });
    }

    // --- PROPORTIONAL_VACATION (+1/3) — skipped for WITH_CAUSE ---
    if (type !== TERMINATION_TYPE.WITH_CAUSE) {
      const vacationMonths = this.proportionalVacationMonths(input.exp1StartAt, refEnd);
      if (vacationMonths > 0) {
        items.push({
          type: TERMINATION_ITEM_TYPE.PROPORTIONAL_VACATION,
          description: `Férias proporcionais + 1/3 (${vacationMonths}/12 avos)`,
          referenceQuantity: vacationMonths,
          baseValue: br,
          amount: round2((br / 12) * vacationMonths * (4 / 3)),
          isCustom: false,
        });
      }
    }

    // --- FGTS_FINE: 40% (WITHOUT_CAUSE/INDIRECT/EXPERIENCE_EARLY_EMPLOYER), 20% (MUTUAL_AGREEMENT) ---
    const fgtsFinePercent =
      type === TERMINATION_TYPE.WITHOUT_CAUSE ||
      type === TERMINATION_TYPE.INDIRECT ||
      type === TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYER
        ? 0.4
        : type === TERMINATION_TYPE.MUTUAL_AGREEMENT
          ? 0.2
          : null;
    if (fgtsFinePercent !== null && input.fgtsBalance && input.fgtsBalance > 0) {
      items.push({
        type: TERMINATION_ITEM_TYPE.FGTS_FINE,
        description: `Multa do FGTS (${fgtsFinePercent * 100}% sobre o saldo)`,
        referenceQuantity: fgtsFinePercent * 100,
        baseValue: input.fgtsBalance,
        amount: round2(input.fgtsBalance * fgtsFinePercent),
        isCustom: false,
      });
    }

    // --- ART479_INDEMNITY (EXPERIENCE_EARLY_EMPLOYER only) ---
    if (type === TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYER && input.experienceEndAt) {
      const expEnd = startOfDay(input.experienceEndAt);
      const remainingDays =
        expEnd > end ? Math.floor((expEnd.getTime() - end.getTime()) / DAY_MS) : 0;
      if (remainingDays > 0) {
        items.push({
          type: TERMINATION_ITEM_TYPE.ART479_INDEMNITY,
          description: `Indenização art. 479 CLT (50% dos ${remainingDays} dias restantes da experiência)`,
          referenceQuantity: remainingDays,
          baseValue: br,
          amount: round2(0.5 * dailyRate * remainingDays),
          isCustom: false,
        });
      }
    }

    return items;
  }
}
