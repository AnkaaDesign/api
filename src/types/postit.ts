// postit.ts
// Post-its pessoais (mural de lembretes) — sempre restritos ao próprio usuário.

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
} from './common';
import type { ORDER_BY_DIRECTION } from '@constants';
import type { User } from './user';

// =====================
// Main Entity Interface
// =====================
export interface Postit extends BaseEntity {
  userId: string;
  content: string;
  color: string;
  position: number;
  isArchived: boolean;

  // Relations (optional, populated based on query)
  user?: User;
}

// =====================
// Include Types
// =====================
export interface PostitIncludes {
  user?: boolean;
}

// =====================
// Order By Types
// =====================
export interface PostitOrderBy {
  id?: ORDER_BY_DIRECTION;
  position?: ORDER_BY_DIRECTION;
  color?: ORDER_BY_DIRECTION;
  isArchived?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================
export interface PostitGetUniqueResponse extends BaseGetUniqueResponse<Postit> {}
export interface PostitGetManyResponse extends BaseGetManyResponse<Postit> {}
export interface PostitCreateResponse extends BaseCreateResponse<Postit> {}
export interface PostitUpdateResponse extends BaseUpdateResponse<Postit> {}
export interface PostitDeleteResponse extends BaseDeleteResponse {}
export interface PostitReorderResponse extends BaseGetManyResponse<Postit> {}
