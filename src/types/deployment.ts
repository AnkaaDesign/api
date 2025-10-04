// packages/types/src/deployment.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from "./common";
import type { ORDER_BY_DIRECTION, DEPLOYMENT_STATUS, DEPLOYMENT_ENVIRONMENT } from '@constants';
import type { User, UserIncludes, UserOrderBy } from "./user";

// =====================
// Git Commit Interface
// =====================

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: Date;
  message: string;
  body: string;
  branch?: string;
}

// =====================
// Main Entity Interface
// =====================

export interface Deployment extends BaseEntity {
  environment: DEPLOYMENT_ENVIRONMENT;
  commitSha: string;
  branch: string;
  status: DEPLOYMENT_STATUS;
  statusOrder: number;
  deployedBy: string | null;
  version: string | null;
  previousCommit: string | null;
  rollbackData: any | null;
  deploymentLog: string | null;
  healthCheckUrl: string | null;
  healthCheckStatus: string | null;
  startedAt: Date;
  completedAt: Date | null;
  rolledBackAt: Date | null;

  // Relations
  user?: User;
}

// =====================
// Include Options
// =====================

export interface DeploymentIncludes {
  user?:
    | boolean
    | {
        include?: UserIncludes;
      };
}

// =====================
// Where Clause
// =====================

export interface DeploymentWhere {
  AND?: DeploymentWhere | DeploymentWhere[];
  OR?: DeploymentWhere[];
  NOT?: DeploymentWhere | DeploymentWhere[];

  id?: string | { in?: string[]; notIn?: string[]; equals?: string; not?: string };
  environment?: DEPLOYMENT_ENVIRONMENT | { in?: DEPLOYMENT_ENVIRONMENT[]; notIn?: DEPLOYMENT_ENVIRONMENT[]; equals?: DEPLOYMENT_ENVIRONMENT; not?: DEPLOYMENT_ENVIRONMENT };
  commitSha?: string | { contains?: string; startsWith?: string; endsWith?: string; equals?: string; not?: string; mode?: "default" | "insensitive" };
  branch?: string | { contains?: string; startsWith?: string; endsWith?: string; equals?: string; not?: string; mode?: "default" | "insensitive" };
  status?: DEPLOYMENT_STATUS | { in?: DEPLOYMENT_STATUS[]; notIn?: DEPLOYMENT_STATUS[]; equals?: DEPLOYMENT_STATUS; not?: DEPLOYMENT_STATUS };
  statusOrder?: number | { equals?: number; gt?: number; gte?: number; lt?: number; lte?: number; not?: number };
  deployedBy?: string | null | { equals?: string | null; in?: (string | null)[]; notIn?: (string | null)[]; not?: string | null };
  version?: string | null | { equals?: string | null; contains?: string; startsWith?: string; mode?: "default" | "insensitive" };
  startedAt?: Date | { equals?: Date; gt?: Date; gte?: Date; lt?: Date; lte?: Date };
  completedAt?: Date | null | { equals?: Date | null; gt?: Date; gte?: Date; lt?: Date; lte?: Date };
  rolledBackAt?: Date | null | { equals?: Date | null; gt?: Date; gte?: Date; lt?: Date; lte?: Date };
  createdAt?: Date | { equals?: Date; gt?: Date; gte?: Date; lt?: Date; lte?: Date };
  updatedAt?: Date | { equals?: Date; gt?: Date; gte?: Date; lt?: Date; lte?: Date };

  user?: {
    is?: UserIncludes;
    isNot?: UserIncludes;
  };
}

// =====================
// OrderBy Options
// =====================

export interface DeploymentOrderBy {
  id?: ORDER_BY_DIRECTION;
  environment?: ORDER_BY_DIRECTION;
  commitSha?: ORDER_BY_DIRECTION;
  branch?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  deployedBy?: ORDER_BY_DIRECTION;
  version?: ORDER_BY_DIRECTION;
  startedAt?: ORDER_BY_DIRECTION;
  completedAt?: ORDER_BY_DIRECTION;
  rolledBackAt?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;

  user?: UserOrderBy;
}

// =====================
// API Request Params
// =====================

export interface DeploymentGetManyParams {
  searchingFor?: string;
  where?: DeploymentWhere;
  orderBy?: DeploymentOrderBy | DeploymentOrderBy[];
  include?: DeploymentIncludes;
  page?: number;
  limit?: number;
  cursor?: string;
  skip?: number;
  take?: number;
}

export interface DeploymentGetByIdParams {
  include?: DeploymentIncludes;
}

// =====================
// API Responses
// =====================

export interface DeploymentGetManyResponse extends BaseGetManyResponse<Deployment> {}
export interface DeploymentGetUniqueResponse extends BaseGetUniqueResponse<Deployment> {}
export interface DeploymentCreateResponse extends BaseCreateResponse<Deployment> {}
export interface DeploymentUpdateResponse extends BaseUpdateResponse<Deployment> {}
export interface DeploymentDeleteResponse extends BaseDeleteResponse {}
export interface DeploymentBatchResponse extends BaseBatchResponse<Deployment> {}
