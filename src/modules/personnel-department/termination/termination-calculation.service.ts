// termination-calculation.service.ts
// Motor de cálculo das verbas rescisórias (contract §2 / Part G).
//
// Implements (BR = baseRemuneration):
//   SALARY_BALANCE          = BR/30 × daysWorkedInMonth(terminationDate); the day
//                             count is the ACTUAL days worked in the termination
//                             month (1 on the admission day for a mid-month
//                             admission, otherwise from the 1st), NOT getDate().
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
//                             (period anniversary from the contract admission date;
//                             skipped for WITH_CAUSE)
//   FGTS_FINE               = 40% × fgtsFineBase (WITHOUT_CAUSE/INDIRECT/EXPERIENCE_EARLY_EMPLOYER);
//                             20% for MUTUAL_AGREEMENT (CLT 484-A); also 40% for an
//                             art. 481 early fixed-term termination (indeterminate regime).
//                             fgtsFineBase = fgtsBalance + 8% × (aviso indenizado + 13º
//                             proporcional) — Súmula TST 305 / Lei 8.036 art. 15 §1º.
//   ART479_INDEMNITY        = 50% × BR/30 × remaining experience/fixed-term days
//                             (EXPERIENCE_EARLY_EMPLOYER — owed BY THE EMPLOYER)
//   ART480_INDEMNITY        = −(½ × BR/30 × remaining fixed-term/experience days),
//                             capped at ½ of the remaining-contract salary — the
//                             indemnity owed BY THE EMPLOYEE who breaks a fixed-term/
//                             experiência contract early (FIXED_TERM_EARLY_EMPLOYEE /
//                             EXPERIENCE_EARLY_EMPLOYEE). Lanced as a DISCOUNT line.
//
// Art. 481 CLT — cláusula assecuratória: when the fixed-term/experiência contract
// carries the reciprocal-rescission clause (hasArt481Clause), an early termination
// follows the INDETERMINATE regime: aviso prévio + 40% FGTS and NO art. 479/480
// indemnity. The caller maps such a termination onto the WITHOUT_CAUSE/RESIGNATION
// rules and sets `art481` so this engine suppresses the 479/480 branch.
//
// INTERMITTENT_END — encerramento de contrato intermitente: saldo + 13º/férias
// proporcionais sobre as verbas já apuradas; no aviso (each convocação is autonomous)
// and no FGTS fine.
//
// Tax incidence (computeTaxAssist): INSS/IRRF auto-computed on the TAXABLE verbas
// only — saldo de salário, 13º proporcional and the WORKED notice. Férias
// indenizadas (vencidas/proporcionais + 1/3), aviso prévio INDENIZADO and the multa
// do FGTS are EXEMPT (Súmula 215 STF / art. 28 §9º Lei 8.212/91 / art. 6º Lei 7.713/88)
// and are never taxed. The FGTS-multa base includes the projeção do aviso indenizado
// and the rescisão 13º.

import { BadRequestException, Injectable } from '@nestjs/common';
import { NOTICE_TYPE, TERMINATION_ITEM_TYPE, TERMINATION_TYPE } from '../../../constants';
import {
  computeIRRF,
  computeProgressiveINSS,
  getInssTableForYear,
  getIrrfTableForYear,
} from '../payroll/utils/tax-tables';

export interface TerminationCalculationInput {
  type: TERMINATION_TYPE;
  noticeType: NOTICE_TYPE | null;
  noticeDays: number | null;
  terminationDate: Date | null;
  projectedEndDate: Date | null;
  baseRemuneration: number | null;
  fgtsBalance: number | null;
  accruedVacationPeriods: number;
  // From the current EmploymentContract record
  exp1StartAt: Date | null; // admission date of the current contract
  experienceEndAt: Date | null; // exp2EndAt ?? exp1EndAt (or fixed-term end)
  // Art. 481 CLT cláusula assecuratória — early fixed-term follows the
  // indeterminate regime (set by the caller from EmploymentContract.hasArt481Clause).
  hasArt481Clause?: boolean;
}

export interface ComputedTerminationItem {
  type: TERMINATION_ITEM_TYPE;
  // null when the description would merely echo the type label (the reference
  // quantity / base / percentage are shown in their own columns). Only kept for
  // genuinely disambiguating info not carried by another column (e.g. the year
  // for a 13º that crosses the notice projection, a CLT article note).
  description: string | null;
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

/**
 * Fixed-term / experiência early-termination types BY THE EMPLOYEE: the worker
 * owes the art. 480 indemnity (≤ ½ of the remaining-contract salary).
 */
export const ART480_EMPLOYEE_TYPES: TERMINATION_TYPE[] = [
  TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYEE,
  TERMINATION_TYPE.FIXED_TERM_EARLY_EMPLOYEE,
];

export interface TaxableVerbas {
  /** Saldo de salário (tributável). */
  salaryBalance: number;
  /** Aviso prévio TRABALHADO (tributável). Indenizado é isento. */
  workedNotice: number;
  /** 13º proporcional/rescisório (base exclusiva de INSS/IRRF). */
  thirteenth: number;
}

export interface TaxAssistResult {
  /** Base de INSS do mês (saldo + aviso trabalhado), tributável. */
  monthlyInssBase: number;
  /** INSS sobre a base mensal tributável. */
  monthlyInss: number;
  /** IRRF sobre a base mensal tributável (já deduzido o INSS). */
  monthlyIrrf: number;
  /** Base exclusiva de INSS do 13º. */
  thirteenthInssBase: number;
  /** INSS sobre o 13º (base exclusiva). */
  thirteenthInss: number;
  /** IRRF sobre o 13º (base exclusiva). */
  thirteenthIrrf: number;
  /** INSS total a descontar (mensal + 13º). */
  totalInss: number;
  /** IRRF total a descontar (mensal + 13º). */
  totalIrrf: number;
  /** Base da multa do FGTS (saldo informado + 8% sobre aviso indenizado + 13º). */
  fgtsFineBase: number;
}

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
   * Actual days worked in the termination month. For a mid-month admission, the
   * count starts at the admission day (so an employee admitted on the 12th and
   * terminated on the 20th of the same month worked 9 days, not 20). Otherwise
   * the count runs from the 1st to the termination day inclusive.
   */
  daysWorkedInTerminationMonth(terminationDate: Date, admissionDate: Date | null): number {
    const end = startOfDay(terminationDate);
    let from = new Date(end.getFullYear(), end.getMonth(), 1);
    if (
      admissionDate &&
      startOfDay(admissionDate).getFullYear() === end.getFullYear() &&
      startOfDay(admissionDate).getMonth() === end.getMonth()
    ) {
      from = startOfDay(admissionDate);
    }
    if (from > end) return 0;
    return diffDaysInclusive(from, end);
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
   * Effective termination type after applying the art. 481 cláusula
   * assecuratória: an early fixed-term/experiência termination carrying the
   * clause follows the INDETERMINATE regime. Employer-side early termination →
   * WITHOUT_CAUSE; employee-side → RESIGNATION. Other types are unchanged.
   */
  private resolveType(input: TerminationCalculationInput): TERMINATION_TYPE {
    if (!input.hasArt481Clause) return input.type;
    switch (input.type) {
      case TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYER:
        return TERMINATION_TYPE.WITHOUT_CAUSE;
      case TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYEE:
      case TERMINATION_TYPE.FIXED_TERM_EARLY_EMPLOYEE:
        return TERMINATION_TYPE.RESIGNATION;
      default:
        return input.type;
    }
  }

  /**
   * Computes the auto-calculated verbas for a termination, applying the
   * verbas-per-type matrix. Custom items (isCustom) are never produced here.
   */
  calculate(input: TerminationCalculationInput): ComputedTerminationItem[] {
    const { baseRemuneration, terminationDate } = input;

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

    // Art. 481 cláusula assecuratória — early fixed-term/experiência follows the
    // indeterminate regime (aviso + 40% FGTS, no art. 479/480).
    const type = this.resolveType(input);
    const isArt481 = input.hasArt481Clause === true && type !== input.type;

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

    // --- SALARY_BALANCE (all types) — actual days worked this month ---
    const daysWorked = this.daysWorkedInTerminationMonth(terminationDate, input.exp1StartAt);
    items.push({
      type: TERMINATION_ITEM_TYPE.SALARY_BALANCE,
      // Days worked are shown in the Referência column — no echo description.
      description: null,
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
        // Days are in the Referência column; only the mutual-agreement 50% rule
        // adds non-column info worth keeping.
        description: isMutualAgreement
          ? 'Acordo mútuo: 50% (CLT 484-A)'
          : null,
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
        description: 'Aviso prévio não cumprido (CLT 487 §2º)',
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
            // Avos are in the Referência column; keep only the year when the
            // notice projection splits the 13º across two calendar years.
            description: crossesYear ? `Ano ${year}` : null,
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
        // Periods are in the Referência column; the +1/3 is part of the label.
        description: null,
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
          // Avos are in the Referência column; the +1/3 is part of the label.
          description: null,
          referenceQuantity: vacationMonths,
          baseValue: br,
          amount: round2((br / 12) * vacationMonths * (4 / 3)),
          isCustom: false,
        });
      }
    }

    // --- FGTS_FINE: 40% (WITHOUT_CAUSE/INDIRECT/EXPERIENCE_EARLY_EMPLOYER),
    //     20% (MUTUAL_AGREEMENT). An art. 481 early termination already maps to
    //     WITHOUT_CAUSE above, so it picks up the 40% fine here. INTERMITTENT_END
    //     and resignation/just-cause/death pay no fine. ---
    const fgtsFinePercent =
      type === TERMINATION_TYPE.WITHOUT_CAUSE ||
      type === TERMINATION_TYPE.INDIRECT ||
      type === TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYER
        ? 0.4
        : type === TERMINATION_TYPE.MUTUAL_AGREEMENT
          ? 0.2
          : null;
    if (fgtsFinePercent !== null && input.fgtsBalance && input.fgtsBalance > 0) {
      // The multa incides over the FGTS base, not the raw informed balance:
      // saldo + 8% over the projeção do aviso indenizado + 8% over the rescisão
      // 13º (Súmula TST 305 / Lei 8.036 art. 15 §1º). These verbas were already
      // pushed above, so read them back from `items` to keep the base in sync
      // with computeTaxAssist's fgtsFineBase (single source of truth for the
      // formula).
      const sumOf = (t: TERMINATION_ITEM_TYPE) =>
        items.filter(i => i.type === t).reduce((s, i) => s + i.amount, 0);
      const indemnifiedNotice = Math.max(
        0,
        sumOf(TERMINATION_ITEM_TYPE.NOTICE_INDEMNIFIED),
      );
      const thirteenth = Math.max(
        0,
        sumOf(TERMINATION_ITEM_TYPE.THIRTEENTH_PROPORTIONAL),
      );
      const fgtsFineBase = round2(
        input.fgtsBalance + 0.08 * (indemnifiedNotice + thirteenth),
      );
      items.push({
        type: TERMINATION_ITEM_TYPE.FGTS_FINE,
        // Percentage is in the Referência column, base in the Base column.
        description: null,
        referenceQuantity: fgtsFinePercent * 100,
        baseValue: fgtsFineBase,
        amount: round2(fgtsFineBase * fgtsFinePercent),
        isCustom: false,
      });
    }

    // Remaining days of the fixed-term/experiência contract after termination.
    const remainingFixedTermDays = ((): number => {
      if (!input.experienceEndAt) return 0;
      const expEnd = startOfDay(input.experienceEndAt);
      return expEnd > end ? Math.floor((expEnd.getTime() - end.getTime()) / DAY_MS) : 0;
    })();

    // --- ART479_INDEMNITY (EXPERIENCE_EARLY_EMPLOYER only; suppressed under art. 481) ---
    if (
      !isArt481 &&
      input.type === TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYER &&
      remainingFixedTermDays > 0
    ) {
      items.push({
        type: TERMINATION_ITEM_TYPE.ART479_INDEMNITY,
        description: 'Art. 479 CLT — 50% dos dias restantes da experiência',
        referenceQuantity: remainingFixedTermDays,
        baseValue: br,
        amount: round2(0.5 * dailyRate * remainingFixedTermDays),
        isCustom: false,
      });
    }

    // --- ART480_INDEMNITY (employee breaks the fixed-term/experiência early) ---
    // Owed BY THE EMPLOYEE: ≤ ½ of the remaining-contract salary (CLT 480 §1º).
    // Lanced as a DISCOUNT line. Suppressed when art. 481 maps to the
    // indeterminate regime (then the unworked-notice discount applies instead).
    if (
      !isArt481 &&
      ART480_EMPLOYEE_TYPES.includes(input.type) &&
      remainingFixedTermDays > 0
    ) {
      items.push({
        type: TERMINATION_ITEM_TYPE.ART479_INDEMNITY,
        description: 'Art. 480 CLT — devida pelo empregado (50% dos dias restantes)',
        referenceQuantity: remainingFixedTermDays,
        baseValue: br,
        amount: -round2(0.5 * dailyRate * remainingFixedTermDays),
        isCustom: false,
      });
    }

    return items;
  }

  /**
   * Tax/FGTS assist (CLT / Lei 8.212 / Lei 7.713). Auto-computes INSS/IRRF on the
   * TAXABLE verbas only and the FGTS-multa base. EXEMPT verbas — férias
   * indenizadas (vencidas/proporcionais + 1/3), aviso prévio INDENIZADO and the
   * multa do FGTS — must NEVER be passed in here; the caller derives the taxable
   * set from the computed items. INSS/IRRF on the monthly verbas (saldo + aviso
   * trabalhado) and on the 13º are computed on SEPARATE bases (13º has its own
   * exclusive base, Súmula TST 688 / RFB).
   *
   * FGTS-multa base = informed FGTS balance + 8% over the projeção do aviso
   * indenizado + 8% over the rescisão 13º (both integrate the FGTS base, Súmula
   * TST 305 / Lei 8.036 art. 15 §1º).
   */
  computeTaxAssist(input: {
    taxable: TaxableVerbas;
    fgtsBalance: number | null;
    /** Aviso prévio indenizado (projeção) — integra a base da multa do FGTS. */
    indemnifiedNotice: number;
    dependentsCount?: number;
    year?: number;
  }): TaxAssistResult {
    const year = input.year ?? new Date().getFullYear();
    const dependentsCount = Math.max(0, input.dependentsCount ?? 0);
    const inssTable = getInssTableForYear(year);
    const irrfTable = getIrrfTableForYear(year);

    const salaryBalance = Math.max(0, round2(input.taxable.salaryBalance));
    const workedNotice = Math.max(0, round2(input.taxable.workedNotice));
    const thirteenth = Math.max(0, round2(input.taxable.thirteenth));

    // --- Monthly taxable base: saldo + aviso TRABALHADO ---
    const monthlyInssBase = round2(salaryBalance + workedNotice);
    const monthlyInss = computeProgressiveINSS(monthlyInssBase, inssTable.brackets).total;
    const monthlyIrrf = computeIRRF({
      taxableGross: monthlyInssBase,
      inssAmount: monthlyInss,
      dependentsCount,
      allowSimplifiedDeduction: true,
      table: irrfTable,
    }).tax;

    // --- 13º exclusive base ---
    const thirteenthInssBase = thirteenth;
    const thirteenthInss =
      thirteenthInssBase > 0
        ? computeProgressiveINSS(thirteenthInssBase, inssTable.brackets).total
        : 0;
    const thirteenthIrrf =
      thirteenthInssBase > 0
        ? computeIRRF({
            taxableGross: thirteenthInssBase,
            inssAmount: thirteenthInss,
            dependentsCount,
            allowSimplifiedDeduction: true,
            table: irrfTable,
          }).tax
        : 0;

    // --- FGTS-multa base: saldo informado + 8% (aviso indenizado + 13º) ---
    const indemnifiedNotice = Math.max(0, round2(input.indemnifiedNotice));
    const fgtsOnProjections = round2(0.08 * (indemnifiedNotice + thirteenth));
    const fgtsFineBase = round2((input.fgtsBalance ?? 0) + fgtsOnProjections);

    return {
      monthlyInssBase,
      monthlyInss,
      monthlyIrrf,
      thirteenthInssBase,
      thirteenthInss,
      thirteenthIrrf,
      totalInss: round2(monthlyInss + thirteenthInss),
      totalIrrf: round2(monthlyIrrf + thirteenthIrrf),
      fgtsFineBase,
    };
  }
}

/**
 * Estabilidade guard predicate. Part E exports an equivalent
 * `isUnderStability(contract, date)` from src/utils/contract-stability.ts; until
 * that util lands at integration time, this inline check on
 * stabilityStart/stabilityEnd is used. A dismissal WITHOUT cause must be blocked
 * when the worker is inside a stability window (acidentária/gestante/etc.).
 */
export const isUnderStability = (
  contract: { stabilityStart?: Date | null; stabilityEnd?: Date | null } | null | undefined,
  date: Date,
): boolean => {
  if (!contract) return false;
  const { stabilityStart, stabilityEnd } = contract;
  if (!stabilityStart && !stabilityEnd) return false;
  const ref = startOfDay(date).getTime();
  const start = stabilityStart ? startOfDay(stabilityStart).getTime() : -Infinity;
  const end = stabilityEnd ? startOfDay(stabilityEnd).getTime() : Infinity;
  return ref >= start && ref <= end;
};
