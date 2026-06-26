// thirteenth-calculation.service.ts
// Motor de cálculo do 13º salário (gratificação natalina — Lei 4.090/62).
//
// Regras implementadas (BR = baseRemuneration, incl. média de variáveis):
//   avos                  = nº de meses no ano-calendário com ≥15 dias trabalhados
//                           (Lei 4.090/62 art. 1º §2º) — réplica EXATA da lógica
//                           `thirteenthMonths` do TerminationCalculationService
//                           (NÃO importa de lá; replicada para não acoplar módulos).
//   fullEntitlement       = BR / 12 × avos  (valor cheio devido no ano)
//   1ª parcela            = 50% × fullEntitlement, vencimento ≤30/Nov, SEM descontos
//                           (CLT/Lei 4.749/65 art. 2º)
//   2ª parcela (bruta)    = fullEntitlement − 1ª parcela
//   INSS/IRRF             = incidem INTEGRALMENTE na 2ª parcela, sobre a base
//                           EXCLUSIVA do 13º (tributação SEPARADA do salário do mês,
//                           NÃO somada à folha de dezembro) — via computeThirteenthTaxes.
//   2ª parcela (líquida)  = 2ª parcela bruta − INSS − IRRF
//
// Funções de data replicam o comportamento do motor de rescisão (mesmas
// fronteiras de ≥15 dias) para manter os avos idênticos entre os dois módulos.

import { Injectable } from '@nestjs/common';
import { roundCurrency } from '../../../utils/currency-precision.util';
import { computeThirteenthTaxes } from '../payroll/utils/tax-tables';

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const diffDaysInclusive = (from: Date, to: Date): number =>
  Math.floor((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS) + 1;

export interface ThirteenthAvosInput {
  /** Data de admissão do vínculo CURRENT (EmploymentContract.admissionDate). */
  admissionDate: Date | null;
  /** Ano-calendário do 13º. */
  year: number;
  /** Data de corte (default: 31/Dez do ano). Para rescisão, a data de saída. */
  referenceDate?: Date | null;
}

export interface ThirteenthInstallmentsInput {
  baseRemuneration: number;
  avos: number;
  dependentsCount: number;
  allowSimplifiedDeduction: boolean;
  year: number;
}

export interface ThirteenthInstallmentsResult {
  /** Valor cheio devido no ano = BR / 12 × avos. */
  fullEntitlement: number;
  /** 1ª parcela: 50% do valor cheio, SEM descontos. */
  firstInstallment: number;
  /** 2ª parcela bruta (antes de INSS/IRRF). */
  secondInstallmentGross: number;
  /** INSS sobre a base exclusiva do 13º (incide na 2ª parcela). */
  inss: number;
  /** IRRF sobre a base exclusiva do 13º (incide na 2ª parcela). */
  irrf: number;
  /** 2ª parcela líquida = bruta − INSS − IRRF. */
  secondInstallment: number;
}

@Injectable()
export class ThirteenthCalculationService {
  /**
   * Avos do 13º: meses do ano-calendário (clamp em referenceDate) com ≥15 dias
   * trabalhados = 1 mês cheio (Lei 4.090/62 art. 1º §2º).
   *
   * Réplica EXATA de TerminationCalculationService.thirteenthMonths — não é
   * importada de lá por decisão de não acoplar/editar o módulo de rescisão.
   */
  computeAvos(input: ThirteenthAvosInput): number {
    const { admissionDate, year } = input;
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    let periodStart = yearStart;
    if (admissionDate && startOfDay(admissionDate) > yearStart) {
      periodStart = startOfDay(admissionDate);
    }

    const refEnd = input.referenceDate ? startOfDay(input.referenceDate) : yearEnd;
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
   * Calcula 1ª e 2ª parcelas. INSS/IRRF incidem somente na 2ª parcela, sobre a
   * base EXCLUSIVA do 13º (valor cheio do ano), tributada separadamente do mês.
   */
  computeInstallments(input: ThirteenthInstallmentsInput): ThirteenthInstallmentsResult {
    const { baseRemuneration, avos, dependentsCount, allowSimplifiedDeduction, year } = input;

    const fullEntitlement = roundCurrency((baseRemuneration / 12) * avos);
    const firstInstallment = roundCurrency(fullEntitlement * 0.5);
    const secondInstallmentGross = roundCurrency(fullEntitlement - firstInstallment);

    // Base EXCLUSIVA do 13º: INSS/IRRF incidem sobre o VALOR CHEIO do ano
    // (fullEntitlement), tributado separadamente do salário do mês.
    const taxes =
      fullEntitlement > 0
        ? computeThirteenthTaxes({
            baseRemuneration: fullEntitlement,
            dependentsCount,
            allowSimplifiedDeduction,
            year,
          })
        : { inss: 0, irrf: 0 };

    const inss = roundCurrency(taxes.inss);
    const irrf = roundCurrency(taxes.irrf);
    const secondInstallment = roundCurrency(secondInstallmentGross - inss - irrf);

    return {
      fullEntitlement,
      firstInstallment,
      secondInstallmentGross,
      inss,
      irrf,
      secondInstallment,
    };
  }
}
