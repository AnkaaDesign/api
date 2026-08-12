// packages/utils/src/position.ts

import type { Position } from '@types';

// =====================
// Remuneração vigente
// =====================

/** Linha de MonetaryValue mínima para resolver a remuneração vigente. */
export interface RemunerationLike {
  value: number;
  current?: boolean;
  effectiveDate?: Date | string | null;
  createdAt?: Date | string | null;
}

const toTime = (value?: Date | string | null): number => {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

/**
 * Resolve a remuneração vigente a partir das linhas de MonetaryValue já carregadas.
 *
 * NUNCA leia `remunerations[0]` direto: quando o cliente pede `include: { remunerations: true }`
 * (sem `where`/`orderBy`), o Prisma devolve as linhas em ordem física — na prática a MAIS ANTIGA
 * primeiro. Foi assim que a Simulação de Promoções passou a exibir o salário de março/2024 como
 * se fosse o atual. Aqui a linha `current` sempre ganha; havendo mais de uma (erro de dados) ou
 * nenhuma, vence a mais recente por `effectiveDate` e, no empate, por `createdAt`.
 */
export const getCurrentRemuneration = <T extends RemunerationLike>(
  remunerations?: T[] | null,
): T | null => {
  if (!remunerations || remunerations.length === 0) return null;

  const currentRows = remunerations.filter(r => r.current === true);
  const candidates = currentRows.length > 0 ? currentRows : remunerations;

  return candidates.reduce((best, row) => {
    const bestEffective = toTime(best.effectiveDate);
    const rowEffective = toTime(row.effectiveDate);
    if (rowEffective !== bestEffective) return rowEffective > bestEffective ? row : best;
    return toTime(row.createdAt) > toTime(best.createdAt) ? row : best;
  });
};

/** Valor da remuneração vigente (0 quando o cargo não tem nenhuma linha carregada). */
export const getCurrentRemunerationValue = (
  remunerations?: RemunerationLike[] | null,
): number => getCurrentRemuneration(remunerations)?.value ?? 0;

// =====================
// Display Formatters
// =====================

export const formatPositionDisplay = (position: Position): string => {
  return position.name;
};

export const formatPositionFullDisplay = (position: Position): string => {
  const parts = [position.name];

  if (position.remuneration) {
    parts.push(`- ${formatRemuneration(position.remuneration)}`);
  }

  return parts.join(' ');
};

export const formatRemuneration = (value: number): string => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
};

export const formatRemunerationCompact = (value: number): string => {
  if (value >= 1000000) {
    return `R$ ${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `R$ ${(value / 1000).toFixed(1)}K`;
  }
  return formatRemuneration(value);
};

// =====================
// Salary Calculations
// =====================

export const calculateRemunerationAdjustment = (
  currentValue: number,
  adjustmentType: 'percentage' | 'fixed',
  adjustmentValue: number,
): number => {
  if (adjustmentType === 'percentage') {
    return currentValue + currentValue * (adjustmentValue / 100);
  } else {
    return currentValue + adjustmentValue;
  }
};

export const calculateAnnualSalary = (monthlyRemuneration: number): number => {
  // In Brazil, employees receive 13th salary (extra month)
  return monthlyRemuneration * 13;
};

export const calculateHourlyRate = (
  monthlyRemuneration: number,
  hoursPerWeek: number = 44,
): number => {
  // Standard Brazilian work week is 44 hours
  const hoursPerMonth = (hoursPerWeek * 52) / 12;
  return monthlyRemuneration / hoursPerMonth;
};

export const getRemunerationDistribution = (positions: Position[]) => {
  const ranges = [
    { min: 0, max: 2000, label: 'Até R$ 2.000' },
    { min: 2001, max: 5000, label: 'R$ 2.001 - R$ 5.000' },
    { min: 5001, max: 10000, label: 'R$ 5.001 - R$ 10.000' },
    { min: 10001, max: 20000, label: 'R$ 10.001 - R$ 20.000' },
    { min: 20001, max: Infinity, label: 'Acima de R$ 20.000' },
  ];

  const distribution: Record<string, number> = {};

  ranges.forEach(range => {
    const count = positions.filter(
      p =>
        p.remuneration !== undefined && p.remuneration >= range.min && p.remuneration <= range.max,
    ).length;
    distribution[range.label] = count;
  });

  return distribution;
};

// =====================
// Export all utilities
// =====================

export const positionUtils = {
  // Display
  formatPositionDisplay,
  formatPositionFullDisplay,
  formatRemuneration,
  formatRemunerationCompact,

  // Calculations
  calculateRemunerationAdjustment,
  calculateAnnualSalary,
  calculateHourlyRate,

  getRemunerationDistribution,

  // Remuneração vigente
  getCurrentRemuneration,
  getCurrentRemunerationValue,
};
