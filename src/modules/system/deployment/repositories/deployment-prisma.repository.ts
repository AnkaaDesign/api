import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Deployment } from '../../../../types';
import {
  DeploymentCreateFormData,
  DeploymentUpdateFormData,
  DeploymentInclude,
  DeploymentOrderBy,
  DeploymentWhere,
} from '../../../../schemas';
import { DeploymentRepository } from './deployment.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';
import { DEPLOYMENT_STATUS_ORDER } from '../../../../constants';

@Injectable()
export class DeploymentPrismaRepository
  extends BaseStringPrismaRepository<
    Deployment,
    DeploymentCreateFormData,
    DeploymentUpdateFormData,
    DeploymentInclude,
    DeploymentOrderBy,
    DeploymentWhere,
    Prisma.DeploymentGetPayload<{ include: any }>,
    Prisma.DeploymentCreateInput,
    Prisma.DeploymentUpdateInput,
    Prisma.DeploymentInclude,
    Prisma.DeploymentOrderByWithRelationInput,
    Prisma.DeploymentWhereInput
  >
  implements DeploymentRepository
{
  protected readonly logger = new Logger(DeploymentPrismaRepository.name);

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): Deployment {
    return {
      ...databaseEntity,
    } as Deployment;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: DeploymentCreateFormData,
  ): Prisma.DeploymentCreateInput {
    const { appId, gitCommitId, environment, ...rest } = formData;

    // Calculate statusOrder based on default status (PENDING)
    const statusOrder = DEPLOYMENT_STATUS_ORDER['PENDING'] || 2;

    const createInput: Prisma.DeploymentCreateInput = {
      app: { connect: { id: appId } },
      gitCommit: { connect: { id: gitCommitId } },
      environment,
      status: 'PENDING',
      statusOrder,
      startedAt: new Date(),
      ...rest,
    };

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: DeploymentUpdateFormData,
  ): Prisma.DeploymentUpdateInput {
    const { status, ...rest } = formData;

    const updateInput: Prisma.DeploymentUpdateInput = {
      ...rest,
    };

    // Update status and statusOrder if status is being changed
    if (status) {
      updateInput.status = status;
      updateInput.statusOrder = DEPLOYMENT_STATUS_ORDER[status] || 1;
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: DeploymentInclude,
  ): Prisma.DeploymentInclude | undefined {
    if (!include) return undefined;

    const prismaInclude: Prisma.DeploymentInclude = {};

    if (include.user !== undefined) {
      if (typeof include.user === 'boolean') {
        prismaInclude.user = include.user;
      } else {
        prismaInclude.user = {
          include: include.user.include,
        };
      }
    }

    return prismaInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: DeploymentOrderBy | DeploymentOrderBy[],
  ): Prisma.DeploymentOrderByWithRelationInput | undefined {
    if (!orderBy) return undefined;

    if (Array.isArray(orderBy)) {
      // For arrays, return the first one (or combine logic as needed)
      return orderBy.length > 0 ? this.mapSingleOrderBy(orderBy[0]) : undefined;
    }

    return this.mapSingleOrderBy(orderBy);
  }

  private mapSingleOrderBy(orderBy: DeploymentOrderBy): Prisma.DeploymentOrderByWithRelationInput {
    const prismaOrderBy: Prisma.DeploymentOrderByWithRelationInput = {};

    Object.entries(orderBy).forEach(([key, value]) => {
      if (key === 'user' && typeof value === 'object') {
        prismaOrderBy.user = value;
      } else {
        prismaOrderBy[key] = value;
      }
    });

    return prismaOrderBy;
  }

  protected mapWhereToDatabaseWhere(
    where?: DeploymentWhere,
  ): Prisma.DeploymentWhereInput | undefined {
    if (!where) return undefined;

    const prismaWhere: Prisma.DeploymentWhereInput = {};

    Object.entries(where).forEach(([key, value]) => {
      if (key === 'AND' || key === 'OR') {
        if (Array.isArray(value)) {
          prismaWhere[key] = value.map(w => this.mapWhereToDatabaseWhere(w)).filter(Boolean);
        }
      } else if (key === 'NOT') {
        if (Array.isArray(value)) {
          prismaWhere[key] = value.map(w => this.mapWhereToDatabaseWhere(w)).filter(Boolean);
        } else if (value) {
          const mapped = this.mapWhereToDatabaseWhere(value);
          if (mapped) prismaWhere[key] = mapped;
        }
      } else if (key === 'user') {
        prismaWhere.user = value;
      } else {
        prismaWhere[key] = value;
      }
    });

    return prismaWhere;
  }

  protected getModelName(): string {
    return 'deployment';
  }

  protected getModelDelegate(tx?: PrismaTransaction) {
    return tx ? tx.deployment : this.prisma.deployment;
  }

  protected getDefaultInclude(): Prisma.DeploymentInclude | undefined {
    return {
      app: {
        select: {
          id: true,
          name: true,
          displayName: true,
          appType: true,
          repository: {
            select: {
              id: true,
              name: true,
              gitUrl: true,
              branch: true,
            },
          },
        },
      },
      gitCommit: {
        select: {
          id: true,
          hash: true,
          shortHash: true,
          message: true,
          author: true,
          authorEmail: true,
          committedAt: true,
          branch: true,
          repository: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    };
  }

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: DeploymentCreateFormData,
    options?: { include?: DeploymentInclude },
  ): Promise<Deployment> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.deployment.create({
        data: createInput,
        include: includeInput || undefined,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar deployment', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: { include?: DeploymentInclude },
  ): Promise<Deployment | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.deployment.findUnique({
        where: { id },
        include: includeInput || undefined,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError('buscar deployment por ID', error, { id });
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: { include?: DeploymentInclude },
  ): Promise<Deployment[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.deployment.findMany({
        where: { id: { in: ids } },
        include: includeInput || undefined,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar deployments por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options: any,
  ): Promise<{ data: Deployment[]; meta: any }> {
    try {
      const where = this.mapWhereToDatabaseWhere(options.where);
      const orderBy = this.mapOrderByToDatabaseOrderBy(options.orderBy);
      const include = this.mapIncludeToDatabaseInclude(options.include) || this.getDefaultInclude();

      const page = options.page || 1;
      const take = options.take || 10;
      const skip = (page - 1) * take;

      const [results, total] = await Promise.all([
        transaction.deployment.findMany({
          where,
          orderBy: orderBy || undefined,
          include: include || undefined,
          skip,
          take,
        }),
        transaction.deployment.count({ where }),
      ]);

      const data = results.map(result => this.mapDatabaseEntityToEntity(result));

      return {
        data,
        meta: {
          totalRecords: total,
          page,
          hasNextPage: skip + take < total,
        },
      };
    } catch (error) {
      this.logError('buscar deployments', error, { options });
      throw error;
    }
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: DeploymentUpdateFormData,
    options?: { include?: DeploymentInclude },
  ): Promise<Deployment> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.deployment.update({
        where: { id },
        data: updateInput,
        include: includeInput || undefined,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('atualizar deployment', error, { id, data });
      throw error;
    }
  }

  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string,
  ): Promise<Deployment> {
    try {
      const result = await transaction.deployment.delete({
        where: { id },
      });
      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('deletar deployment', error, { id });
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    options?: { where?: DeploymentWhere },
  ): Promise<number> {
    try {
      const where = this.mapWhereToDatabaseWhere(options?.where);
      return await transaction.deployment.count({ where });
    } catch (error) {
      this.logError('contar deployments', error, { options });
      throw error;
    }
  }

  protected logError(operation: string, error: any, context?: any): void {
    this.logger.error(`Erro ao ${operation}: ${error.message}`, {
      error: error.stack,
      context,
    });
  }

  // Deployment-specific methods
  async findByGitCommit(gitCommitId: string, tx?: PrismaTransaction): Promise<Deployment | null> {
    const delegate = this.getModelDelegate(tx);
    const deployment = await delegate.findFirst({
      where: { gitCommitId },
      include: { app: true, gitCommit: true },
    });

    return deployment ? this.mapDatabaseEntityToEntity(deployment) : null;
  }

  async findLatestByEnvironment(environment: string, tx?: PrismaTransaction): Promise<Deployment | null> {
    const delegate = this.getModelDelegate(tx);
    const deployment = await delegate.findFirst({
      where: {
        environment: environment as any,
        status: { in: ['COMPLETED', 'IN_PROGRESS'] }
      },
      orderBy: { createdAt: 'desc' },
    });

    return deployment ? this.mapDatabaseEntityToEntity(deployment) : null;
  }
}
