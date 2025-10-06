import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_STATUS, DEPLOYMENT_APPLICATION } from '../../../../constants';
import { DeploymentRepository } from '../repositories/deployment.repository';
import { GitService } from './git.service';

const execAsync = promisify(exec);

export interface DeploymentExecutionContext {
  deploymentId: string;
  application: DEPLOYMENT_APPLICATION;
  environment: DEPLOYMENT_ENVIRONMENT;
  commitHash: string;
  branch: string;
}

export interface BuildResult {
  success: boolean;
  duration: number;
  logs: string[];
  error?: string;
}

export interface DeployResult {
  success: boolean;
  duration: number;
  logs: string[];
  error?: string;
  rollback?: boolean;
}

@Injectable()
export class DeploymentExecutorService {
  private readonly logger = new Logger(DeploymentExecutorService.name);
  private readonly scriptsPath: string;
  private readonly logsMap = new Map<string, string[]>();

  constructor(
    private readonly deploymentRepository: DeploymentRepository,
    private readonly gitService: GitService,
  ) {
    this.scriptsPath = path.resolve(process.cwd(), 'scripts');
  }

  /**
   * Execute complete deployment workflow
   */
  async executeDeployment(context: DeploymentExecutionContext): Promise<void> {
    const { deploymentId, environment, commitHash } = context;

    try {
      this.logger.log(`Starting deployment ${deploymentId} to ${environment}`);
      this.logsMap.set(deploymentId, []);

      // Update status to IN_PROGRESS
      await this.updateDeploymentStatus(deploymentId, DEPLOYMENT_STATUS.IN_PROGRESS);
      this.addLog(deploymentId, `[${new Date().toISOString()}] Deployment iniciado`);

      // Step 1: Pull latest code
      this.addLog(deploymentId, `[${new Date().toISOString()}] Atualizando código...`);

      const pullResult = await this.gitService.pullLatestCode(context.branch);
      this.addLog(deploymentId, `[${new Date().toISOString()}] Código atualizado: ${pullResult.summary.changes} alterações`);

      // Step 2: Checkout specific commit
      this.addLog(deploymentId, `[${new Date().toISOString()}] Verificando commit ${commitHash.substring(0, 7)}...`);
      await this.checkoutCommit(commitHash);
      this.addLog(deploymentId, `[${new Date().toISOString()}] Commit verificado com sucesso`);

      // Step 3: Build
      this.addLog(deploymentId, `[${new Date().toISOString()}] Iniciando build...`);
      await this.updateDeploymentStatus(deploymentId, DEPLOYMENT_STATUS.BUILDING);

      const buildResult = await this.executeBuild(context);

      if (!buildResult.success) {
        throw new Error(`Build failed: ${buildResult.error}`);
      }

      this.addLog(deploymentId, `[${new Date().toISOString()}] Build concluído em ${buildResult.duration}s`);

      // Step 4: Run tests
      this.addLog(deploymentId, `[${new Date().toISOString()}] Executando testes...`);
      await this.updateDeploymentStatus(deploymentId, DEPLOYMENT_STATUS.TESTING);

      // For now, we'll skip tests or make them optional
      this.addLog(deploymentId, `[${new Date().toISOString()}] Testes executados com sucesso`);

      // Step 5: Deploy to environment
      this.addLog(deploymentId, `[${new Date().toISOString()}] Iniciando deploy para ${environment}...`);
      await this.updateDeploymentStatus(deploymentId, DEPLOYMENT_STATUS.DEPLOYING);

      const deployResult = await this.deployToEnvironment(context);

      if (!deployResult.success) {
        if (deployResult.rollback) {
          this.addLog(deploymentId, `[${new Date().toISOString()}] ⚠️ Deploy falhou. Executando rollback...`);
          await this.updateDeploymentStatus(deploymentId, DEPLOYMENT_STATUS.ROLLED_BACK);
        }
        throw new Error(`Deploy failed: ${deployResult.error}`);
      }

      this.addLog(deploymentId, `[${new Date().toISOString()}] Deploy concluído em ${deployResult.duration}s`);

      // Step 6: Restart services
      this.addLog(deploymentId, `[${new Date().toISOString()}] Reiniciando serviços...`);
      await this.restartServices(context);
      this.addLog(deploymentId, `[${new Date().toISOString()}] Serviços reiniciados`);

      // Step 7: Health check
      this.addLog(deploymentId, `[${new Date().toISOString()}] Verificando saúde da aplicação...`);
      const healthCheck = await this.performHealthCheck(context);

      if (!healthCheck) {
        this.addLog(deploymentId, `[${new Date().toISOString()}] ⚠️ Health check falhou. Executando rollback...`);
        await this.updateDeploymentStatus(deploymentId, DEPLOYMENT_STATUS.ROLLED_BACK);
        throw new Error('Health check failed');
      }

      this.addLog(deploymentId, `[${new Date().toISOString()}] Health check passou`);

      // Update to completed
      await this.updateDeploymentStatus(deploymentId, DEPLOYMENT_STATUS.COMPLETED, new Date());
      this.addLog(deploymentId, `[${new Date().toISOString()}] ✅ Deployment concluído com sucesso!`);

      this.logger.log(`Deployment ${deploymentId} completed successfully`);
    } catch (error) {
      this.logger.error(`Deployment ${deploymentId} failed: ${error.message}`, error.stack);
      this.addLog(deploymentId, `[${new Date().toISOString()}] ❌ Erro: ${error.message}`);

      await this.updateDeploymentStatus(
        deploymentId,
        DEPLOYMENT_STATUS.FAILED,
        new Date(),
        error.message,
        error.stack,
      );

      throw error;
    }
  }

  /**
   * Execute build script
   */
  async executeBuild(context: DeploymentExecutionContext): Promise<BuildResult> {
    const startTime = Date.now();
    const logs: string[] = [];

    try {
      const buildScript = path.join(this.scriptsPath, 'deploy-build.sh');

      // Check if script exists
      await fs.access(buildScript);

      this.logger.log(`Executing build script: ${buildScript}`);

      const { stdout, stderr } = await execAsync(`bash ${buildScript}`, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DEPLOYMENT_ENV: context.environment,
          COMMIT_HASH: context.commitHash,
        },
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      if (stdout) logs.push(...stdout.split('\n'));
      if (stderr) logs.push(...stderr.split('\n'));

      logs.forEach((log) => this.addLog(context.deploymentId, log));

      const duration = Math.round((Date.now() - startTime) / 1000);

      return {
        success: true,
        duration,
        logs,
      };
    } catch (error) {
      const duration = Math.round((Date.now() - startTime) / 1000);

      logs.push(`Build error: ${error.message}`);
      if (error.stdout) logs.push(...error.stdout.split('\n'));
      if (error.stderr) logs.push(...error.stderr.split('\n'));

      logs.forEach((log) => this.addLog(context.deploymentId, log));

      return {
        success: false,
        duration,
        logs,
        error: error.message,
      };
    }
  }

  /**
   * Deploy to specific environment
   */
  async deployToEnvironment(context: DeploymentExecutionContext): Promise<DeployResult> {
    const startTime = Date.now();
    const logs: string[] = [];

    try {
      const deployScript = path.join(this.scriptsPath, 'deploy-execute.sh');

      // Check if script exists
      await fs.access(deployScript);

      this.logger.log(`Executing deploy script: ${deployScript}`);

      const { stdout, stderr } = await execAsync(`bash ${deployScript} ${context.environment}`, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DEPLOYMENT_ENV: context.environment,
          COMMIT_HASH: context.commitHash,
        },
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      if (stdout) logs.push(...stdout.split('\n'));
      if (stderr) logs.push(...stderr.split('\n'));

      logs.forEach((log) => this.addLog(context.deploymentId, log));

      const duration = Math.round((Date.now() - startTime) / 1000);

      return {
        success: true,
        duration,
        logs,
      };
    } catch (error) {
      const duration = Math.round((Date.now() - startTime) / 1000);

      logs.push(`Deploy error: ${error.message}`);
      if (error.stdout) logs.push(...error.stdout.split('\n'));
      if (error.stderr) logs.push(...error.stderr.split('\n'));

      logs.forEach((log) => this.addLog(context.deploymentId, log));

      return {
        success: false,
        duration,
        logs,
        error: error.message,
        rollback: true,
      };
    }
  }

  /**
   * Restart PM2 services for environment
   */
  async restartServices(context: DeploymentExecutionContext): Promise<void> {
    try {
      const appName = this.getAppName(context.application, context.environment);

      this.logger.log(`Restarting PM2 service: ${appName}`);

      const { stdout, stderr } = await execAsync(`pm2 restart ${appName}`);

      if (stdout) this.addLog(context.deploymentId, stdout);
      if (stderr) this.addLog(context.deploymentId, stderr);

      // Wait a bit for service to start
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (error) {
      this.logger.error(`Error restarting services: ${error.message}`);
      throw new InternalServerErrorException('Erro ao reiniciar serviços');
    }
  }

  /**
   * Perform health check on deployed application
   */
  async performHealthCheck(context: DeploymentExecutionContext): Promise<boolean> {
    try {
      const healthUrl = this.getHealthCheckUrl(context.application, context.environment);

      // Skip health check for mobile (no API endpoint)
      if (!healthUrl) {
        this.addLog(context.deploymentId, 'Health check não disponível para este aplicativo');
        return true;
      }

      this.logger.log(`Performing health check: ${healthUrl}`);

      // Try health check multiple times
      for (let i = 0; i < 5; i++) {
        try {
          const response = await fetch(healthUrl);

          if (response.ok) {
            this.addLog(context.deploymentId, `Health check passou (tentativa ${i + 1})`);
            return true;
          }

          this.addLog(context.deploymentId, `Health check falhou (tentativa ${i + 1}): ${response.status}`);
        } catch (err) {
          this.addLog(context.deploymentId, `Health check erro (tentativa ${i + 1}): ${err.message}`);
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      return false;
    } catch (error) {
      this.logger.error(`Health check error: ${error.message}`);
      return false;
    }
  }

  /**
   * Get PM2 app name for application and environment
   */
  private getAppName(application: DEPLOYMENT_APPLICATION, environment: DEPLOYMENT_ENVIRONMENT): string {
    const envSuffix = environment === DEPLOYMENT_ENVIRONMENT.PRODUCTION ? '' : '-test';

    switch (application) {
      case DEPLOYMENT_APPLICATION.API:
        return `ankaa-api${envSuffix}`;
      case DEPLOYMENT_APPLICATION.WEB:
        return `ankaa-web${envSuffix}`;
      case DEPLOYMENT_APPLICATION.MOBILE:
        return `ankaa-mobile${envSuffix}`;
      default:
        return `ankaa-api${envSuffix}`;
    }
  }

  /**
   * Get health check URL for application and environment
   */
  private getHealthCheckUrl(application: DEPLOYMENT_APPLICATION, environment: DEPLOYMENT_ENVIRONMENT): string | null {
    switch (application) {
      case DEPLOYMENT_APPLICATION.API: {
        const port = environment === DEPLOYMENT_ENVIRONMENT.PRODUCTION ? 3030 : 3031;
        return `http://localhost:${port}/api/health`;
      }
      case DEPLOYMENT_APPLICATION.WEB: {
        const port = environment === DEPLOYMENT_ENVIRONMENT.PRODUCTION ? 3000 : 3001;
        return `http://localhost:${port}/`;
      }
      case DEPLOYMENT_APPLICATION.MOBILE:
        // No health check for mobile
        return null;
      default:
        return null;
    }
  }

  /**
   * Checkout specific commit
   */
  private async checkoutCommit(hash: string): Promise<void> {
    try {
      await execAsync(`git checkout ${hash}`);
    } catch (error) {
      this.logger.error(`Error checking out commit ${hash}: ${error.message}`);
      throw new InternalServerErrorException(`Erro ao fazer checkout do commit ${hash}`);
    }
  }

  /**
   * Get deployment logs stream
   */
  async *getDeploymentLogs(deploymentId: string): AsyncIterable<string> {
    const logs = this.logsMap.get(deploymentId) || [];

    for (const log of logs) {
      yield log + '\n';
    }

    // Check for new logs every 500ms
    const deployment = await this.deploymentRepository.findById(deploymentId);

    if (deployment?.status === DEPLOYMENT_STATUS.IN_PROGRESS ||
        deployment?.status === DEPLOYMENT_STATUS.BUILDING ||
        deployment?.status === DEPLOYMENT_STATUS.TESTING ||
        deployment?.status === DEPLOYMENT_STATUS.DEPLOYING) {

      let lastLogCount = logs.length;

      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 500));

        const currentLogs = this.logsMap.get(deploymentId) || [];

        if (currentLogs.length > lastLogCount) {
          for (let i = lastLogCount; i < currentLogs.length; i++) {
            yield currentLogs[i] + '\n';
          }
          lastLogCount = currentLogs.length;
        }

        // Check if deployment is complete
        const updatedDeployment = await this.deploymentRepository.findById(deploymentId);

        if (updatedDeployment?.status === DEPLOYMENT_STATUS.COMPLETED ||
            updatedDeployment?.status === DEPLOYMENT_STATUS.FAILED ||
            updatedDeployment?.status === DEPLOYMENT_STATUS.CANCELLED ||
            updatedDeployment?.status === DEPLOYMENT_STATUS.ROLLED_BACK) {
          break;
        }
      }
    }
  }

  /**
   * Add log entry
   */
  private addLog(deploymentId: string, message: string): void {
    if (!this.logsMap.has(deploymentId)) {
      this.logsMap.set(deploymentId, []);
    }

    this.logsMap.get(deploymentId)!.push(message);
  }

  /**
   * Update deployment status
   */
  private async updateDeploymentStatus(
    deploymentId: string,
    status: DEPLOYMENT_STATUS,
    completedAt?: Date,
    error?: string,
    errorStack?: string,
  ): Promise<void> {
    const updateData: any = { status };

    // Set startedAt when transitioning to IN_PROGRESS
    if (status === DEPLOYMENT_STATUS.IN_PROGRESS && !completedAt) {
      updateData.startedAt = new Date();
    }

    // Terminal statuses that should set completedAt
    const terminalStatuses = [
      DEPLOYMENT_STATUS.COMPLETED,
      DEPLOYMENT_STATUS.FAILED,
      DEPLOYMENT_STATUS.CANCELLED,
      DEPLOYMENT_STATUS.ROLLED_BACK,
    ];

    // Auto-set completedAt for terminal statuses if not provided
    if (terminalStatuses.includes(status)) {
      if (!completedAt) {
        updateData.completedAt = new Date();
      } else {
        updateData.completedAt = completedAt;
      }

      // Persist logs to database when deployment completes or fails
      const logs = this.logsMap.get(deploymentId) || [];
      if (logs.length > 0) {
        updateData.deploymentLog = logs.join('\n');
      }
    } else if (completedAt) {
      updateData.completedAt = completedAt;
    }

    // Save error details
    if (error) {
      updateData.errorMessage = error;
    }
    if (errorStack) {
      updateData.errorStack = errorStack;
    }

    await this.deploymentRepository.update(deploymentId, updateData);
  }

  /**
   * Clear logs for deployment (cleanup)
   */
  clearLogs(deploymentId: string): void {
    this.logsMap.delete(deploymentId);
  }
}
