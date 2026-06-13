// src/types/user-position-history.ts
// Histórico de cargos (Departamento Pessoal)

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
} from './common';
import type { POSITION_CHANGE_REASON, ORDER_BY_DIRECTION } from '@constants';
import type { User, UserIncludes } from './user';
import type { Position, PositionIncludes } from './position';

// =====================
// Main Entity Interface
// =====================

export interface UserPositionHistory extends BaseEntity {
  userId: string;
  positionId: string | null;
  previousPositionId: string | null;
  reason: POSITION_CHANGE_REASON;
  startedAt: Date;
  endedAt: Date | null;
  note: string | null;
  changedById: string | null;

  // Relations (optional, populated based on query)
  user?: User;
  position?: Position;
  previousPosition?: Position;
  changedBy?: User;
}

// =====================
// Include Types
// =====================

export interface UserPositionHistoryIncludes {
  user?:
    | boolean
    | {
        include?: UserIncludes;
      };
  position?:
    | boolean
    | {
        include?: PositionIncludes;
      };
  previousPosition?:
    | boolean
    | {
        include?: PositionIncludes;
      };
  changedBy?:
    | boolean
    | {
        include?: UserIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface UserPositionHistoryOrderBy {
  id?: ORDER_BY_DIRECTION;
  userId?: ORDER_BY_DIRECTION;
  positionId?: ORDER_BY_DIRECTION;
  previousPositionId?: ORDER_BY_DIRECTION;
  reason?: ORDER_BY_DIRECTION;
  startedAt?: ORDER_BY_DIRECTION;
  endedAt?: ORDER_BY_DIRECTION;
  note?: ORDER_BY_DIRECTION;
  changedById?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

export interface UserPositionHistoryGetUniqueResponse
  extends BaseGetUniqueResponse<UserPositionHistory> {}
export interface UserPositionHistoryGetManyResponse
  extends BaseGetManyResponse<UserPositionHistory> {}
export interface UserPositionHistoryPromoteResponse
  extends BaseCreateResponse<UserPositionHistory> {}
