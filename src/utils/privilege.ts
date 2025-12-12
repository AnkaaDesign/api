// packages/utils/src/privilege.ts
// Privilege management utilities

import { SECTOR_PRIVILEGES } from '@constants';

// =====================
// Privilege Sort Order (for DISPLAY/SORTING purposes ONLY)
// =====================

/**
 * Get privilege sort order for DISPLAY and SORTING purposes only
 *
 * IMPORTANT: This is NOT used for access control!
 * Privileges are NOT hierarchical - each privilege grants specific access only.
 */
export const getSectorPrivilegeSortOrder = (privilege: SECTOR_PRIVILEGES): number => {
  const sortOrder = {
    [SECTOR_PRIVILEGES.BASIC]: 1,
    [SECTOR_PRIVILEGES.MAINTENANCE]: 2,
    [SECTOR_PRIVILEGES.WAREHOUSE]: 3,
    [SECTOR_PRIVILEGES.DESIGNER]: 4,
    [SECTOR_PRIVILEGES.LOGISTIC]: 4,
    [SECTOR_PRIVILEGES.PRODUCTION]: 5,
    [SECTOR_PRIVILEGES.HUMAN_RESOURCES]: 6,
    [SECTOR_PRIVILEGES.FINANCIAL]: 7,
    [SECTOR_PRIVILEGES.ADMIN]: 8,
    [SECTOR_PRIVILEGES.EXTERNAL]: 9,
  };
  return sortOrder[privilege] || 1;
};

// =====================
// Access Control (EXACT MATCH or ARRAY)
// =====================

/**
 * Check if user can access a resource that requires a specific privilege
 *
 * RULES:
 * - ADMIN can access EVERYTHING (special case)
 * - All other privileges require EXACT MATCH
 * - Privileges are NOT hierarchical
 *
 * @example
 * canAccessSector(HUMAN_RESOURCES, HUMAN_RESOURCES) → true (exact match)
 * canAccessSector(HUMAN_RESOURCES, PRODUCTION) → false (different privilege)
 * canAccessSector(ADMIN, ANYTHING) → true (admin has full access)
 */
export const canAccessSector = (
  userPrivilege: SECTOR_PRIVILEGES,
  targetPrivilege: SECTOR_PRIVILEGES,
): boolean => {
  // ADMIN can access everything
  if (userPrivilege === SECTOR_PRIVILEGES.ADMIN) {
    return true;
  }

  // All other privileges require EXACT match
  return userPrivilege === targetPrivilege;
};

/**
 * Check if user privilege is in the allowed privileges array (OR logic)
 * Matches backend @Roles decorator behavior
 *
 * @example
 * canAccessAnyPrivilege(WAREHOUSE, [WAREHOUSE, PRODUCTION]) → true
 * canAccessAnyPrivilege(HUMAN_RESOURCES, [WAREHOUSE, PRODUCTION]) → false
 * canAccessAnyPrivilege(ADMIN, [WAREHOUSE, PRODUCTION]) → true (admin has full access)
 */
export const canAccessAnyPrivilege = (
  userPrivilege: SECTOR_PRIVILEGES,
  allowedPrivileges: SECTOR_PRIVILEGES[],
): boolean => {
  if (!allowedPrivileges.length) return false;

  // ADMIN can access everything
  if (userPrivilege === SECTOR_PRIVILEGES.ADMIN) {
    return true;
  }

  // Check if user's privilege is in the allowed array (exact match)
  return allowedPrivileges.includes(userPrivilege);
};

/**
 * Check if user privilege matches ALL specified privileges (AND logic)
 *
 * Since a user can only have ONE privilege, this only returns true if:
 * 1. User is ADMIN (has access to all), OR
 * 2. Only one privilege is required and user has that exact privilege
 */
export const canAccessAllPrivileges = (
  userPrivilege: SECTOR_PRIVILEGES,
  requiredPrivileges: SECTOR_PRIVILEGES[],
): boolean => {
  if (!requiredPrivileges.length) return false;

  // ADMIN can access everything
  if (userPrivilege === SECTOR_PRIVILEGES.ADMIN) {
    return true;
  }

  // Since users have only ONE privilege, check if all required are the same as user's
  return requiredPrivileges.every(privilege => userPrivilege === privilege);
};

// =====================
// Team Management Privilege Utilities
// =====================

/**
 * Check if user can access team management features
 *
 * A user can access team features if:
 * 1. User is ADMIN, OR
 * 2. User is a sector manager (hasManagedSector = true, meaning Sector.managerId points to this user)
 *
 * Note: This does NOT check the sector privilege - leadership is determined by Sector.managerId
 */
export const canAccessTeamFeatures = (
  userPrivilege: SECTOR_PRIVILEGES,
  hasManagedSector: boolean = false,
): boolean => {
  // Admin always has access to team features
  if (userPrivilege === SECTOR_PRIVILEGES.ADMIN) {
    return true;
  }

  // User is a sector manager (Sector.managerId points to this user)
  return hasManagedSector;
};

/**
 * Check if user can manage a specific team/sector
 *
 * Rules:
 * 1. ADMIN can manage any team
 * 2. Sector manager can manage their own sector (managedSectorId === targetSectorId)
 */
export const canManageTeam = (
  userPrivilege: SECTOR_PRIVILEGES,
  managedSectorId: string | null,
  targetSectorId: string,
): boolean => {
  // Admin can manage any team
  if (userPrivilege === SECTOR_PRIVILEGES.ADMIN) {
    return true;
  }

  // Sector manager can manage their own team
  if (managedSectorId && managedSectorId === targetSectorId) {
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
  return canManageTeam(userPrivilege, managedSectorId, targetSectorId);
};

/**
 * Check if user is an admin
 */
export const isAdmin = (userPrivilege: SECTOR_PRIVILEGES): boolean => {
  return userPrivilege === SECTOR_PRIVILEGES.ADMIN;
};
