// vacation-group.types.ts
// Férias COLETIVAS — module-local response/entity types.

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
} from '../../../../types/common';
import type { VACATION_STATUS, VACATION_GROUP_TYPE } from '../../../../constants';
import type { Vacation } from '../../vacation/types/vacation.types';

export interface VacationGroupPeriod extends BaseEntity {
  groupId: string;
  startDate: Date;
  days: number;
}

export interface VacationGroup extends BaseEntity {
  name: string;
  type: VACATION_GROUP_TYPE;
  acquisitiveStart: Date;
  acquisitiveEnd: Date;
  concessiveEnd: Date | null;
  status: VACATION_STATUS;
  statusOrder: number;
  sectorIds: string[];
  positionIds: string[];
  notes: string | null;

  // Relations
  periods?: VacationGroupPeriod[];
  vacations?: Vacation[];
}

/** A colaborador resolved as a target of the collective, with eligibility. */
export interface VacationGroupMember {
  userId: string;
  name: string;
  sectorId: string | null;
  sectorName: string | null;
  positionId: string | null;
  positionName: string | null;
  secullumEmployeeId: number | null;
  /** false when the colaborador cannot be expanded (e.g. no admissionDate). */
  eligible: boolean;
  /** Human-readable reason when not eligible. */
  reason?: string;
  /** true when an individual vacation for this group already exists. */
  alreadyExpanded: boolean;
}

export interface VacationGroupMembersPreview {
  total: number;
  eligible: number;
  members: VacationGroupMember[];
}

export interface VacationGroupExpandResult {
  created: number;
  skipped: number;
  failed: number;
  details: Array<{ userId: string; name: string; status: 'created' | 'skipped' | 'failed'; reason?: string }>;
}

export type VacationGroupGetUniqueResponse = BaseGetUniqueResponse<VacationGroup>;
export type VacationGroupGetManyResponse = BaseGetManyResponse<VacationGroup>;
export type VacationGroupCreateResponse = BaseCreateResponse<VacationGroup>;
export type VacationGroupUpdateResponse = BaseUpdateResponse<VacationGroup>;
export type VacationGroupDeleteResponse = BaseDeleteResponse;
export type VacationGroupMembersResponse = BaseGetUniqueResponse<VacationGroupMembersPreview>;
export type VacationGroupExpandResponse = BaseGetUniqueResponse<VacationGroupExpandResult>;
