import type { User } from '@types';
import { USER_STATUS, SECTOR_PRIVILEGES, VERIFICATION_TYPE } from '@constants';
import { getSectorPrivilegeLevel } from "./privilege";
import { dateUtils } from "./date";
import type { UserStatus, VerificationType, ShirtSize, BootSize, PantsSize, SleevesSize, MaskSize } from "@prisma/client";

/**
 * Map USER_STATUS enum to Prisma UserStatus enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapUserStatusToPrisma(status: USER_STATUS | string): UserStatus {
  return status as UserStatus;
}

/**
 * Map VERIFICATION_TYPE enum to Prisma VerificationType enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapVerificationTypeToPrisma(verificationType: VERIFICATION_TYPE | string | null | undefined): VerificationType | null | undefined {
  return verificationType as VerificationType | null | undefined;
}

/**
 * Map PPE size enums to Prisma enums
 * Note: These functions are kept for backward compatibility with PpeSize entity
 */
export function mapShirtSizeToPrisma(size: string | null | undefined): ShirtSize | null | undefined {
  return size as ShirtSize | null | undefined;
}

export function mapBootSizeToPrisma(size: string | null | undefined): BootSize | null | undefined {
  return size as BootSize | null | undefined;
}

export function mapPantsSizeToPrisma(size: string | null | undefined): PantsSize | null | undefined {
  return size as PantsSize | null | undefined;
}

export function mapSleevesSizeToPrisma(size: string | null | undefined): SleevesSize | null | undefined {
  return size as SleevesSize | null | undefined;
}

export function mapMaskSizeToPrisma(size: string | null | undefined): MaskSize | null | undefined {
  return size as MaskSize | null | undefined;
}

/**
 * Get user status color
 */
export function getUserStatusColor(status: USER_STATUS): string {
  const colors: Record<USER_STATUS, string> = {
    [USER_STATUS.EXPERIENCE_PERIOD_1]: "orange",
    [USER_STATUS.EXPERIENCE_PERIOD_2]: "orange",
    [USER_STATUS.CONTRACTED]: "green",
    [USER_STATUS.DISMISSED]: "gray",
  };
  return colors[status] || "default";
}

/**
 * Check if user is active (not dismissed)
 */
export function isUserActive(user: User): boolean {
  return user.status !== USER_STATUS.DISMISSED && user.verified === true && user.password !== null;
}

/**
 * Check if user is dismissed
 */
export function isUserInactive(user: User): boolean {
  return user.status === USER_STATUS.DISMISSED;
}

/**
 * Check if user is blocked
 */
export function isUserBlocked(user: User): boolean {
  return user.status === USER_STATUS.DISMISSED;
}

/**
 * Check if user has specific privilege
 */
export function hasPrivilege(user: User, requiredPrivilege: SECTOR_PRIVILEGES): boolean {
  if (!user.sector?.privileges) return false;

  const userPrivilegeLevel = getSectorPrivilegeLevel(user.sector.privileges);
  const requiredPrivilegeLevel = getSectorPrivilegeLevel(requiredPrivilege);

  return userPrivilegeLevel >= requiredPrivilegeLevel;
}

/**
 * Check if user has ANY of the specified privileges (OR logic)
 * Matches backend @Roles decorator behavior - user needs only one of the privileges
 */
export function hasAnyPrivilege(user: User, requiredPrivileges: SECTOR_PRIVILEGES[]): boolean {
  if (!user.sector?.privileges || !requiredPrivileges.length) return false;

  return requiredPrivileges.some((privilege) => hasPrivilege(user, privilege));
}

/**
 * Check if user has ALL of the specified privileges (AND logic)
 * User must have privilege level equal to or higher than ALL specified privileges
 */
export function hasAllPrivileges(user: User, requiredPrivileges: SECTOR_PRIVILEGES[]): boolean {
  if (!user.sector?.privileges || !requiredPrivileges.length) return false;

  return requiredPrivileges.every((privilege) => hasPrivilege(user, privilege));
}

/**
 * Check if user can access based on privilege array (same as hasAnyPrivilege)
 * Alias function that matches backend controller terminology
 */
export function canAccessWithPrivileges(user: User, allowedPrivileges: SECTOR_PRIVILEGES[]): boolean {
  return hasAnyPrivilege(user, allowedPrivileges);
}

/**
 * Check if user is administrator
 */
export function isUserAdmin(user: User): boolean {
  return hasPrivilege(user, SECTOR_PRIVILEGES.ADMIN);
}

/**
 * Check if user is leader
 */
export function isUserLeader(user: User): boolean {
  return hasPrivilege(user, SECTOR_PRIVILEGES.LEADER);
}

/**
 * Get user display name
 */
export function getUserDisplayName(user: User): string {
  return user.name || user.email || "Usuário desconhecido";
}

/**
 * Get user initials
 */
export function getUserInitials(user: User): string {
  const name = user.name || user.email || "";
  const parts = name.split(" ");

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  return name.slice(0, 2).toUpperCase();
}

/**
 * Format user info
 */
export function formatUserInfo(user: User): string {
  const name = user.name || "Sem nome";
  const email = user.email;
  const position = user.position?.name || "Sem cargo";

  return `${name} (${email}) - ${position}`;
}

/**
 * Get user age in days
 */
export function getUserAge(user: User): number {
  return dateUtils.getDaysAgo(user.createdAt);
}

/**
 * Check if user is new (created within last 30 days)
 */
export function isNewUser(user: User, daysThreshold: number = 30): boolean {
  return getUserAge(user) <= daysThreshold;
}

/**
 * Group users by status
 */
export function groupUsersByStatus(users: User[]): Record<USER_STATUS, User[]> {
  const groups = {
    [USER_STATUS.EXPERIENCE_PERIOD_1]: [],
    [USER_STATUS.EXPERIENCE_PERIOD_2]: [],
    [USER_STATUS.CONTRACTED]: [],
    [USER_STATUS.DISMISSED]: [],
  } as Record<USER_STATUS, User[]>;

  users.forEach((user) => {
    if (groups[user.status]) {
      groups[user.status].push(user);
    }
  });

  return groups;
}

/**
 * Group users by sector
 */
export function groupUsersBySector(users: User[]): Record<string, User[]> {
  return users.reduce(
    (groups, user) => {
      const sectorName = user.sector?.name || "Sem setor";
      if (!groups[sectorName]) {
        groups[sectorName] = [];
      }
      groups[sectorName].push(user);
      return groups;
    },
    {} as Record<string, User[]>,
  );
}

/**
 * Filter active users
 */
export function filterActiveUsers(users: User[]): User[] {
  return users.filter(isUserActive);
}

/**
 * Sort users by name
 */
export function sortUsersByName(users: User[], order: "asc" | "desc" = "asc"): User[] {
  return [...users].sort((a, b) => {
    const nameA = a.name || a.email || "";
    const nameB = b.name || b.email || "";
    return order === "asc" ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
  });
}

/**
 * Calculate user statistics
 */
export function calculateUserStats(users: User[]) {
  const total = users.length;
  const active = users.filter(isUserActive).length;
  const inactive = users.filter(isUserInactive).length;
  const verified = users.filter((user) => user.verified).length;
  const newUsers = users.filter((user) => isNewUser(user)).length;

  const bySector = groupUsersBySector(users);
  const sectorCounts = Object.entries(bySector).reduce(
    (acc, [sector, userList]) => {
      acc[sector] = userList.length;
      return acc;
    },
    {} as Record<string, number>,
  );

  return {
    total,
    active,
    inactive,
    verified,
    newUsers,
    sectorCounts,
  };
}

// =====================
// Team Leadership Utilities
// =====================

/**
 * Check if user is a team leader (manages a sector)
 */
export function isTeamLeader(user: User): boolean {
  return Boolean(user.managedSectorId);
}

/**
 * Check if user can manage another user (is their team leader)
 */
export function canManageUser(manager: User, targetUser: User): boolean {
  if (!isTeamLeader(manager) || !manager.managedSectorId) {
    return false;
  }

  // Manager can manage users in the sector they manage
  return targetUser.sectorId === manager.managedSectorId;
}

/**
 * Get users that a leader manages (team members)
 */
export function getTeamMembers(leader: User, allUsers: User[]): User[] {
  if (!isTeamLeader(leader) || !leader.managedSectorId) {
    return [];
  }

  return allUsers.filter((user) => user.sectorId === leader.managedSectorId);
}

/**
 * Get users from the same sector as the given user
 */
export function getUsersInSameSector(user: User, allUsers: User[]): User[] {
  if (!user.sectorId) {
    return [];
  }

  return allUsers.filter((u) => u.sectorId === user.sectorId && u.id !== user.id);
}

/**
 * Check if user has both sector membership and leadership privileges
 */
export function isUserLeaderWithPrivileges(user: User): boolean {
  return isUserLeader(user) && isTeamLeader(user);
}

/**
 * Get sector that user manages (if any)
 */
export function getManagedSector(user: User): string | null {
  return user.managedSectorId;
}

/**
 * Check if user can access team management features
 */
export function canAccessTeamManagement(user: User): boolean {
  // User must be a leader OR have sufficient privileges
  return isUserLeader(user) || isTeamLeader(user);
}

// =====================
// Bonus Eligibility Utilities
// =====================

/**
 * Check if user is eligible for bonus calculation based on:
 * 1. user.status === CONTRACTED (not in experience period or dismissed)
 * 2. user.performanceLevel > 0
 * 3. position.bonifiable === true
 */
export function isUserEligibleForBonus(user: User): boolean {
  // Check if user is CONTRACTED (not in experience period or dismissed)
  if (user.status !== USER_STATUS.CONTRACTED) {
    return false;
  }

  // Check if user has performance level > 0
  if (!user.performanceLevel || user.performanceLevel <= 0) {
    return false;
  }

  // Check if user's position is bonifiable
  if (!user.position?.bonifiable) {
    return false;
  }

  return true;
}

/**
 * Get bonus eligibility reason for a user
 * Returns null if user is eligible, or a reason string if not eligible
 */
export function getBonusIneligibilityReason(user: User): string | null {
  if (user.status === USER_STATUS.DISMISSED) {
    return "Usuário está desligado";
  }

  if (!user.performanceLevel || user.performanceLevel <= 0) {
    return "Nível de performance deve ser maior que 0";
  }

  if (!user.position) {
    return "Usuário não possui cargo definido";
  }

  if (!user.position.bonifiable) {
    return "Cargo não é elegível para bonificação";
  }

  return null;
}

/**
 * Filter users eligible for bonus calculation
 */
export function filterBonusEligibleUsers(users: User[]): User[] {
  return users.filter(isUserEligibleForBonus);
}

/**
 * Group users by bonus eligibility
 */
export function groupUsersByBonusEligibility(users: User[]): { eligible: User[]; ineligible: User[] } {
  const eligible: User[] = [];
  const ineligible: User[] = [];

  users.forEach((user) => {
    if (isUserEligibleForBonus(user)) {
      eligible.push(user);
    } else {
      ineligible.push(user);
    }
  });

  return { eligible, ineligible };
}

/**
 * Calculate bonus eligibility statistics for a list of users
 */
export function calculateBonusEligibilityStats(users: User[]) {
  const total = users.length;
  const eligible = users.filter(isUserEligibleForBonus).length;
  const ineligible = total - eligible;

  // Count reasons for ineligibility
  const ineligibilityReasons: Record<string, number> = {};
  users.forEach((user) => {
    const reason = getBonusIneligibilityReason(user);
    if (reason) {
      ineligibilityReasons[reason] = (ineligibilityReasons[reason] || 0) + 1;
    }
  });

  return {
    total,
    eligible,
    ineligible,
    eligibilityRate: total > 0 ? (eligible / total) * 100 : 0,
    ineligibilityReasons,
  };
}
