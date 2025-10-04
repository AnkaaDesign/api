// packages/utils/src/sector.ts

import type { Sector } from '@types';
import { SECTOR_PRIVILEGES, SECTOR_PRIVILEGES_LABELS } from '@constants';
import { getSectorPrivilegeLevel, canAccessSector, canAccessAnyPrivilege, canAccessAllPrivileges } from "./privilege";

// =====================
// Display Formatters
// =====================

export const formatSectorName = (name: string): string => {
  return name.replace(/\b\w/g, (l) => l.toUpperCase());
};

export const getSectorDisplayName = (sector: Sector): string => {
  return sector.name;
};

export const getSectorFullDisplay = (sector: Sector): string => {
  const parts = [sector.name];
  if (sector.users && sector.users.length > 0) {
    parts.push(`(${sector.users.length} usuários)`);
  }
  return parts.join(" ");
};

// =====================
// Privilege Management (imported from constants)
// =====================
// Functions getSectorPrivilegeLevel, canAccessSector, canAccessAnyPrivilege, canAccessAllPrivileges
// are now imported from @ankaa/constants to maintain proper package dependency hierarchy

export const getSectorPrivilegeDescription = (privilege: SECTOR_PRIVILEGES): string => {
  const descriptions = {
    [SECTOR_PRIVILEGES.BASIC]: "Acesso básico ao sistema",
    [SECTOR_PRIVILEGES.MAINTENANCE]: "Acesso a funcionalidades de limpeza e manutenção",
    [SECTOR_PRIVILEGES.WAREHOUSE]: "Acesso completo ao almoxarifado",
    [SECTOR_PRIVILEGES.PRODUCTION]: "Acesso a funcionalidades de produção",
    [SECTOR_PRIVILEGES.LEADER]: "Acesso de supervisão e liderança",
    [SECTOR_PRIVILEGES.HUMAN_RESOURCES]: "Acesso a recursos humanos",
    [SECTOR_PRIVILEGES.FINANCIAL]: "Acesso financeiro",
    [SECTOR_PRIVILEGES.ADMIN]: "Acesso administrativo completo",
    [SECTOR_PRIVILEGES.EXTERNAL]: "Acesso externo limitado",
  };
  return descriptions[privilege] || "Privilégio não definido";
};

export const getSectorPrivilegeColor = (privilege: SECTOR_PRIVILEGES): string => {
  const colors = {
    [SECTOR_PRIVILEGES.BASIC]: "gray",
    [SECTOR_PRIVILEGES.MAINTENANCE]: "blue",
    [SECTOR_PRIVILEGES.WAREHOUSE]: "purple",
    [SECTOR_PRIVILEGES.PRODUCTION]: "green",
    [SECTOR_PRIVILEGES.LEADER]: "yellow",
    [SECTOR_PRIVILEGES.HUMAN_RESOURCES]: "pink",
    [SECTOR_PRIVILEGES.FINANCIAL]: "orange",
    [SECTOR_PRIVILEGES.ADMIN]: "red",
    [SECTOR_PRIVILEGES.EXTERNAL]: "gray",
  };
  return colors[privilege] || "gray";
};

export const getSectorPrivilegeBadgeVariant = (privilege: SECTOR_PRIVILEGES): "default" | "secondary" | "destructive" | "outline" => {
  const variants = {
    [SECTOR_PRIVILEGES.BASIC]: "outline" as const,
    [SECTOR_PRIVILEGES.MAINTENANCE]: "secondary" as const,
    [SECTOR_PRIVILEGES.WAREHOUSE]: "secondary" as const,
    [SECTOR_PRIVILEGES.PRODUCTION]: "default" as const,
    [SECTOR_PRIVILEGES.LEADER]: "default" as const,
    [SECTOR_PRIVILEGES.HUMAN_RESOURCES]: "secondary" as const,
    [SECTOR_PRIVILEGES.FINANCIAL]: "secondary" as const,
    [SECTOR_PRIVILEGES.ADMIN]: "destructive" as const,
    [SECTOR_PRIVILEGES.EXTERNAL]: "outline" as const,
  };
  return variants[privilege] || "outline";
};

/**
 * Get the display label for sector privileges
 * @param privileges - The sector privileges enum value
 * @returns The localized label for the privileges
 */
export function getSectorPrivilegesLabel(privileges: SECTOR_PRIVILEGES): string {
  return SECTOR_PRIVILEGES_LABELS[privileges] || privileges;
}

// =====================
// Export all utilities
// =====================

export const sectorUtils = {
  // Display
  formatSectorName,
  getSectorDisplayName,
  getSectorFullDisplay,

  // Privileges
  getSectorPrivilegeLevel,
  canAccessSector,
  canAccessAnyPrivilege,
  canAccessAllPrivileges,
  getSectorPrivilegeDescription,
  getSectorPrivilegeColor,
  getSectorPrivilegeBadgeVariant,
  getSectorPrivilegesLabel,
};
