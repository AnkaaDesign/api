import type { User } from '@types';
import { CONTRACT_TYPE, CONTRACT_STATUS, EMPLOYEE_TYPE, VERIFICATION_TYPE } from '@constants';
import { isBonifiable } from './contract';
import { dateUtils } from './date';
import type {
  ContractType,
  VerificationType,
  ShirtSize,
  BootSize,
  PantsSize,
  SleevesSize,
  MaskSize,
  GlovesSize,
  RainBootsSize,
} from '@prisma/client';

/**
 * Map CONTRACT_TYPE enum to Prisma ContractType enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapContractKindToPrisma(contractType: CONTRACT_TYPE | string): ContractType {
  return contractType as ContractType;
}

/**
 * Map VERIFICATION_TYPE enum to Prisma VerificationType enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapVerificationTypeToPrisma(
  verificationType: VERIFICATION_TYPE | string | null | undefined,
): VerificationType | null | undefined {
  return verificationType as VerificationType | null | undefined;
}

/**
 * Map PPE size enums to Prisma enums
 * Note: These functions are kept for backward compatibility with PpeSize entity
 */
export function mapShirtSizeToPrisma(
  size: string | null | undefined,
): ShirtSize | null | undefined {
  return size as ShirtSize | null | undefined;
}

export function mapBootSizeToPrisma(size: string | null | undefined): BootSize | null | undefined {
  return size as BootSize | null | undefined;
}

export function mapPantsSizeToPrisma(
  size: string | null | undefined,
): PantsSize | null | undefined {
  return size as PantsSize | null | undefined;
}

export function mapSleevesSizeToPrisma(
  size: string | null | undefined,
): SleevesSize | null | undefined {
  return size as SleevesSize | null | undefined;
}

export function mapMaskSizeToPrisma(size: string | null | undefined): MaskSize | null | undefined {
  return size as MaskSize | null | undefined;
}

export function mapGlovesSizeToPrisma(
  size: string | null | undefined,
): GlovesSize | null | undefined {
  return size as GlovesSize | null | undefined;
}

export function mapRainBootsSizeToPrisma(
  size: string | null | undefined,
): RainBootsSize | null | undefined {
  return size as RainBootsSize | null | undefined;
}

/**
 * Get user status color
 */
export function getUserStatusColor(contractType: CONTRACT_TYPE): string {
  const colors: Record<CONTRACT_TYPE, string> = {
    [CONTRACT_TYPE.INDETERMINATE]: 'green',
    [CONTRACT_TYPE.FIXED_TERM]: 'orange',
    [CONTRACT_TYPE.INTERMITTENT]: 'green',
    [CONTRACT_TYPE.APPRENTICE]: 'green',
    [CONTRACT_TYPE.TEMPORARY]: 'green',
  };
  return colors[contractType] || 'default';
}

/**
 * Check if user is active (current vínculo not terminated)
 */
export function isUserActive(user: User): boolean {
  return (
    user.currentContractStatus !== CONTRACT_STATUS.TERMINATED &&
    user.verified === true &&
    user.password !== null
  );
}

/**
 * Check if user is inactive (current vínculo terminated)
 */
export function isUserInactive(user: User): boolean {
  return user.currentContractStatus === CONTRACT_STATUS.TERMINATED;
}

/**
 * Check if user is blocked (current vínculo terminated)
 */
export function isUserBlocked(user: User): boolean {
  return user.currentContractStatus === CONTRACT_STATUS.TERMINATED;
}

/**
 * Get user display name
 */
export function getUserDisplayName(user: User): string {
  return user.name || user.email || 'Usuário desconhecido';
}

/**
 * Get user initials
 */
export function getUserInitials(user: User): string {
  const name = user.name || user.email || '';
  const parts = name.split(' ');

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  return name.slice(0, 2).toUpperCase();
}

/**
 * Format user info
 */
export function formatUserInfo(user: User): string {
  const name = user.name || 'Sem nome';
  const email = user.email;
  const position = user.position?.name || 'Sem cargo';

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
export function groupUsersByStatus(users: User[]): Record<CONTRACT_TYPE, User[]> {
  const groups = {
    [CONTRACT_TYPE.INDETERMINATE]: [],
    [CONTRACT_TYPE.FIXED_TERM]: [],
    [CONTRACT_TYPE.INTERMITTENT]: [],
    [CONTRACT_TYPE.APPRENTICE]: [],
    [CONTRACT_TYPE.TEMPORARY]: [],
  } as Record<CONTRACT_TYPE, User[]>;

  users.forEach(user => {
    if (user.currentContractType && groups[user.currentContractType]) {
      groups[user.currentContractType].push(user);
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
      const sectorName = user.sector?.name || 'Sem setor';
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
export function sortUsersByName(users: User[], order: 'asc' | 'desc' = 'asc'): User[] {
  return [...users].sort((a, b) => {
    const nameA = a.name || a.email || '';
    const nameB = b.name || b.email || '';
    return order === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
  });
}

/**
 * Calculate user statistics
 */
export function calculateUserStats(users: User[]) {
  const total = users.length;
  const active = users.filter(isUserActive).length;
  const inactive = users.filter(isUserInactive).length;
  const verified = users.filter(user => user.verified).length;
  const newUsers = users.filter(user => isNewUser(user)).length;

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
 * Check if user is a team leader (leads a sector)
 * Note: This now checks the ledSector relation (Sector.leaderId points to this user)
 */
export function isTeamLeader(user: User): boolean {
  return Boolean(user.ledSector?.id);
}

/**
 * Get the sector ID that the user leads (if any)
 */
export function getLedSectorId(user: User): string | null {
  return user.ledSector?.id || null;
}

/**
 * Check if user can manage another user (is their team leader)
 */
export function canManageUser(manager: User, targetUser: User): boolean {
  const ledSectorId = getLedSectorId(manager);
  if (!ledSectorId) {
    return false;
  }

  // Leader can manage users in the sector they lead
  return targetUser.sectorId === ledSectorId;
}

/**
 * Get users that a leader leads (team members)
 */
export function getTeamMembers(leader: User, allUsers: User[]): User[] {
  const ledSectorId = getLedSectorId(leader);
  if (!ledSectorId) {
    return [];
  }

  return allUsers.filter(user => user.sectorId === ledSectorId);
}

/**
 * Get users from the same sector as the given user
 */
export function getUsersInSameSector(user: User, allUsers: User[]): User[] {
  if (!user.sectorId) {
    return [];
  }

  return allUsers.filter(u => u.sectorId === user.sectorId && u.id !== user.id);
}

/**
 * Get sector object that user leads (if any)
 * Note: This returns the full sector object from the ledSector relation
 */
export function getLedSector(user: User): User['ledSector'] | null {
  return user.ledSector || null;
}

// =====================
// Bonus Eligibility Utilities
// =====================

/**
 * Check if user is eligible for bonus calculation. This is the SINGLE
 * canonical definition (must match the API live calc) — all four predicates:
 * 1. isBonifiable(currentContract) — CLT && status ACTIVE (the former EFFECTED gate)
 * 2. position.bonifiable === true
 * 3. user.performanceLevel > 0
 * 4. user.secullumEmployeeId != null (registered in the time-clock system)
 */
export function isUserEligibleForBonus(user: User): boolean {
  // Check confirmed-CLT eligibility (CLT && ACTIVE) against the User cache.
  if (
    !isBonifiable({
      employeeType: user.currentEmployeeType as EMPLOYEE_TYPE | null | undefined,
      status: user.currentContractStatus as any,
    })
  ) {
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

  // Check if user is registered in Secullum (required for attendance + bonus).
  // Mirrors the live-calc query `secullumEmployeeId: { not: null }`.
  if ((user as { secullumEmployeeId?: number | null }).secullumEmployeeId == null) {
    return false;
  }

  return true;
}

/**
 * Get bonus eligibility reason for a user
 * Returns null if user is eligible, or a reason string if not eligible
 */
export function getBonusIneligibilityReason(user: User): string | null {
  if (user.currentContractStatus === CONTRACT_STATUS.TERMINATED) {
    return 'Usuário está desligado';
  }

  if (user.currentEmployeeType !== EMPLOYEE_TYPE.CLT) {
    return 'Colaborador não é CLT (fora da folha)';
  }

  if (user.currentContractStatus !== CONTRACT_STATUS.ACTIVE) {
    return 'Vínculo não está ativo (efetivado)';
  }

  if (!user.performanceLevel || user.performanceLevel <= 0) {
    return 'Nível de performance deve ser maior que 0';
  }

  if (!user.position) {
    return 'Usuário não possui cargo definido';
  }

  if (!user.position.bonifiable) {
    return 'Cargo não é elegível para bonificação';
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
export function groupUsersByBonusEligibility(users: User[]): {
  eligible: User[];
  ineligible: User[];
} {
  const eligible: User[] = [];
  const ineligible: User[] = [];

  users.forEach(user => {
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
  users.forEach(user => {
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
