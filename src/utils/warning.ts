import { WARNING_SEVERITY, WARNING_CATEGORY } from '@constants';
import { WARNING_SEVERITY_LABELS, WARNING_CATEGORY_LABELS } from '@constants';
import type { Warning } from '@types';

/**
 * Get the display label for a warning severity
 * @param severity - The warning severity enum value
 * @returns The localized label for the severity
 */
export function getWarningSeverityLabel(severity: WARNING_SEVERITY): string {
  return WARNING_SEVERITY_LABELS[severity] || severity;
}

/**
 * Get the display label for a warning category
 * @param category - The warning category enum value
 * @returns The localized label for the category
 */
export function getWarningCategoryLabel(category: WARNING_CATEGORY): string {
  return WARNING_CATEGORY_LABELS[category] || category;
}

export const getWarningSeverityLevel = (severity: WARNING_SEVERITY): number => {
  const levels = {
    VERBAL: 1,
    WRITTEN: 2,
    SUSPENSION: 3,
    FINAL_WARNING: 4,
  };

  return levels[severity] || 1;
};

export const getWarningSeverityDescription = (severity: WARNING_SEVERITY): string => {
  const descriptions = {
    VERBAL: "Advertência Verbal",
    WRITTEN: "Advertência Escrita",
    SUSPENSION: "Suspensão",
    FINAL_WARNING: "Advertência Final",
  };

  return descriptions[severity] || "Não definido";
};

export const getWarningCategoryDescription = (category: WARNING_CATEGORY): string => {
  const descriptions = {
    ATTENDANCE: "Frequência/Pontualidade",
    PERFORMANCE: "Desempenho",
    BEHAVIOR: "Comportamento",
    SAFETY: "Segurança",
    POLICY_VIOLATION: "Violação de Política",
    INSUBORDINATION: "Insubordinação",
    MISCONDUCT: "Má Conduta",
    OTHER: "Outros",
  };

  return descriptions[category] || "Não definido";
};

export const validateWarningEscalation = (currentSeverity: WARNING_SEVERITY, newSeverity: WARNING_SEVERITY): boolean => {
  const currentLevel = getWarningSeverityLevel(currentSeverity);
  const newLevel = getWarningSeverityLevel(newSeverity);

  return newLevel > currentLevel;
};

export const calculateWarningAge = (warning: Warning): number => {
  const now = new Date();
  const createdAt = new Date(warning.createdAt);
  const diffTime = Math.abs(now.getTime() - createdAt.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
};

export const isWarningOverdue = (warning: Warning): boolean => {
  if (!warning.followUpDate) return false;

  const now = new Date();
  const followUpDate = new Date(warning.followUpDate);

  return followUpDate < now && !warning.resolvedAt;
};

export const getWarningStatus = (warning: Warning): "active" | "resolved" | "overdue" | "pending_followup" => {
  if (warning.resolvedAt) return "resolved";
  if (isWarningOverdue(warning)) return "overdue";
  if (warning.followUpDate && !warning.resolvedAt) return "pending_followup";
  return "active";
};

export const generateWarningReport = (
  warnings: Warning[],
): {
  total: number;
  bySeverity: Record<WARNING_SEVERITY, number>;
  byCategory: Record<WARNING_CATEGORY, number>;
  averageAgeInDays: number;
  overdueCount: number;
} => {
  const total = warnings.length;
  const bySeverity = {} as Record<WARNING_SEVERITY, number>;
  const byCategory = {} as Record<WARNING_CATEGORY, number>;
  let totalAge = 0;
  let overdueCount = 0;

  warnings.forEach((warning) => {
    // Count by severity
    const severity = warning.severity as WARNING_SEVERITY;
    bySeverity[severity] = (bySeverity[severity] || 0) + 1;

    // Count by category
    const category = warning.category as WARNING_CATEGORY;
    byCategory[category] = (byCategory[category] || 0) + 1;

    // Calculate age
    totalAge += calculateWarningAge(warning);

    // Count overdue
    if (isWarningOverdue(warning)) {
      overdueCount++;
    }
  });

  const averageAgeInDays = total > 0 ? Math.round(totalAge / total) : 0;

  return {
    total,
    bySeverity,
    byCategory,
    averageAgeInDays,
    overdueCount,
  };
};
