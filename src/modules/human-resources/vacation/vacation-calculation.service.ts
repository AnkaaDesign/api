// vacation-calculation.service.ts
// Motor de cálculo das FÉRIAS (Departamento Pessoal) — Part C.
//
// Funções PURAS (sem DB, sem Nest context) — espelham o estilo do
// TerminationCalculationService. Cobrem:
//  - escala de dias do art. 130 (faltas injustificadas);
//  - período aquisitivo a partir da admissão do vínculo atual;
//  - período concessivo (= fim do aquisitivo + 12 meses);
//  - férias em dobro (art. 137) quando o gozo ocorre após o concessivo;
//  - média de variáveis (HE/adicionais/gratificação habitual/bonificação);
//  - férias + 1/3 + abono pecuniário (art. 143, ≤10 dias, isento);
//  - validação de fracionamento (Reforma 2017: ≤3 períodos, um ≥14 dias);
//  - INSS/IRRF via computeVacationTaxes (base própria férias + 1/3).
//
// Referências legais: CLT arts. 129–146 (férias), 130 (escala de dias), 137
// (dobro), 142/§5º-6º (média de variáveis), 143 (abono pecuniário), 145
// (recibo/pagamento); Lei 13.467/2017 (fracionamento em até 3 períodos).

import { Injectable } from '@nestjs/common';
import { roundCurrency } from '@utils/currency-precision.util';
import { computeVacationTaxes } from '../payroll/utils/tax-tables';
import type { VacationRecibo, VacationReciboLine } from './types/vacation.types';

export interface VacationPeriodInputCalc {
  startDate: Date;
  days: number;
}

export interface FracionamentoValidation {
  valid: boolean;
  errors: string[];
  totalDays: number;
  periodCount: number;
}

/** Insumo de uma folha mensal do período aquisitivo para a média de variáveis. */
export interface VariablePayrollSample {
  /** Adicional de horas extras (50% + 100%) do mês. */
  overtimeAmount: number;
  /** Adicional noturno do mês. */
  nightDifferentialAmount: number;
  /** Outros adicionais habituais (insalubridade/periculosidade/gratificação). */
  habitualAdditionalsAmount: number;
  /** Bonificação líquida do mês (quando habitual). */
  bonificationAmount: number;
}

export interface ReciboInput {
  /** Salário-base do vínculo. */
  baseSalary: number;
  /** Média mensal de variáveis a integrar a base (já calculada). */
  variableAverage: number;
  /** Dias de direito (escala art. 130). */
  entitledDays: number;
  /** Dias vendidos (abono pecuniário, art. 143; 0–10). */
  abonoPecuniarioDays: number;
  /** Férias em dobro (art. 137). */
  isDouble: boolean;
  dependentsCount: number;
  allowSimplifiedDeduction: boolean;
  year: number;
}

@Injectable()
export class VacationCalculationService {
  // =====================
  // Datas: período aquisitivo / concessivo
  // =====================

  /**
   * Período aquisitivo a partir da admissão do VÍNCULO ATUAL (não do legado
   * User.exp1StartAt), de modo que readmitidos contem corretamente.
   *
   * O aquisitivo é o ciclo de 12 meses corrente: começa na última "data-base"
   * (aniversário da admissão ≤ referência) e termina 12 meses depois menos 1
   * dia. Ex.: admissão 2024-03-10, referência 2026-06-13 ⇒ aquisitivo
   * 2026-03-10 … 2027-03-09; concessivo = fim do aquisitivo + 12 meses.
   */
  computeAcquisitivePeriod(
    admissionDate: Date,
    reference: Date = new Date(),
  ): { acquisitiveStart: Date; acquisitiveEnd: Date; concessiveEnd: Date } {
    const start = new Date(admissionDate.getTime());
    // Avança ano a ano até o último aniversário ≤ referência.
    while (this.addYears(start, 1).getTime() <= reference.getTime()) {
      start.setFullYear(start.getFullYear() + 1);
    }
    const acquisitiveStart = new Date(start.getTime());
    const acquisitiveEnd = this.addDays(this.addYears(acquisitiveStart, 1), -1);
    const concessiveEnd = this.addDays(this.addYears(acquisitiveEnd, 1), 0);
    return { acquisitiveStart, acquisitiveEnd, concessiveEnd };
  }

  /**
   * Férias em dobro (art. 137): devidas quando o gozo (ou a data de referência
   * de pagamento) ocorre APÓS o fim do período concessivo.
   */
  isDoubleOwed(concessiveEnd: Date | null, reference: Date = new Date()): boolean {
    if (!concessiveEnd) return false;
    return reference.getTime() > concessiveEnd.getTime();
  }

  // =====================
  // Art. 130: escala de dias de direito
  // =====================

  /**
   * Dias de férias conforme as faltas injustificadas no período aquisitivo:
   *   0–5 → 30 · 6–14 → 24 · 15–23 → 18 · 24–32 → 12 · >32 → 0.
   */
  entitledDaysForAbsences(unjustifiedAbsences: number): number {
    const absences = Math.max(0, Math.floor(unjustifiedAbsences));
    if (absences <= 5) return 30;
    if (absences <= 14) return 24;
    if (absences <= 23) return 18;
    if (absences <= 32) return 12;
    return 0;
  }

  // =====================
  // Média de variáveis (CLT 142 §5º/§6º)
  // =====================

  /**
   * Média mensal das verbas variáveis habituais (HE, adicional noturno, outros
   * adicionais habituais, bonificação) ao longo do período aquisitivo. Divide
   * pelo número de meses observados (até 12). Verbas variáveis integram a base
   * de cálculo das férias.
   */
  computeVariableAverage(samples: VariablePayrollSample[]): number {
    if (!samples || samples.length === 0) return 0;
    const totalPerMonth = samples.map(
      s =>
        (s.overtimeAmount || 0) +
        (s.nightDifferentialAmount || 0) +
        (s.habitualAdditionalsAmount || 0) +
        (s.bonificationAmount || 0),
    );
    const sum = totalPerMonth.reduce((a, b) => a + b, 0);
    return roundCurrency(sum / samples.length);
  }

  // =====================
  // Fracionamento (Reforma 2017 — CLT 134 §1º)
  // =====================

  /**
   * Validação do fracionamento: no máximo 3 períodos; um deles ≥ 14 dias; os
   * demais ≥ 5 dias; a soma dos dias não pode exceder os dias de direito.
   */
  validateFracionamento(
    periods: Array<{ startDate?: Date; days?: number }>,
    entitledDays: number,
  ): FracionamentoValidation {
    const errors: string[] = [];
    const periodCount = periods.length;
    const totalDays = periods.reduce((sum, p) => sum + (p.days || 0), 0);

    if (periodCount === 0) {
      return { valid: false, errors: ['Informe ao menos um período de gozo.'], totalDays, periodCount };
    }
    if (periodCount > 3) {
      errors.push('As férias podem ser fracionadas em no máximo 3 períodos (CLT art. 134 §1º).');
    }
    if (periodCount > 1) {
      const hasLongPeriod = periods.some(p => (p.days ?? 0) >= 14);
      if (!hasLongPeriod) {
        errors.push('Um dos períodos deve ter ao menos 14 dias corridos (CLT art. 134 §1º).');
      }
      const shortPeriods = periods.filter(p => (p.days ?? 0) < 5);
      if (shortPeriods.length > 0) {
        errors.push('Nenhum dos demais períodos pode ser inferior a 5 dias corridos (CLT art. 134 §1º).');
      }
    }
    if (totalDays > entitledDays) {
      errors.push(
        `A soma dos dias (${totalDays}) excede os dias de direito (${entitledDays}).`,
      );
    }

    return { valid: errors.length === 0, errors, totalDays, periodCount };
  }

  // =====================
  // Recibo de férias (verbas + INSS/IRRF) — base própria
  // =====================

  /**
   * Constrói o recibo PAGÁVEL de férias (não embutido na folha mensal):
   *   - férias proporcionais aos dias gozados (entitled − abono);
   *   - 1/3 constitucional sobre as férias;
   *   - abono pecuniário (dias vendidos) + seu 1/3 — verbas indenizatórias
   *     ISENTAS de INSS/IRRF (computeVacationTaxes já as exclui da base);
   *   - dobro (art. 137) quando aplicável: férias + 1/3 são duplicados;
   *   - INSS/IRRF sobre a base própria (férias + 1/3 tributável).
   */
  buildRecibo(input: ReciboInput, ids: { vacationId: string; userId: string }): VacationRecibo {
    const {
      baseSalary,
      variableAverage,
      entitledDays,
      abonoPecuniarioDays,
      isDouble,
      dependentsCount,
      allowSimplifiedDeduction,
      year,
    } = input;

    // Base mensal de cálculo das férias = salário-base + média de variáveis.
    const monthlyBase = roundCurrency(baseSalary + variableAverage);
    const dailyRate = monthlyBase / 30;

    const abonoDays = Math.max(0, Math.min(10, abonoPecuniarioDays));
    const vacationDays = Math.max(0, entitledDays - abonoDays);

    // Férias gozadas (proporcional aos dias).
    let vacationPay = roundCurrency(dailyRate * vacationDays);
    let oneThird = roundCurrency(vacationPay / 3);

    // Férias em dobro (art. 137): férias + 1/3 em dobro.
    if (isDouble) {
      vacationPay = roundCurrency(vacationPay * 2);
      oneThird = roundCurrency(oneThird * 2);
    }

    // Abono pecuniário (venda de dias) + 1/3 sobre o abono — indenizatórios.
    const abonoAmount = roundCurrency(dailyRate * abonoDays);
    const abonoOneThird = roundCurrency(abonoAmount / 3);

    // Tributação: base própria férias + 1/3 (abono é excluído pelo helper).
    const taxes = computeVacationTaxes({
      baseRemuneration: vacationPay,
      oneThird,
      abonoAmount: abonoAmount + abonoOneThird,
      dependentsCount,
      allowSimplifiedDeduction,
      year,
    });

    const lines: VacationReciboLine[] = [
      { label: isDouble ? 'Férias (em dobro - art. 137)' : 'Férias', amount: vacationPay },
      { label: '1/3 constitucional', amount: oneThird },
    ];
    if (abonoDays > 0) {
      lines.push({ label: `Abono pecuniário (${abonoDays} dia(s))`, amount: abonoAmount });
      lines.push({ label: '1/3 sobre abono pecuniário', amount: abonoOneThird });
    }
    lines.push({ label: 'INSS', amount: roundCurrency(-taxes.inss) });
    lines.push({ label: 'IRRF', amount: roundCurrency(-taxes.irrf) });

    const earnings = roundCurrency(
      lines.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0),
    );
    const discounts = roundCurrency(
      lines.filter(l => l.amount < 0).reduce((s, l) => s + Math.abs(l.amount), 0),
    );
    const net = roundCurrency(earnings - discounts);

    return {
      vacationId: ids.vacationId,
      userId: ids.userId,
      vacationDays,
      abonoPecuniarioDays: abonoDays,
      baseRemuneration: monthlyBase,
      oneThird,
      abonoAmount,
      abonoOneThird,
      isDouble,
      taxableBase: taxes.taxableBase,
      inss: taxes.inss,
      irrf: taxes.irrf,
      earnings,
      discounts,
      net,
      lines,
    };
  }

  // =====================
  // Helpers de data
  // =====================

  addDays(date: Date, days: number): Date {
    const result = new Date(date.getTime());
    result.setDate(result.getDate() + days);
    return result;
  }

  addYears(date: Date, years: number): Date {
    const result = new Date(date.getTime());
    result.setFullYear(result.getFullYear() + years);
    return result;
  }
}
