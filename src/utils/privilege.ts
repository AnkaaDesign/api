// packages/utils/src/privilege.ts
// Privilege management utilities moved from constants package

import { SECTOR_PRIVILEGES } from '@constants';

// =====================
// Privilege Management
// =====================

export const getSectorPrivilegeLevel = (privilege: SECTOR_PRIVILEGES): number => {
  const levels = {
    [SECTOR_PRIVILEGES.BASIC]: 1,
    [SECTOR_PRIVILEGES.MAINTENANCE]: 2,
    [SECTOR_PRIVILEGES.WAREHOUSE]: 3,
    [SECTOR_PRIVILEGES.PRODUCTION]: 4,
    [SECTOR_PRIVILEGES.DESIGNER]: 4, // Same level as PRODUCTION - specialized access
    [SECTOR_PRIVILEGES.LOGISTIC]: 4, // Same level as PRODUCTION - specialized access
    [SECTOR_PRIVILEGES.LEADER]: 5,
    [SECTOR_PRIVILEGES.HUMAN_RESOURCES]: 6,
    [SECTOR_PRIVILEGES.FINANCIAL]: 6, // Same level as HR - specialized access
    [SECTOR_PRIVILEGES.ADMIN]: 8,
    [SECTOR_PRIVILEGES.EXTERNAL]: 9,
  };
  return levels[privilege] || 1;
};

export const canAccessSector = (
  userPrivilege: SECTOR_PRIVILEGES,
  targetPrivilege: SECTOR_PRIVILEGES,
): boolean => {
  const userLevel = getSectorPrivilegeLevel(userPrivilege);
  const targetLevel = getSectorPrivilegeLevel(targetPrivilege);
  return userLevel >= targetLevel;
};

/**
 * Check if user privilege can access ANY of the specified target privileges (OR logic)
 * Matches backend @Roles decorator behavior
 */
export const canAccessAnyPrivilege = (
  userPrivilege: SECTOR_PRIVILEGES,
  targetPrivileges: SECTOR_PRIVILEGES[],
): boolean => {
  if (!targetPrivileges.length) return false;
  return targetPrivileges.some(privilege => canAccessSector(userPrivilege, privilege));
};

/**
 * Check if user privilege can access ALL of the specified target privileges (AND logic)
 */
export const canAccessAllPrivileges = (
  userPrivilege: SECTOR_PRIVILEGES,
  targetPrivileges: SECTOR_PRIVILEGES[],
): boolean => {
  if (!targetPrivileges.length) return false;
  return targetPrivileges.every(privilege => canAccessSector(userPrivilege, privilege));
};

// =====================
// Team Management Privilege Utilities
// =====================

/**
 * Check if user can access team management features
 * User must have LEADER privilege OR have managedSectorId
 */
export const canAccessTeamFeatures = (
  userPrivilege: SECTOR_PRIVILEGES,
  hasManagedSector: boolean = false,
): boolean => {
  return canAccessSector(userPrivilege, SECTOR_PRIVILEGES.LEADER) || hasManagedSector;
};

/**
 * Check if user can manage specific team/sector
 * User must be ADMIN, LEADER, or manage the specific sector
 */
export const canManageTeam = (
  userPrivilege: SECTOR_PRIVILEGES,
  managedSectorId: string | null,
  targetSectorId: string,
): boolean => {
  // Admin can manage any team
  if (canAccessSector(userPrivilege, SECTOR_PRIVILEGES.ADMIN)) {
    return true;
  }

  // Team leader can manage their own team
  if (managedSectorId === targetSectorId) {
    return true;
  }

  // General leader can manage teams (based on business rules)
  if (canAccessSector(userPrivilege, SECTOR_PRIVILEGES.LEADER)) {
    return true;
  }

  return false;
};

/**
 * Check if user can view team data for a specific sector
 */
export const canViewTeamData = (
  userPrivilege: SECTOR_PRIVILEGES,
  managedSectorId: string | null,
  targetSectorId: string,
): boolean => {
  // Same as canManageTeam but could have different business rules in the future
  return canManageTeam(userPrivilege, managedSectorId, targetSectorId);
};

/**
 * Get effective privilege level considering both sector privilege and team leadership
 */
export const getEffectivePrivilegeLevel = (
  userPrivilege: SECTOR_PRIVILEGES,
  hasManagedSector: boolean = false,
): number => {
  const baseLevel = getSectorPrivilegeLevel(userPrivilege);

  // If user has managed sector but privilege is below LEADER, boost to LEADER level
  if (hasManagedSector && baseLevel < getSectorPrivilegeLevel(SECTOR_PRIVILEGES.LEADER)) {
    return getSectorPrivilegeLevel(SECTOR_PRIVILEGES.LEADER);
  }

  return baseLevel;
};
