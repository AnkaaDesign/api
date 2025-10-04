// packages/utils/src/position.ts

import type { Position } from '@types';

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

  return parts.join(" ");
};

export const formatRemuneration = (value: number): string => {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
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

export const calculateRemunerationAdjustment = (currentValue: number, adjustmentType: "percentage" | "fixed", adjustmentValue: number): number => {
  if (adjustmentType === "percentage") {
    return currentValue + currentValue * (adjustmentValue / 100);
  } else {
    return currentValue + adjustmentValue;
  }
};

export const calculateAnnualSalary = (monthlyRemuneration: number): number => {
  // In Brazil, employees receive 13th salary (extra month)
  return monthlyRemuneration * 13;
};

export const calculateHourlyRate = (monthlyRemuneration: number, hoursPerWeek: number = 44): number => {
  // Standard Brazilian work week is 44 hours
  const hoursPerMonth = (hoursPerWeek * 52) / 12;
  return monthlyRemuneration / hoursPerMonth;
};

export const getRemunerationDistribution = (positions: Position[]) => {
  const ranges = [
    { min: 0, max: 2000, label: "Até R$ 2.000" },
    { min: 2001, max: 5000, label: "R$ 2.001 - R$ 5.000" },
    { min: 5001, max: 10000, label: "R$ 5.001 - R$ 10.000" },
    { min: 10001, max: 20000, label: "R$ 10.001 - R$ 20.000" },
    { min: 20001, max: Infinity, label: "Acima de R$ 20.000" },
  ];

  const distribution: Record<string, number> = {};

  ranges.forEach((range) => {
    const count = positions.filter((p) => p.remuneration !== undefined && p.remuneration >= range.min && p.remuneration <= range.max).length;
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
};
