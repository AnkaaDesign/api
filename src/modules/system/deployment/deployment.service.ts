// deployment.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { DeploymentRepository, PrismaTransaction } from './repositories/deployment.repository';
import type {
  Deployment,
  DeploymentBatchResponse,
  DeploymentCreateResponse,
  DeploymentDeleteResponse,
  DeploymentGetManyResponse,
  DeploymentGetUniqueResponse,
  DeploymentUpdateResponse,
  FindManyOptions,
} from '../../../types';
import type {
  DeploymentCreateFormData,
  DeploymentUpdateFormData,
  DeploymentGetManyFormData,
  DeploymentBatchCreateFormData,
  DeploymentBatchUpdateFormData,
  DeploymentBatchDeleteFormData,
  DeploymentInclude,
} from '../../../schemas';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  CHANGE_TRIGGERED_BY,
  DEPLOYMENT_STATUS,
  DEPLOYMENT_ENVIRONMENT,
  DEPLOYMENT_TRIGGER,
  DEPLOYMENT_APPLICATION,
  ENTITY_TYPE,
  CHANGE_ACTION,
} from '../../../constants';
import { DEPLOYMENT_STATUS_ORDER } from '../../../constants';
import { GitService, GitCommitInfo } from './services/git.service';
import { DeploymentExecutorService } from './services/deployment-executor.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';
import { DeploymentEnvironment, DeploymentStatus, DeploymentTrigger, Prisma } from '@prisma/client';

const execAsync = promisify(exec);

interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  branch: string;
}

interface DeploymentConfig {
  appId: string;
  environment: DeploymentEnvironment;
  repoPath: string;
  deployScript: string;
  port: number;
  pm2Name: string;
}

@Injectable()
export class DeploymentService {
  private readonly logger = new Logger(DeploymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deploymentRepository: DeploymentRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly gitService: GitService,
    private readonly deploymentExecutor: DeploymentExecutorService,
  ) {}

  /**
   * Validar deployment
   */
  private async deploymentValidation(
    data: any,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const isUpdate = !!existingId;

    // Validar campos obrigatórios para criação
    if (!isUpdate) {
      if (!data.environment) {
        throw new BadRequestException('Ambiente é obrigatório.');
      }
      if (!data.commitSha && !data.gitCommitId) {
        throw new BadRequestException('Commit SHA ou Git Commit ID é obrigatório.');
      }
      if (!data.branch && !data.gitCommitId) {
        throw new BadRequestException('Branch é obrigatório (ou use gitCommitId).');
      }

      // Check for duplicate deployments (appId + gitCommitId + environment)
      if (data.appId && data.gitCommitId && data.environment) {
        const existingDeployment = await this.deploymentRepository.findMany({
          where: {
            appId: data.appId,
            gitCommitId: data.gitCommitId,
            environment: data.environment,
            status: {
              notIn: [
                DEPLOYMENT_STATUS.FAILED,
                DEPLOYMENT_STATUS.CANCELLED,
                DEPLOYMENT_STATUS.ROLLED_BACK,
              ],
            },
          },
          take: 1,
        });

        if (existingDeployment.data && existingDeployment.data.length > 0) {
          throw new BadRequestException(
            `Já existe um deployment ativo para este commit neste ambiente. ID: ${existingDeployment.data[0].id}`,
          );
        }
      }

      // Check for duplicate workflow runs
      if (data.workflowRunId) {
        const existingWorkflow = await this.deploymentRepository.findMany({
          where: {
            workflowRunId: data.workflowRunId,
          },
          take: 1,
        });

        if (existingWorkflow.data && existingWorkflow.data.length > 0) {
          this.logger.warn(
            `Duplicate workflow run detected: ${data.workflowRunId}. Returning existing deployment.`,
          );
          // Return the existing deployment instead of creating duplicate
          throw new BadRequestException(
            `Deployment já existe para este workflow run. ID: ${existingWorkflow.data[0].id}`,
          );
        }
      }
    }

    // Validar formato do commitSha (legacy field)
    if (data.commitSha !== undefined) {
      if (data.commitSha.length < 7) {
        throw new BadRequestException('Commit SHA deve ter pelo menos 7 caracteres.');
      }
      if (data.commitSha.length > 255) {
        throw new BadRequestException('Commit SHA deve ter no máximo 255 caracteres.');
      }
    }

    // Validar branch (legacy field)
    if (data.branch !== undefined) {
      if (data.branch.trim().length === 0) {
        throw new BadRequestException('Branch não pode ser vazio.');
      }
      if (data.branch.length > 255) {
        throw new BadRequestException('Branch deve ter no máximo 255 caracteres.');
      }
    }
  }

  /**
   * Criar novo deployment
   */
  async create(
    data: DeploymentCreateFormData,
    userId: string,
    include?: DeploymentInclude,
  ): Promise<DeploymentCreateResponse> {
    try {
      // Validar dados
      await this.deploymentValidation(data);

      // Criar deployment
      const deployment = await this.deploymentRepository.create(data, { include });

      // Log de criação
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.DEPLOYMENT,
        entityId: deployment.id,
        action: CHANGE_ACTION.CREATE,
        userId,
        triggeredBy: CHANGE_TRIGGERED_BY.USER,
        entity: deployment,
      });

      return {
        success: true,
        message: 'Deployment criado com sucesso.',
        data: deployment,
      };
    } catch (error) {
      this.logger.error(`Erro ao criar deployment: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Buscar deployment por ID
   */
  async findById(
    id: string,
    include?: DeploymentInclude,
  ): Promise<DeploymentGetUniqueResponse> {
    try {
      const deployment = await this.deploymentRepository.findById(id, { include });

      if (!deployment) {
        throw new NotFoundException('Deployment não encontrado.');
      }

      return {
        success: true,
        message: 'Deployment encontrado com sucesso.',
        data: deployment,
      };
    } catch (error) {
      this.logger.error(`Erro ao buscar deployment: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Buscar deployments com filtros
   */
  async findMany(
    params: DeploymentGetManyFormData,
  ): Promise<DeploymentGetManyResponse> {
    try {
      const options: FindManyOptions<DeploymentInclude> = {
        where: params.where,
        orderBy: params.orderBy || { createdAt: 'desc' },
        include: params.include,
        page: params.page,
        take: params.limit,
      };

      const result = await this.deploymentRepository.findMany(options);

      return {
        success: true,
        message: 'Deployments encontrados com sucesso.',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error(`Erro ao buscar deployments: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Atualizar deployment
   */
  async update(
    id: string,
    data: DeploymentUpdateFormData,
    userId: string,
    include?: DeploymentInclude,
  ): Promise<DeploymentUpdateResponse> {
    try {
      // Buscar deployment existente
      const existing = await this.deploymentRepository.findById(id);
      if (!existing) {
        throw new NotFoundException('Deployment não encontrado.');
      }

      // Validar dados
      await this.deploymentValidation(data, id);

      // Atualizar deployment
      const deployment = await this.deploymentRepository.update(id, data, { include });

      // Log de mudanças
      await trackAndLogFieldChanges({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.DEPLOYMENT,
        entityId: id,
        oldEntity: existing,
        newEntity: deployment,
        fieldsToTrack: Object.keys(data),
        userId,
        triggeredBy: CHANGE_TRIGGERED_BY.USER,
      });

      return {
        success: true,
        message: 'Deployment atualizado com sucesso.',
        data: deployment,
      };
    } catch (error) {
      this.logger.error(`Erro ao atualizar deployment: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Deletar deployment
   */
  async delete(id: string, userId: string): Promise<DeploymentDeleteResponse> {
    try {
      const existing = await this.deploymentRepository.findById(id);
      if (!existing) {
        throw new NotFoundException('Deployment não encontrado.');
      }

      await this.deploymentRepository.delete(id);

      // Log de exclusão
      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.DEPLOYMENT,
        entityId: id,
        action: CHANGE_ACTION.DELETE,
        userId,
        triggeredBy: CHANGE_TRIGGERED_BY.USER,
        oldEntity: existing,
      });

      return {
        success: true,
        message: 'Deployment deletado com sucesso.',
      };
    } catch (error) {
      this.logger.error(`Erro ao deletar deployment: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Criar deployments em lote
   */
  async batchCreate(
    data: DeploymentBatchCreateFormData,
    userId: string,
  ): Promise<DeploymentBatchResponse> {
    try {
      const results = await this.prisma.$transaction(async (tx) => {
        const created: Deployment[] = [];
        const errors: Array<{ index: number; error: string }> = [];

        for (let i = 0; i < data.deployments.length; i++) {
          try {
            await this.deploymentValidation(data.deployments[i]);
            const deployment = await this.deploymentRepository.create(
              data.deployments[i],
              undefined,
            );
            created.push(deployment);

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.DEPLOYMENT,
              entityId: deployment.id,
              action: CHANGE_ACTION.CREATE,
              userId,
              triggeredBy: CHANGE_TRIGGERED_BY.USER,
              entity: deployment,
              transaction: tx,
            });
          } catch (error) {
            errors.push({ index: i, error: error.message });
          }
        }

        return { created, errors };
      });

      return {
        success: true,
        message: `${results.created.length} deployment(s) criado(s) com sucesso.`,
        data: {
          success: results.created,
          failed: results.errors.map((e) => ({
            index: e.index,
            error: e.error,
            data: data.deployments[e.index],
          })),
          totalProcessed: data.deployments.length,
          totalSuccess: results.created.length,
          totalFailed: results.errors.length,
        },
      };
    } catch (error) {
      this.logger.error(`Erro ao criar deployments em lote: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Atualizar deployments em lote
   */
  async batchUpdate(
    data: DeploymentBatchUpdateFormData,
    userId: string,
  ): Promise<DeploymentBatchResponse> {
    try {
      const results = await this.prisma.$transaction(async (tx) => {
        const updated: Deployment[] = [];
        const errors: Array<{ id: string; error: string }> = [];

        for (const update of data.updates) {
          try {
            const existing = await this.deploymentRepository.findById(update.id);
            if (!existing) {
              errors.push({ id: update.id, error: 'Deployment não encontrado' });
              continue;
            }

            await this.deploymentValidation(update.data, update.id);
            const deployment = await this.deploymentRepository.update(update.id, update.data);
            updated.push(deployment);

            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.DEPLOYMENT,
              entityId: update.id,
              oldEntity: existing,
              newEntity: deployment,
              fieldsToTrack: Object.keys(update.data),
              userId,
              triggeredBy: CHANGE_TRIGGERED_BY.USER,
              transaction: tx,
            });
          } catch (error) {
            errors.push({ id: update.id, error: error.message });
          }
        }

        return { updated, errors };
      });

      return {
        success: true,
        message: `${results.updated.length} deployment(s) atualizado(s) com sucesso.`,
        data: {
          success: results.updated,
          failed: results.errors.map((e, index) => ({
            index,
            id: e.id,
            error: e.error,
            data: data.updates.find(u => u.id === e.id),
          })),
          totalProcessed: data.updates.length,
          totalSuccess: results.updated.length,
          totalFailed: results.errors.length,
        },
      };
    } catch (error) {
      this.logger.error(`Erro ao atualizar deployments em lote: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Deletar deployments em lote
   */
  async batchDelete(
    data: DeploymentBatchDeleteFormData,
    userId: string,
  ): Promise<DeploymentBatchResponse> {
    try {
      const results = await this.prisma.$transaction(async (tx) => {
        const deleted: Deployment[] = [];
        const errors: Array<{ id: string; error: string }> = [];

        for (const id of data.ids) {
          try {
            const existing = await this.deploymentRepository.findById(id);
            if (!existing) {
              errors.push({ id, error: 'Deployment não encontrado' });
              continue;
            }

            await this.deploymentRepository.delete(id);
            deleted.push(existing);

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.DEPLOYMENT,
              entityId: id,
              action: CHANGE_ACTION.DELETE,
              userId,
              triggeredBy: CHANGE_TRIGGERED_BY.USER,
              oldEntity: existing,
              transaction: tx,
            });
          } catch (error) {
            errors.push({ id, error: error.message });
          }
        }

        return { deleted, errors };
      });

      return {
        success: true,
        message: `${results.deleted.length} deployment(s) deletado(s) com sucesso.`,
        data: {
          success: results.deleted,
          failed: results.errors.map((e, index) => ({
            index,
            id: e.id,
            error: e.error,
            data: { id: e.id },
          })),
          totalProcessed: data.ids.length,
          totalSuccess: results.deleted.length,
          totalFailed: results.errors.length,
        },
      };
    } catch (error) {
      this.logger.error(`Erro ao deletar deployments em lote: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Create deployment and trigger execution
   */
  async createDeployment(
    appName: string,
    commitHash: string,
    environment: DEPLOYMENT_ENVIRONMENT,
    userId?: string,
    include?: DeploymentInclude,
    trigger: DEPLOYMENT_TRIGGER = DEPLOYMENT_TRIGGER.MANUAL,
  ): Promise<DeploymentCreateResponse> {
    try {
      // Find the app by name
      const app = await this.prisma.app.findUnique({
        where: { name: appName },
        include: { repository: true },
      });

      if (!app) {
        throw new NotFoundException(`Aplicação '${appName}' não encontrada.`);
      }

      // Get commit details from git
      const commitInfo = await this.gitService.getCommitDetails(commitHash);

      // Find or create GitCommit record
      let gitCommit = await this.prisma.gitCommit.findFirst({
        where: {
          repositoryId: app.repositoryId,
          hash: commitInfo.hash,
        },
      });

      if (!gitCommit) {
        gitCommit = await this.prisma.gitCommit.create({
          data: {
            repositoryId: app.repositoryId,
            hash: commitInfo.hash,
            shortHash: commitInfo.shortHash,
            message: commitInfo.message,
            author: commitInfo.author,
            authorEmail: commitInfo.author, // GitService doesn't return email separately
            committedAt: new Date(commitInfo.date),
            branch: commitInfo.branch || 'main',
          },
        });
      }

      // Create deployment record
      const deployment = await this.deploymentRepository.create(
        {
          appId: app.id,
          gitCommitId: gitCommit.id,
          environment,
          triggeredBy: trigger,
        },
        { include },
      );

      // Log creation
      if (userId) {
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.DEPLOYMENT,
          entityId: deployment.id,
          action: CHANGE_ACTION.CREATE,
          userId,
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          entity: deployment,
        });
      }

      // Trigger deployment execution asynchronously
      this.executeDeploymentAsync(
        deployment.id,
        appName as any, // Convert string to DEPLOYMENT_APPLICATION enum
        environment,
        commitInfo.hash,
        commitInfo.branch || 'main',
      );

      return {
        success: true,
        message: 'Deployment iniciado com sucesso.',
        data: deployment,
      };
    } catch (error) {
      this.logger.error(`Erro ao criar deployment: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get current deployment for app and environment
   */
  async getCurrentDeployment(
    appName: string,
    environment: DEPLOYMENT_ENVIRONMENT,
    include?: DeploymentInclude,
  ): Promise<DeploymentGetUniqueResponse> {
    try {
      // Look up the app by name to get its ID
      const app = await this.prisma.app.findUnique({
        where: { name: appName },
      });

      if (!app) {
        return {
          success: true,
          message: 'Aplicação não encontrada.',
          data: null,
        };
      }

      const deployment = await this.deploymentRepository.findMany({
        where: {
          appId: app.id,
          environment,
          status: DEPLOYMENT_STATUS.COMPLETED,
        },
        orderBy: { completedAt: 'desc' },
        take: 1,
        include,
      });

      if (!deployment.data || deployment.data.length === 0) {
        return {
          success: true,
          message: 'Nenhum deployment encontrado para esta aplicação e ambiente.',
          data: null,
        };
      }

      return {
        success: true,
        message: 'Deployment atual encontrado com sucesso.',
        data: deployment.data[0],
      };
    } catch (error) {
      this.logger.error(`Erro ao buscar deployment atual: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get available commits for deployment
   */
  async getAvailableCommits(
    limit: number = 50,
    repositoryName?: string,
  ): Promise<{ success: boolean; message: string; data: any[] }> {
    try {
      // Query commits from database with repository information
      const where: any = {};

      // If repository name is provided, filter by it
      if (repositoryName) {
        where.repository = {
          name: repositoryName,
        };
      }

      const commits = await this.prisma.gitCommit.findMany({
        where,
        take: limit,
        orderBy: {
          committedAt: 'desc',
        },
        include: {
          repository: {
            select: {
              id: true,
              name: true,
              gitUrl: true,
              branch: true,
            },
          },
        },
      });

      // Format the response
      const formattedCommits = commits.map((commit) => ({
        hash: commit.hash,
        shortHash: commit.shortHash,
        author: commit.author,
        email: commit.authorEmail,
        date: commit.committedAt,
        message: commit.message,
        body: '', // Not stored in DB currently
        branch: commit.branch,
        repository: {
          id: commit.repository.id,
          name: commit.repository.name,
          gitUrl: commit.repository.gitUrl,
          branch: commit.repository.branch,
        },
      }));

      return {
        success: true,
        message: 'Commits encontrados com sucesso.',
        data: formattedCommits,
      };
    } catch (error) {
      this.logger.error(`Erro ao buscar commits: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Cancel running deployment
   */
  async cancelDeployment(
    id: string,
    userId: string,
    include?: DeploymentInclude,
  ): Promise<DeploymentUpdateResponse> {
    try {
      const existing = await this.deploymentRepository.findById(id);

      if (!existing) {
        throw new NotFoundException('Deployment não encontrado.');
      }

      if (
        existing.status !== DEPLOYMENT_STATUS.PENDING &&
        existing.status !== DEPLOYMENT_STATUS.IN_PROGRESS &&
        existing.status !== DEPLOYMENT_STATUS.BUILDING &&
        existing.status !== DEPLOYMENT_STATUS.TESTING &&
        existing.status !== DEPLOYMENT_STATUS.DEPLOYING
      ) {
        throw new BadRequestException('Deployment não pode ser cancelado neste status.');
      }

      const deployment = await this.deploymentRepository.update(
        id,
        {
          status: DEPLOYMENT_STATUS.CANCELLED,
          completedAt: new Date(),
        },
        { include },
      );

      // Log cancellation
      await trackAndLogFieldChanges({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.DEPLOYMENT,
        entityId: id,
        oldEntity: existing,
        newEntity: deployment,
        fieldsToTrack: ['status', 'completedAt', 'error'],
        userId,
        triggeredBy: CHANGE_TRIGGERED_BY.USER,
      });

      return {
        success: true,
        message: 'Deployment cancelado com sucesso.',
        data: deployment,
      };
    } catch (error) {
      this.logger.error(`Erro ao cancelar deployment: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handle GitHub webhook
   * TODO: Reimplement for multi-repository system
   */
  /* COMMENTED OUT - Needs rewrite for new multi-repo schema
  async handleWebhook(payload: any): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log('Received webhook payload');

      // Extract commit information
      const { ref, commits, repository } = payload;

      // Only process main branch
      if (ref !== 'refs/heads/main') {
        return {
          success: true,
          message: 'Webhook ignored - not main branch',
        };
      }

      if (!commits || commits.length === 0) {
        return {
          success: true,
          message: 'Webhook ignored - no commits',
        };
      }

      // Get latest commit
      const latestCommit = commits[commits.length - 1];

      // Determine application based on repository or default to API
      // TODO: Make this configurable based on webhook payload
      const application = DEPLOYMENT_APPLICATION.API;

      // Create deployment for STAGING environment (auto-deploy to test)
      await this.createDeployment(
        application,
        latestCommit.id,
        DEPLOYMENT_ENVIRONMENT.STAGING, // This is the test environment
        undefined, // No user ID for webhook
        DEPLOYMENT_TRIGGER.WEBHOOK,
      );

      return {
        success: true,
        message: 'Deployment triggered successfully',
      };
    } catch (error) {
      this.logger.error(`Webhook handling error: ${error.message}`, error.stack);
      throw error;
    }
  }
  */

  async handleWebhook(payload: any): Promise<{ success: boolean; message: string }> {
    // Temporary stub until rewrite for multi-repo system
    this.logger.warn('handleWebhook called but not yet implemented for multi-repo system');
    return {
      success: true,
      message: 'Webhook handling temporarily disabled - pending multi-repo implementation',
    };
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    try {
      const hmac = crypto.createHmac('sha256', secret);
      const expectedSignature = 'sha256=' + hmac.update(payload).digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );
    } catch (error) {
      this.logger.error(`Signature verification error: ${error.message}`);
      return false;
    }
  }

  /**
   * Execute deployment asynchronously
   */
  private executeDeploymentAsync(
    deploymentId: string,
    application: DEPLOYMENT_APPLICATION,
    environment: DEPLOYMENT_ENVIRONMENT,
    commitHash: string,
    branch: string,
  ): void {
    // Run deployment in background
    this.deploymentExecutor
      .executeDeployment({
        deploymentId,
        application,
        environment,
        commitHash,
        branch,
      })
      .catch((error) => {
        this.logger.error(`Deployment ${deploymentId} failed in background: ${error.message}`);
      });
  }
}
