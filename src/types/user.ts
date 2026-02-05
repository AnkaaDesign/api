// packages/interfaces/src/user.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
  BaseMergeResponse,
} from './common';
import type { ORDER_BY_DIRECTION, USER_STATUS } from '@constants';
import type {
  PpeSize,
  PpeDelivery,
  PpeDeliverySchedule,
  PpeSizeIncludes,
  PpeDeliveryIncludes,
  PpeDeliveryScheduleIncludes,
} from './ppe';
import type {
  SeenNotification,
  Notification,
  SeenNotificationIncludes,
  NotificationIncludes,
} from './notification';
import type { Position, PositionIncludes, PositionOrderBy } from './position';
import type { Preferences, PreferencesIncludes } from './preferences';
import type { Warning, WarningIncludes } from './warning';
import type { Sector, SectorIncludes, SectorOrderBy } from './sector';
import type { Vacation, VacationIncludes } from './vacation';
import type { Task, TaskIncludes } from './task';
import type { Activity, ActivityIncludes } from './activity';
import type { Borrow, BorrowIncludes } from './borrow';
import type { ChangeLog, ChangeLogIncludes } from './changelog';
import type { Bonus, BonusIncludes } from './bonus';
import type { File } from './file';

// =====================
// Main Entity Interface
// =====================

export interface User extends BaseEntity {
  email: string | null;
  name: string;
  avatarId: string | null;
  status: USER_STATUS;
  statusOrder: number; // 1=Ativo, 2=Inativo, 3=Suspenso
  isActive: boolean;
  phone: string | null;
  password?: string | null;
  positionId: string | null;
  preferenceId: string | null;
  pis: string | null;
  cpf: string | null;
  verified: boolean;
  birth: Date; // Date of birth
  performanceLevel: number;
  sectorId: string | null;
  address: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  site: string | null;
  zipCode: string | null;
  verificationCode?: string | null;
  verificationExpiresAt?: Date | null;
  verificationType?: string | null | undefined;
  requirePasswordChange?: boolean;
  lastLoginAt?: Date | null;
  sessionToken: string | null;
  payrollNumber: number | null;

  // Status timestamp tracking
  effectedAt: Date | null; // When user became permanently effected
  exp1StartAt: Date | null; // Start of first experience period (45 days)
  exp1EndAt: Date | null; // End of first experience period
  exp2StartAt: Date | null; // Start of second experience period (45 days)
  exp2EndAt: Date | null; // End of second experience period
  dismissedAt: Date | null; // When user was dismissed/terminated

  // Relations
  avatar?: File;
  ppeSize?: PpeSize;
  preference?: Preferences;
  position?: Position;
  sector?: Sector;
  managedSector?: Sector;
  activities?: Activity[];
  borrows?: Borrow[];
  notifications?: Notification[];
  tasks?: Task[];
  vacations?: Vacation[];
  bonuses?: Bonus[];
  warningsCollaborator?: Warning[];
  warningsSupervisor?: Warning[];
  warningsWitness?: Warning[];
  ppeDeliveries?: PpeDelivery[];
  ppeDeliveriesApproved?: PpeDelivery[];
  ppeSchedules?: PpeDeliverySchedule[];
  changeLogs?: ChangeLog[];
  seenNotification?: SeenNotification[];
  createdTasks?: Task[];

  // Count fields (when included)
  _count?: {
    activities?: number;
    vacations?: number;
    bonuses?: number;
    tasks?: number;
    createdTasks?: number; // Used in employee tables
    workOrders?: number;
    orders?: number;
    suppliers?: number;
    items?: number;
    maintenances?: number;
    productionBatches?: number;
    parkingRecords?: number;
    files?: number;
    changeLogs?: number;
    seenNotification?: number;
  };
}

// =====================
// Select Types for Flexible Field Selection
// =====================

/**
 * User select type for Prisma-style field selection
 * Allows selecting specific fields instead of fetching all
 */
export interface UserSelect {
  // Base fields
  id?: boolean;
  createdAt?: boolean;
  updatedAt?: boolean;

  // Identity fields
  email?: boolean;
  name?: boolean;
  avatarId?: boolean;
  phone?: boolean;

  // Status fields
  status?: boolean;
  statusOrder?: boolean;
  isActive?: boolean;
  verified?: boolean;

  // Employment fields
  positionId?: boolean;
  sectorId?: boolean;
  payrollNumber?: boolean;

  // Personal information
  pis?: boolean;
  cpf?: boolean;
  birth?: boolean;
  performanceLevel?: boolean;

  // Address fields
  address?: boolean;
  addressNumber?: boolean;
  addressComplement?: boolean;
  neighborhood?: boolean;
  city?: boolean;
  state?: boolean;
  zipCode?: boolean;
  site?: boolean;

  // Status timestamps
  effectedAt?: boolean;
  exp1StartAt?: boolean;
  exp1EndAt?: boolean;
  exp2StartAt?: boolean;
  exp2EndAt?: boolean;
  dismissedAt?: boolean;

  // Authentication fields
  password?: boolean;
  verificationCode?: boolean;
  verificationExpiresAt?: boolean;
  verificationType?: boolean;
  requirePasswordChange?: boolean;
  lastLoginAt?: boolean;
  sessionToken?: boolean;
  preferenceId?: boolean;

  // Relations (use include for full relations)
  avatar?: boolean;
  ppeSize?: boolean;
  preference?: boolean;
  position?: boolean;
  sector?: boolean;
  managedSector?: boolean;
  activities?: boolean;
  borrows?: boolean;
  notifications?: boolean;
  tasks?: boolean;
  vacations?: boolean;
  bonuses?: boolean;
  warningsCollaborator?: boolean;
  warningsSupervisor?: boolean;
  warningsWitness?: boolean;
  ppeDeliveries?: boolean;
  ppeDeliveriesApproved?: boolean;
  ppeSchedules?: boolean;
  changeLogs?: boolean;
  seenNotification?: boolean;
  createdTasks?: boolean;

  // Count
  _count?:
    | boolean
    | {
        select?: {
          activities?: boolean;
          vacations?: boolean;
          bonuses?: boolean;
          tasks?: boolean;
          createdTasks?: boolean;
          workOrders?: boolean;
          orders?: boolean;
          suppliers?: boolean;
          items?: boolean;
          maintenances?: boolean;
          productionBatches?: boolean;
          parkingRecords?: boolean;
          files?: boolean;
          changeLogs?: boolean;
          seenNotification?: boolean;
        };
      };
}

// =====================
// Include Types
// =====================

export interface UserIncludes {
  avatar?: boolean;
  ppeSize?:
    | boolean
    | {
        include?: PpeSizeIncludes;
      };
  preference?:
    | boolean
    | {
        include?: PreferencesIncludes;
      };
  position?:
    | boolean
    | {
        include?: PositionIncludes;
      };
  sector?:
    | boolean
    | {
        include?: SectorIncludes;
      };
  managedSector?:
    | boolean
    | {
        include?: SectorIncludes;
      };
  activities?:
    | boolean
    | {
        include?: ActivityIncludes;
      };
  borrows?:
    | boolean
    | {
        include?: BorrowIncludes;
      };
  notifications?:
    | boolean
    | {
        include?: NotificationIncludes;
      };
  tasks?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  vacations?:
    | boolean
    | {
        include?: VacationIncludes;
      };
  bonuses?:
    | boolean
    | {
        include?: BonusIncludes;
      };
  warningsCollaborator?:
    | boolean
    | {
        include?: WarningIncludes;
      };
  warningsSupervisor?:
    | boolean
    | {
        include?: WarningIncludes;
      };
  warningsWitness?:
    | boolean
    | {
        include?: WarningIncludes;
      };
  ppeDeliveries?:
    | boolean
    | {
        include?: PpeDeliveryIncludes;
      };
  ppeDeliveriesApproved?:
    | boolean
    | {
        include?: PpeDeliveryIncludes;
      };
  ppeSchedules?:
    | boolean
    | {
        include?: PpeDeliveryScheduleIncludes;
      };
  changeLogs?:
    | boolean
    | {
        include?: ChangeLogIncludes;
      };
  seenNotification?:
    | boolean
    | {
        include?: SeenNotificationIncludes;
      };
  createdTasks?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  _count?:
    | boolean
    | {
        select?: {
          activities?: boolean;
          vacations?: boolean;
          bonuses?: boolean;
          tasks?: boolean;
          createdTasks?: boolean;
          workOrders?: boolean;
          orders?: boolean;
          suppliers?: boolean;
          items?: boolean;
          maintenances?: boolean;
          productionBatches?: boolean;
          parkingRecords?: boolean;
          files?: boolean;
          changeLogs?: boolean;
          seenNotification?: boolean;
        };
      };
}

// =====================
// Specialized User Types
// =====================

/**
 * Minimal user type for comboboxes and dropdowns
 * Only includes essential fields for display
 */
export interface UserMinimal {
  id: string;
  name: string;
  email?: string | null;
  avatarId?: string | null;
  status?: USER_STATUS;
  isActive?: boolean;
}

/**
 * User type with position for display in lists
 */
export interface UserWithPosition extends UserMinimal {
  position?: {
    id: string;
    name: string;
    hierarchy?: number | null;
  } | null;
  positionId?: string | null;
}

/**
 * User type with sector for display in lists
 */
export interface UserWithSector extends UserMinimal {
  sector?: {
    id: string;
    name: string;
  } | null;
  sectorId?: string | null;
}

/**
 * User type with basic employment information
 */
export interface UserWithEmployment extends UserMinimal {
  position?: {
    id: string;
    name: string;
    hierarchy?: number | null;
  } | null;
  sector?: {
    id: string;
    name: string;
  } | null;
  positionId?: string | null;
  sectorId?: string | null;
  payrollNumber?: number | null;
  status: USER_STATUS;
  isActive: boolean;
}

/**
 * Detailed user type with all common relations
 */
export interface UserDetailed extends User {
  position?: Position;
  sector?: Sector;
  managedSector?: Sector;
  avatar?: File;
  ppeSize?: PpeSize;
}

// =====================
// Select Helpers
// =====================

/**
 * Predefined select configurations for common use cases
 */
export const UserSelectPresets = {
  /**
   * Minimal fields for comboboxes
   */
  minimal: {
    id: true,
    name: true,
    email: true,
    avatarId: true,
    status: true,
    isActive: true,
  } as const,

  /**
   * Fields for list display with position
   */
  withPosition: {
    id: true,
    name: true,
    email: true,
    avatarId: true,
    status: true,
    isActive: true,
    positionId: true,
    position: true,
  } as const,

  /**
   * Fields for list display with sector
   */
  withSector: {
    id: true,
    name: true,
    email: true,
    avatarId: true,
    status: true,
    isActive: true,
    sectorId: true,
    sector: true,
  } as const,

  /**
   * Fields for employment information
   */
  employment: {
    id: true,
    name: true,
    email: true,
    avatarId: true,
    status: true,
    isActive: true,
    positionId: true,
    sectorId: true,
    payrollNumber: true,
    position: true,
    sector: true,
  } as const,

  /**
   * All basic fields without relations
   */
  basic: {
    id: true,
    createdAt: true,
    updatedAt: true,
    email: true,
    name: true,
    avatarId: true,
    status: true,
    statusOrder: true,
    isActive: true,
    phone: true,
    positionId: true,
    preferenceId: true,
    pis: true,
    cpf: true,
    verified: true,
    birth: true,
    performanceLevel: true,
    sectorId: true,
    payrollNumber: true,
    effectedAt: true,
    exp1StartAt: true,
    exp1EndAt: true,
    exp2StartAt: true,
    exp2EndAt: true,
    dismissedAt: true,
  } as const,
} as const;

/**
 * Type helper to extract user type from select configuration
 */
export type UserFromSelect<S extends UserSelect> = Pick<User, Extract<keyof User, keyof S>>;

// =====================
// Order By Types
// =====================

export interface UserOrderBy {
  id?: ORDER_BY_DIRECTION;
  email?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  avatarId?: ORDER_BY_DIRECTION;
  token?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  isActive?: ORDER_BY_DIRECTION;
  phone?: ORDER_BY_DIRECTION;
  password?: ORDER_BY_DIRECTION;
  pis?: ORDER_BY_DIRECTION;
  cpf?: ORDER_BY_DIRECTION;
  verified?: ORDER_BY_DIRECTION;
  payrollNumber?: ORDER_BY_DIRECTION;
  birth?: ORDER_BY_DIRECTION;
  effectedAt?: ORDER_BY_DIRECTION;
  exp1StartAt?: ORDER_BY_DIRECTION;
  exp1EndAt?: ORDER_BY_DIRECTION;
  exp2StartAt?: ORDER_BY_DIRECTION;
  exp2EndAt?: ORDER_BY_DIRECTION;
  dismissedAt?: ORDER_BY_DIRECTION;
  performanceLevel?: ORDER_BY_DIRECTION;
  address?: ORDER_BY_DIRECTION;
  addressNumber?: ORDER_BY_DIRECTION;
  addressComplement?: ORDER_BY_DIRECTION;
  neighborhood?: ORDER_BY_DIRECTION;
  city?: ORDER_BY_DIRECTION;
  state?: ORDER_BY_DIRECTION;
  zipCode?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  position?: PositionOrderBy;
  sector?: SectorOrderBy;
  managedSector?: SectorOrderBy;
}

// =====================
// Response Interfaces
// =====================

export interface UserGetUniqueResponse extends BaseGetUniqueResponse<User> {}
export interface UserGetManyResponse extends BaseGetManyResponse<User> {}
export interface UserCreateResponse extends BaseCreateResponse<User> {}
export interface UserUpdateResponse extends BaseUpdateResponse<User> {}
export interface UserDeleteResponse extends BaseDeleteResponse {}
export interface UserMergeResponse extends BaseMergeResponse<User> {}

// Specialized response types
export interface UserMinimalGetManyResponse extends BaseGetManyResponse<UserMinimal> {}
export interface UserWithPositionGetManyResponse extends BaseGetManyResponse<UserWithPosition> {}
export interface UserWithSectorGetManyResponse extends BaseGetManyResponse<UserWithSector> {}
export interface UserWithEmploymentGetManyResponse extends BaseGetManyResponse<UserWithEmployment> {}
export interface UserDetailedGetUniqueResponse extends BaseGetUniqueResponse<UserDetailed> {}

// =====================
// Batch Operation Responses
// =====================

export interface UserBatchCreateResponse<T> extends BaseBatchResponse<User, T> {}
export interface UserBatchUpdateResponse<T> extends BaseBatchResponse<User, T & { id: string }> {}
export interface UserBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
