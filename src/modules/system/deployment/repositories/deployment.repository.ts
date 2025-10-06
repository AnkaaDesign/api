// repositories/deployment.repository.ts

import { Deployment } from '../../../../types';
import {
  DeploymentCreateFormData,
  DeploymentUpdateFormData,
  DeploymentInclude,
  DeploymentOrderBy,
  DeploymentWhere,
} from '../../../../schemas';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class DeploymentRepository extends BaseStringRepository<
  Deployment,
  DeploymentCreateFormData,
  DeploymentUpdateFormData,
  DeploymentInclude,
  DeploymentOrderBy,
  DeploymentWhere
> {
  // Deployment-specific methods
  abstract findByGitCommit(gitCommitId: string, tx?: PrismaTransaction): Promise<Deployment | null>;
  abstract findLatestByEnvironment(environment: string, tx?: PrismaTransaction): Promise<Deployment | null>;
}
