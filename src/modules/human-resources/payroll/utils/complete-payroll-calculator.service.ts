import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BrazilianTaxCalculatorService } from './brazilian-tax-calculator.service';
import {
  SecullumPayrollIntegrationService,
  SecullumPayrollData,
} from '../services/secullum-payroll-integration.service';
import { InsalubrityDegree, PayrollDiscountType } from '@prisma/client';
import { roundCurrency } from '@utils/currency-precision.util';
import { calculateEmployeeShare, isSalaryUnknownForShare } from '@utils/benefit-discount';
import { getSalarioFamiliaTableForYear, computeSalarioFamilia } from './tax-tables';

/**
 * Salário-mínimo nacional por ano de vigência (base da insalubridade — NR-15 incide
 * sobre o salário-mínimo, Súmula 228 TST / posição vinculante). Anos futuros usam o
 * último publicado. NOTA: tax-tables.ts é frozen (Phase 1), por isso a constante vive
 * aqui; mantê-la sincronizada com a portaria do salário-mínimo de cada ano.
 *  - 2025: Decreto 12.342/2024 — R$ 1.518,00
 *  - 2026: MP do salário-mínimo 2026 — R$ 1.621,00 (coincide com a 1ª faixa do INSS)
 */
const MINIMUM_WAGE_BY_YEAR: Array<{ year: number; value: number }> = [
  { year: 2025, value: 1518.0 },
  { year: 2026, value: 1621.0 },
];

function getMinimumWageForYear(year: number): number {
  const sorted = [...MINIMUM_WAGE_BY_YEAR].sort((a, b) => a.year - b.year);
  let chosen = sorted[0].value;
  for (const row of sorted) {
    if (row.year <= year) chosen = row.value;
  }
  return chosen;
}

/** Percentual do adicional de insalubridade por grau (NR-15) sobre o salário-mínimo. */
function insalubrityPercent(degree: InsalubrityDegree | null | undefined): number {
  switch (degree) {
    case InsalubrityDegree.MIN:
      return 0.1;
    case InsalubrityDegree.MED:
      return 0.2;
    case InsalubrityDegree.MAX:
      return 0.4;
    default:
      return 0;
  }
}

/**
 * ============================================================================
 * COMPLETE PAYROLL CALCULATOR SERVICE
 * ============================================================================
 * Orchestrates FULL Brazilian payroll calculation including:
 *
 * EARNINGS:
 * - Base salary
 * - Overtime 50% (Mon-Sat)
 * - Overtime 100% (Sundays/Holidays)
 * - Night shift differential (20%)
 * - DSR on overtime and bonifications
 * - Bonuses
 *
 * DEDUCTIONS:
 * - INSS (Progressive)
 * - IRRF (Progressive)
 * - Absences (hours)
 * - Late arrivals
 * - Advance payments
 * - Meal vouchers
 * - Transport vouchers
 * - Health/Dental insurance
 * - Union contribution
 * - Alimony
 * - Loans
 * - Garnishments
 * - Custom deductions
 *
 * EMPLOYER CONTRIBUTIONS (tracked):
 * - FGTS (8%)
 * ============================================================================
 */

export interface CompletePayrollCalculation {
  // Employee info
  employeeId: string;
  year: number;
  month: number;

  // ========== EARNINGS ==========
  baseSalary: number;
  overtimeEarnings: {
    overtime50Hours: number;
    overtime50Amount: number;
    overtime100Hours: number;
    overtime100Amount: number;
    nightHours: number;
    nightDifferentialAmount: number;
  };
  dsrEarnings: {
    dsrOnOvertime: number;
    dsrOnBonifications: number;
    totalDSR: number;
    dsrDays: number;
  };
  bonusAmount: number;
  /**
   * Proventos legais adicionais (adicionais de insalubridade/periculosidade,
   * salário-família, gratificação habitual). Materializados como linhas de
   * provento na folha pelo auto-discount service.
   */
  additionalEarnings: {
    /** Salário-família (R$/cota × filhos elegíveis), pró-rata por dias no mês. */
    familyAllowance: number;
    familyAllowanceQuota: number;
    eligibleChildren: number;
    /** Adicional de insalubridade (% × salário-mínimo), pró-rata. */
    insalubrity: number;
    insalubrityPercent: number;
    /** Adicional de periculosidade (30% × salário-base), pró-rata. */
    hazardPay: number;
  };
  otherEarnings: number;
  grossSalary: number; // Total before deductions

  // ========== DEDUCTIONS ==========
  taxDeductions: {
    inssBase: number;
    inssAmount: number;
    inssEffectiveRate: number;
    irrfBase: number;
    irrfAmount: number;
    irrfEffectiveRate: number;
  };
  absenceDeductions: {
    absenceHours: number;
    absenceDays: number;
    /** Apenas as faltas INJUSTIFICADAS (dias) que efetivamente descontam. */
    unjustifiedAbsenceDays: number;
    justifiedAbsenceDays: number;
    absenceAmount: number;
    /** Parcela do desconto referente à perda proporcional do DSR. */
    absenceDsrLoss: number;
    lateArrivalMinutes: number;
    lateArrivalAmount: number;
  };
  benefitDeductions: {
    mealVoucher: number;
    transportVoucher: number;
    healthInsurance: number;
    dentalInsurance: number;
    /** Coparticipações de outros benefícios (farmácia, convênios, seguro de vida…). */
    otherBenefits: number;
  };
  /**
   * Coparticipações derivadas das adesões ATIVAS (UserBenefit) via regra
   * canônica de @utils/benefit-discount — uma linha por adesão, para que a
   * folha salva/ao vivo materialize cada desconto individualmente.
   */
  benefitCopayItems: Array<{
    userBenefitId: string;
    benefitKind: string;
    benefitName: string;
    discountType: PayrollDiscountType;
    amount: number;
    monthlyValue: number;
  }>;
  legalDeductions: {
    unionContribution: number;
    alimony: number;
    garnishment: number;
  };
  loanDeductions: {
    loans: number;
    advances: number;
  };
  customDeductions: number;
  totalDeductions: number;

  // ========== NET SALARY ==========
  netSalary: number;

  // ========== EMPLOYER CONTRIBUTIONS ==========
  employerContributions: {
    fgtsAmount: number;
    fgtsRate: number;
  };

  // ========== SECULLUM DATA ==========
  secullumData?: SecullumPayrollData;

  // ========== CALCULATION METADATA ==========
  calculationDate: Date;
  workingDaysInMonth: number;
  workedDays: number;
  /**
   * Avos / proration factor (0..1) applied to base salary, salário-família e
   * adicionais no mês de admissão/desligamento (dias trabalhados ÷ dias do mês).
   * 1 = mês cheio.
   */
  prorationFactor: number;
  isLive: boolean; // Is this a live calculation or saved?
  /**
   * Avisos não-fatais (ex.: descontos excederam o bruto e foram limitados;
   * margem consignável estourada e ajustada). Exibidos no holerite.
   */
  warnings: string[];
}

export interface CalculatePayrollParams {
  employeeId: string;
  year: number;
  month: number;
  baseSalary: number;
  bonusAmount?: number;

  // Secullum resolution via User.secullumEmployeeId FK. Null skips the Secullum step.
  secullumEmployeeId: number | null;

  dependentsCount?: number;
  useSimplifiedDeduction?: boolean;
  unionMember?: boolean;
  isApprentice?: boolean;

  /**
   * Filhos elegíveis ao salário-família (≤14 anos ou inválidos, com
   * salarioFamilia=true). O caller resolve a contagem a partir de Dependent.
   */
  salarioFamiliaChildren?: number;

  /**
   * Insalubridade/periculosidade (NR-15/NR-16). Resolvidos pelo caller a partir
   * de Position com override do EmploymentContract. Mutuamente exclusivos —
   * se ambos vierem, insalubridade tem precedência e periculosidade é ignorada.
   */
  insalubrityDegree?: InsalubrityDegree | null;
  hazardPay?: boolean;

  /**
   * Plano de saúde dedutível do IRRF: parcela do titular + soma de
   * Dependent.healthPlanValue dos dependentes inscritos. Subtraída da base
   * de IRRF (Lei 9.250/95 art. 8º, II, "a"/"g"). O caller resolve o valor.
   */
  healthPlanIrrfDeductible?: number;

  /**
   * Proporcionalidade (avos) por admissão/desligamento no mês. Quando o
   * vínculo começou/terminou no meio do mês, informe os dias efetivamente
   * cobertos pelo vínculo no mês. NULL/undefined = mês cheio.
   */
  daysCoveredInMonth?: number | null;
  daysInMonth?: number | null;

  // Optional: Override Secullum data (for testing/manual entry)
  overrideSecullumData?: Partial<SecullumPayrollData>;

  // Persistent discounts (alimony, health insurance, etc.)
  persistentDiscounts?: Array<{
    type: PayrollDiscountType;
    value?: number;
    percentage?: number;
    reference: string;
  }>;
}

@Injectable()
export class CompletePayrollCalculatorService {
  private readonly logger = new Logger(CompletePayrollCalculatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxCalculator: BrazilianTaxCalculatorService,
    private readonly secullumIntegration: SecullumPayrollIntegrationService,
  ) {}

  /**
   * ========================================================================
   * CALCULATE COMPLETE PAYROLL
   * ========================================================================
   * Main orchestrator - calculates everything
   */
  async calculateCompletePayroll(
    params: CalculatePayrollParams,
  ): Promise<CompletePayrollCalculation> {
    const {
      employeeId,
      year,
      month,
      baseSalary,
      bonusAmount = 0,
      secullumEmployeeId,
      dependentsCount = 0,
      useSimplifiedDeduction = true,
      unionMember = false,
      isApprentice = false,
      salarioFamiliaChildren = 0,
      insalubrityDegree = null,
      hazardPay = false,
      healthPlanIrrfDeductible = 0,
      daysCoveredInMonth = null,
      daysInMonth = null,
      overrideSecullumData,
      persistentDiscounts = [],
    } = params;

    const warnings: string[] = [];

    this.logger.log(`Calculating complete payroll for employee ${employeeId} - ${year}/${month}`);

    // ========================================================================
    // STEP 1: GET SECULLUM DATA (hours, overtime, absences)
    // ========================================================================
    let secullumData: SecullumPayrollData | undefined;

    if (secullumEmployeeId != null) {
      try {
        secullumData = await this.secullumIntegration.getPayrollDataFromSecullum({
          employeeId,
          secullumEmployeeId,
          year,
          month,
        });

        // Apply overrides if provided
        if (overrideSecullumData) {
          secullumData = { ...secullumData, ...overrideSecullumData };
        }
      } catch (error) {
        this.logger.error(`Error fetching Secullum data for ${employeeId}:`, error);
      }
    } else {
      this.logger.warn(
        `No secullumEmployeeId on User ${employeeId} — skipping Secullum integration`,
      );
    }

    // ========================================================================
    // STEP 2: CALCULATE EARNINGS
    // ========================================================================

    // ----- Mid-month proration (avos) -----------------------------------
    // When the vínculo started/ended mid-month, base salary, salário-família
    // and the adicionais are paid pro-rata to the days the bond covered.
    // daysCoveredInMonth/daysInMonth come from the caller (admission/term dates).
    const calendarDaysInMonth = daysInMonth && daysInMonth > 0 ? daysInMonth : new Date(year, month, 0).getDate();
    const coveredDays =
      daysCoveredInMonth != null && daysCoveredInMonth >= 0
        ? Math.min(daysCoveredInMonth, calendarDaysInMonth)
        : calendarDaysInMonth;
    const prorationFactor =
      calendarDaysInMonth > 0 ? Math.min(1, coveredDays / calendarDaysInMonth) : 1;
    if (prorationFactor < 1) {
      this.logger.debug(
        `Mid-month proration for ${employeeId}: ${coveredDays}/${calendarDaysInMonth} days = ${prorationFactor.toFixed(4)}`,
      );
    }

    // Base salary — pro-rated by avos in admission/termination months.
    const base = roundCurrency(baseSalary * prorationFactor);

    // Calculate hourly rate (for overtime calculation). The hourly rate uses the
    // FULL monthly salary (not the prorated base) — overtime is paid on the real
    // contractual hourly wage regardless of how many days were worked.
    // CRITICAL: Brazilian CLT standard is 220 hours/month (44 hours/week ÷ 6 days × 30 days)
    // Formula: Monthly Salary ÷ 220 hours = Hourly Rate
    const workingDaysInMonth = secullumData?.workingDaysInMonth || 22;
    const workedDays = secullumData?.workedDays || workingDaysInMonth;
    const monthlyHours = 220; // CLT Article 7, XIII - 220 hours/month standard
    const hourlyRate = baseSalary / monthlyHours;

    this.logger.debug(
      `Hourly rate calculation: R$ ${base.toFixed(2)} ÷ ${monthlyHours} hrs = R$ ${hourlyRate.toFixed(4)}/hr`,
    );

    // Overtime calculations
    const overtime50Hours = secullumData?.overtime50 || 0;
    const overtime50Amount = roundCurrency(overtime50Hours * hourlyRate * 1.5);

    const overtime100Hours = secullumData?.overtime100 || 0;
    const overtime100Amount = roundCurrency(overtime100Hours * hourlyRate * 2.0);

    // Night shift differential (20% adicional noturno - Art. 73 CLT).
    //
    // DECISÃO (hora noturna reduzida 52'30"): a Secullum já entrega as horas
    // noturnas EXPANDIDAS pela razão 8/7 (a hora-relógio noturna vale 1h07'30"
    // de hora normal) na coluna de adicional noturno — é a configuração padrão
    // do relógio de ponto (parâmetro "Hora noturna reduzida" ativo). Portanto
    // NÃO reaplicamos o fator ×8/7 aqui para evitar dupla expansão; apenas o
    // adicional de 20% incide sobre as horas já expandidas. Se o cliente
    // desativar a hora reduzida na Secullum, ative `expandNightHours` para
    // multiplicar nightHours por 8/7 antes do adicional.
    const expandNightHours = false;
    const nightHours = secullumData?.nightHours || 0;
    const nightHoursForPay = expandNightHours
      ? roundCurrency((nightHours * 8) / 7)
      : nightHours;
    const nightDifferentialAmount = roundCurrency(nightHoursForPay * hourlyRate * 0.2);

    // DSR on overtime + night differential (required by law — habitual variables
    // reflect on the weekly paid rest). Holidays are now fed in real (não mais 0).
    const totalOvertimeAmount = overtime50Amount + overtime100Amount + nightDifferentialAmount;
    const sundays = secullumData?.sundays || 4;
    const holidays = secullumData?.holidays || 0;
    const dsrDays = sundays + holidays;
    const dsrOnOvertime =
      workingDaysInMonth > 0
        ? roundCurrency((totalOvertimeAmount / workingDaysInMonth) * dsrDays)
        : 0;

    // Bonus (from bonus calculation)
    const bonus = bonusAmount;

    // DSR sobre bonificações habituais (Súmula 225 TST). A bonificação de
    // produção é uma verba variável habitual; quando há, o DSR proporcional é
    // devido. Computado (antes era hardcoded 0).
    const dsrOnBonifications =
      bonus > 0 && workingDaysInMonth > 0
        ? roundCurrency((bonus / workingDaysInMonth) * dsrDays)
        : 0;
    const totalDSR = roundCurrency(dsrOnOvertime + dsrOnBonifications);

    // ----- Adicionais legais (insalubridade / periculosidade) ------------
    // NR-15: insalubridade = 10/20/40% × salário-mínimo nacional.
    // NR-16: periculosidade = 30% × salário-base. Mutuamente exclusivos —
    // insalubridade tem precedência se ambos vierem marcados.
    const minimumWage = getMinimumWageForYear(year);
    const insalPercent = insalubrityPercent(insalubrityDegree);
    let insalubrityAmount = 0;
    let hazardPayAmount = 0;
    if (insalPercent > 0) {
      insalubrityAmount = roundCurrency(minimumWage * insalPercent * prorationFactor);
    } else if (hazardPay) {
      // periculosidade incide sobre o salário-base (não sobre o mínimo)
      hazardPayAmount = roundCurrency(baseSalary * 0.3 * prorationFactor);
    }

    // ----- Salário-família ------------------------------------------------
    // R$/cota por filho ≤14/inválido quando a remuneração mensal ≤ limite da
    // portaria. A "remuneração" para o teste de elegibilidade é o salário-base
    // (cheio, não pró-rata) — o benefício em si é pago pró-rata aos dias.
    const salarioFamiliaTable = getSalarioFamiliaTableForYear(year);
    const familyAllowanceFull = computeSalarioFamilia(
      baseSalary,
      salarioFamiliaChildren,
      salarioFamiliaTable,
    );
    const familyAllowance = roundCurrency(familyAllowanceFull * prorationFactor);

    // Other earnings (reserved for future verbas)
    const otherEarnings = 0;

    // GROSS SALARY.
    // NOTE: salário-família NÃO integra o bruto tributável (benefício
    // previdenciário isento de INSS/IRRF/FGTS) — somado ao líquido depois.
    // Insalubridade/periculosidade SÃO tributáveis.
    const grossSalary = roundCurrency(
      base +
        overtime50Amount +
        overtime100Amount +
        nightDifferentialAmount +
        totalDSR +
        bonus +
        insalubrityAmount +
        hazardPayAmount +
        otherEarnings,
    );

    // ========================================================================
    // STEP 3: CALCULATE ABSENCE DEDUCTIONS (before taxes — they reduce the
    // remuneration due, which is the legal base for INSS/IRRF)
    // ========================================================================

    // Faltas: apenas as INJUSTIFICADAS descontam (dia + DSR proporcional). As
    // justificadas (atestado/abono) NÃO geram perda — a Secullum classifica via
    // justificativa (ver secullum-payroll-integration parse). Convertemos as
    // horas injustificadas em dias (÷ jornada diária real, não ÷8 fixo) e
    // delegamos ao cálculo canônico calculateAbsenceDeduction (antes era código
    // morto: o desconto era feito por horas cruas, sem a perda de DSR).
    const totalAbsenceHours = secullumData?.absenceHours || 0;
    const justifiedAbsenceHours = secullumData?.justifiedAbsenceHours || 0;
    const unjustifiedAbsenceHours = Math.max(
      0,
      secullumData?.unjustifiedAbsenceHours ?? totalAbsenceHours - justifiedAbsenceHours,
    );

    // Jornada diária = 220h/mês ÷ dias úteis do mês (≈ 7,33h em 30 dias, ≈8h em
    // jornada 5×8). Mais fiel que o ceil(/8) hardcode antigo.
    const dailyHours = workingDaysInMonth > 0 ? monthlyHours / workingDaysInMonth : 8;
    const unjustifiedAbsenceDays =
      dailyHours > 0 ? roundCurrency(unjustifiedAbsenceHours / dailyHours) : 0;
    const justifiedAbsenceDays =
      dailyHours > 0 ? roundCurrency(justifiedAbsenceHours / dailyHours) : 0;

    const absenceResult = this.taxCalculator.calculateAbsenceDeduction({
      monthlySalary: baseSalary,
      workingDaysInMonth,
      unjustifiedAbsenceDays,
      sundaysInMonth: sundays,
      holidaysInMonth: holidays,
    });
    const absenceAmount = roundCurrency(absenceResult.amount);
    const absenceDsrLoss = roundCurrency((absenceResult.details as any)?.dsrLoss || 0);
    // Total absence days/hours kept for display (justified + unjustified).
    const absenceHours = totalAbsenceHours;
    const absenceDays =
      dailyHours > 0 ? roundCurrency(totalAbsenceHours / dailyHours) : 0;

    // Late arrivals
    const lateMinutes = secullumData?.lateArrivalMinutes || 0;
    const lateArrivalAmount = roundCurrency((lateMinutes / 60) * hourlyRate);

    // ========================================================================
    // STEP 4: CALCULATE TAX DEDUCTIONS
    // ========================================================================

    // Salário de contribuição / rendimentos tributáveis do mês: remuneração
    // efetivamente devida (bruto MENOS faltas injustificadas e atrasos). O
    // salário-família já está FORA do bruto (isento). Insalubridade/periculo-
    // sidade e gratificação habitual ESTÃO no bruto, portanto integram a base.
    const taxableEarnings = roundCurrency(
      Math.max(0, grossSalary - absenceAmount - lateArrivalAmount),
    );

    // INSS (Progressive) — incide sobre a remuneração devida.
    const inssResult = await this.taxCalculator.calculateINSS(taxableEarnings, year);
    const inssAmount = roundCurrency(inssResult.amount);
    const inssBase = taxableEarnings;
    const inssEffectiveRate = inssResult.rate || 0;

    // Pensão alimentícia (resolvida cedo) — deduz da BASE de IRRF (não só do
    // líquido). É % do bruto OU valor fixo, conforme a sentença.
    const alimony = this.getDiscountAmount(
      persistentDiscounts,
      PayrollDiscountType.ALIMONY,
      0,
      grossSalary,
    );

    // Plano de saúde dedutível de IRRF: titular + Σ Dependent.healthPlanValue
    // (Lei 9.250/95 art. 8º). Vem resolvido pelo caller.
    const healthPlanDeduction = roundCurrency(Math.max(0, healthPlanIrrfDeductible));

    // IRRF (Progressive, after INSS). A base é reduzida por pensão alimentícia E
    // plano de saúde ANTES da tabela. O helper computeIRRF já escolhe a maior
    // dedução entre (INSS + dependentes) e o simplificado; pensão+plano são
    // deduções legais adicionais (path itemizado), então as subtraímos do bruto
    // tributável passado ao helper. Quando o simplificado é mais benéfico, ele
    // NÃO admite pensão/plano — o helper compara e usa o melhor cenário.
    const irrfLegalExtraDeductions = roundCurrency(alimony + healthPlanDeduction);
    const irrfResult = await this.taxCalculator.calculateIRRF(
      roundCurrency(Math.max(0, taxableEarnings - irrfLegalExtraDeductions)),
      inssAmount,
      dependentsCount,
      // Com pensão/plano (deduções legais que o simplificado não admite),
      // forçamos o path itemizado para não perder essas deduções.
      irrfLegalExtraDeductions > 0 ? false : useSimplifiedDeduction,
      year,
    );
    const irrfAmount = roundCurrency(irrfResult.amount);
    const irrfBase = irrfResult.base;
    const irrfEffectiveRate = irrfResult.rate || 0;

    // ========================================================================
    // STEP 5: CALCULATE BENEFIT DEDUCTIONS
    // ========================================================================

    // Manual/persistent rows first (copied month-to-month on the payroll)
    let mealVoucher = this.getDiscountAmount(
      persistentDiscounts,
      PayrollDiscountType.MEAL_VOUCHER,
      0,
    );
    let transportVoucher = this.getDiscountAmount(
      persistentDiscounts,
      PayrollDiscountType.TRANSPORT_VOUCHER,
      0,
    );
    let healthInsurance = this.getDiscountAmount(
      persistentDiscounts,
      PayrollDiscountType.HEALTH_INSURANCE,
      0,
    );
    let dentalInsurance = this.getDiscountAmount(
      persistentDiscounts,
      PayrollDiscountType.DENTAL_INSURANCE,
      0,
    );
    let otherBenefits = 0;

    // Coparticipações das adesões ATIVAS (UserBenefit) — regra canônica em
    // @utils/benefit-discount (VT: % do salário-base limitado ao custo;
    // demais: % do custo do benefício; valor fixo limitado ao custo).
    // Para evitar dupla contagem, uma adesão só entra quando NÃO existe
    // desconto persistente manual do mesmo PayrollDiscountType.
    const benefitCopayItems: CompletePayrollCalculation['benefitCopayItems'] = [];
    try {
      const activeBenefits = await this.prisma.userBenefit.findMany({
        where: { userId: employeeId, status: 'ACTIVE' },
        include: { benefit: true },
      });

      const persistentTypes = new Set(persistentDiscounts.map(d => d.type));
      const mapKindToDiscountType = (kind: string): PayrollDiscountType => {
        switch (kind) {
          case 'TRANSPORT_VOUCHER':
            return PayrollDiscountType.TRANSPORT_VOUCHER;
          case 'MEAL_VOUCHER':
          case 'FOOD_VOUCHER':
            return PayrollDiscountType.MEAL_VOUCHER;
          case 'HEALTH_PLAN':
            return PayrollDiscountType.HEALTH_INSURANCE;
          case 'DENTAL_PLAN':
            return PayrollDiscountType.DENTAL_INSURANCE;
          default:
            return PayrollDiscountType.AUTHORIZED_DISCOUNT;
        }
      };

      for (const enrollment of activeBenefits) {
        const kind = enrollment.benefit?.kind as string;
        const discountType = mapKindToDiscountType(kind);

        // Persistent manual row of the same type takes precedence
        if (persistentTypes.has(discountType)) continue;

        const shareRule = {
          monthlyValue: enrollment.monthlyValue,
          employeeDiscountValue: enrollment.employeeDiscountValue,
          employeeDiscountPercent: enrollment.employeeDiscountPercent,
          benefitKind: kind,
        };
        const share = roundCurrency(calculateEmployeeShare(shareRule, baseSalary));
        if (share <= 0) {
          // VT %-do-salário sem salário-base conhecido: o desconto calcula 0,
          // mas NÃO porque é zero — falta o salário. Não silenciar: avisar no
          // holerite para evitar cobrar a menos (benefit-discount.ts é a fonte
          // canônica dessa decisão via isSalaryUnknownForShare).
          if (isSalaryUnknownForShare(shareRule, baseSalary)) {
            warnings.push(
              `VT não descontado — salário-base desconhecido para a adesão "${
                enrollment.benefit?.name || 'Vale Transporte'
              }". Informe o salário-base para descontar o vale-transporte.`,
            );
          }
          continue;
        }

        switch (discountType) {
          case PayrollDiscountType.TRANSPORT_VOUCHER:
            transportVoucher = roundCurrency(transportVoucher + share);
            break;
          case PayrollDiscountType.MEAL_VOUCHER:
            mealVoucher = roundCurrency(mealVoucher + share);
            break;
          case PayrollDiscountType.HEALTH_INSURANCE:
            healthInsurance = roundCurrency(healthInsurance + share);
            break;
          case PayrollDiscountType.DENTAL_INSURANCE:
            dentalInsurance = roundCurrency(dentalInsurance + share);
            break;
          default:
            otherBenefits = roundCurrency(otherBenefits + share);
            break;
        }

        benefitCopayItems.push({
          userBenefitId: enrollment.id,
          benefitKind: kind,
          benefitName: enrollment.benefit?.name || 'Benefício',
          discountType,
          amount: share,
          monthlyValue: enrollment.monthlyValue,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Could not load active benefit enrollments for ${employeeId}: ${error instanceof Error ? error.message : error}`,
      );
    }

    // ========================================================================
    // STEP 6: CALCULATE LEGAL DEDUCTIONS
    // ========================================================================

    // Union contribution (only in March if member)
    const unionResult = this.taxCalculator.calculateUnionContribution({
      monthlySalary: baseSalary,
      workingDaysInMonth,
      hasAuthorization: unionMember,
      currentMonth: month,
    });
    const unionContribution = roundCurrency(unionResult.amount);

    // Alimony (pensão alimentícia) já resolvida no STEP 4 (deduz da base IRRF).

    // Garnishment (judicial)
    const garnishment = this.getDiscountAmount(
      persistentDiscounts,
      PayrollDiscountType.GARNISHMENT,
      0,
    );

    // ========================================================================
    // STEP 7: CALCULATE LOAN DEDUCTIONS
    // ========================================================================

    let loans = this.getDiscountAmount(persistentDiscounts, PayrollDiscountType.LOAN, 0);
    let advances = this.getDiscountAmount(persistentDiscounts, PayrollDiscountType.ADVANCE, 0);

    // ========================================================================
    // STEP 8: CALCULATE CUSTOM DEDUCTIONS
    // ========================================================================

    const customDeductions = this.getDiscountAmount(
      persistentDiscounts,
      PayrollDiscountType.CUSTOM,
      0,
    );

    // ========================================================================
    // STEP 9: NET BASE + MARGEM CONSIGNÁVEL (35%) + DEDUCTION CLAMP
    // ========================================================================
    // Salário-família é provento ISENTO somado ao líquido (não está no bruto).
    // Calculamos o líquido em duas etapas:
    //  (a) líquido-base = bruto + salário-família − (descontos legais/benefícios
    //      NÃO-consignáveis); essa é a base da margem consignável.
    //  (b) margem consignável = 35% do líquido-base limita LOAN+ADVANCE
    //      (empréstimo/adiantamento consignado, Lei 10.820/2003 + Dec.11.150/2022).

    const nonConsignableDeductions = roundCurrency(
      inssAmount +
        irrfAmount +
        absenceAmount +
        lateArrivalAmount +
        mealVoucher +
        transportVoucher +
        healthInsurance +
        dentalInsurance +
        otherBenefits +
        unionContribution +
        alimony +
        garnishment +
        customDeductions,
    );

    // Líquido-base para a margem (proventos tributáveis + salário-família − não-consignáveis)
    const netBaseForMargin = roundCurrency(grossSalary + familyAllowance - nonConsignableDeductions);

    // Margem consignável = 35% do líquido-base (nunca negativo).
    const CONSIGNABLE_MARGIN_RATE = 0.35;
    const consignableMargin = roundCurrency(Math.max(0, netBaseForMargin) * CONSIGNABLE_MARGIN_RATE);
    const requestedConsignado = roundCurrency(loans + advances);

    if (requestedConsignado > consignableMargin) {
      // Clamp: reduz primeiro ADVANCE, depois LOAN, até caber na margem.
      const excess = roundCurrency(requestedConsignado - consignableMargin);
      warnings.push(
        `Descontos consignados (empréstimo+adiantamento) R$ ${requestedConsignado.toFixed(2)} excedem a margem consignável de 35% (R$ ${consignableMargin.toFixed(2)}). Limitados em R$ ${excess.toFixed(2)}.`,
      );
      let remainingExcess = excess;
      const advanceCut = Math.min(advances, remainingExcess);
      advances = roundCurrency(advances - advanceCut);
      remainingExcess = roundCurrency(remainingExcess - advanceCut);
      if (remainingExcess > 0) {
        loans = roundCurrency(Math.max(0, loans - remainingExcess));
      }
    }

    // ========================================================================
    // STEP 9b: TOTAL DEDUCTIONS (after consignável clamp)
    // ========================================================================

    let totalDeductions = roundCurrency(nonConsignableDeductions + loans + advances);

    // ========================================================================
    // STEP 10: NET SALARY = max(0, bruto + salário-família − descontos)
    // ========================================================================

    let netSalary = roundCurrency(grossSalary + familyAllowance - totalDeductions);
    if (netSalary < 0) {
      warnings.push(
        `Os descontos (R$ ${totalDeductions.toFixed(2)}) excederam os proventos (R$ ${roundCurrency(grossSalary + familyAllowance).toFixed(2)}). Líquido limitado a R$ 0,00 — revise os lançamentos.`,
      );
      // Clamp: net never negative. Reduz o total de descontos ao teto dos proventos.
      totalDeductions = roundCurrency(grossSalary + familyAllowance);
      netSalary = 0;
    }

    // ========================================================================
    // STEP 11: EMPLOYER CONTRIBUTIONS (for tracking)
    // ========================================================================

    // FGTS incide sobre a remuneração devida (mesma base de INSS) — inclui
    // insalubridade/periculosidade e gratificação habitual (já no bruto), NÃO
    // o salário-família (isento, fora do bruto).
    const fgtsResult = this.taxCalculator.calculateFGTS(taxableEarnings, isApprentice);
    const fgtsAmount = roundCurrency(fgtsResult.amount);
    const fgtsRate = fgtsResult.rate || 8.0;

    // ========================================================================
    // RETURN COMPLETE CALCULATION
    // ========================================================================

    return {
      employeeId,
      year,
      month,
      baseSalary: base,
      overtimeEarnings: {
        overtime50Hours,
        overtime50Amount,
        overtime100Hours,
        overtime100Amount,
        nightHours,
        nightDifferentialAmount,
      },
      dsrEarnings: {
        dsrOnOvertime,
        dsrOnBonifications,
        totalDSR,
        dsrDays,
      },
      bonusAmount: bonus,
      additionalEarnings: {
        familyAllowance,
        familyAllowanceQuota: salarioFamiliaTable.quota,
        eligibleChildren: salarioFamiliaChildren,
        insalubrity: insalubrityAmount,
        insalubrityPercent: insalPercent * 100,
        hazardPay: hazardPayAmount,
      },
      otherEarnings,
      grossSalary,
      taxDeductions: {
        inssBase,
        inssAmount,
        inssEffectiveRate,
        irrfBase,
        irrfAmount,
        irrfEffectiveRate,
      },
      absenceDeductions: {
        absenceHours,
        absenceDays,
        unjustifiedAbsenceDays,
        justifiedAbsenceDays,
        absenceAmount,
        absenceDsrLoss,
        lateArrivalMinutes: lateMinutes,
        lateArrivalAmount,
      },
      benefitDeductions: {
        mealVoucher,
        transportVoucher,
        healthInsurance,
        dentalInsurance,
        otherBenefits,
      },
      benefitCopayItems,
      legalDeductions: {
        unionContribution,
        alimony,
        garnishment,
      },
      loanDeductions: {
        loans,
        advances,
      },
      customDeductions,
      totalDeductions,
      netSalary,
      employerContributions: {
        fgtsAmount,
        fgtsRate,
      },
      secullumData,
      calculationDate: new Date(),
      workingDaysInMonth,
      workedDays,
      prorationFactor,
      isLive: true,
      warnings,
    };
  }

  /**
   * ========================================================================
   * HELPER: GET DISCOUNT AMOUNT
   * ========================================================================
   */
  private getDiscountAmount(
    discounts: Array<{ type: PayrollDiscountType; value?: number; percentage?: number }>,
    type: PayrollDiscountType,
    defaultValue: number = 0,
    baseValueForPercentage?: number,
  ): number {
    // Sum ALL discounts of the given type (an employee can have e.g. two
    // active loans at once); previously only the first match was counted.
    const matching = discounts.filter(d => d.type === type);
    if (matching.length === 0) return defaultValue;

    let total = 0;
    for (const discount of matching) {
      if (discount.value && discount.value > 0) {
        total += discount.value;
      } else if (discount.percentage && discount.percentage > 0 && baseValueForPercentage) {
        total += (baseValueForPercentage * discount.percentage) / 100;
      }
    }

    return total > 0 ? roundCurrency(total) : defaultValue;
  }
}
