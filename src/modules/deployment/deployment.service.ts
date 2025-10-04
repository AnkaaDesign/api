import { Injectable, BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { DeploymentApplication, DeploymentEnvironment, DeploymentStatus, DeploymentTrigger, Prisma } from '@prisma/client';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';

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
  application: DeploymentApplication;
  environment: DeploymentEnvironment;
  repoPath: string;
  deployScript: string;
  port: number;
  pm2Name: string;
}

@Injectable()
export class DeploymentService {
  private readonly configs: DeploymentConfig[] = [
    {
      application: DeploymentApplication.API,
      environment: DeploymentEnvironment.STAGING,
      repoPath: '/home/kennedy/ankaa/separating/api',
      deployScript: 'deploy-test.sh',
      port: 3031,
      pm2Name: 'ankaa-api-test'
    },
    {
      application: DeploymentApplication.API,
      environment: DeploymentEnvironment.PRODUCTION,
      repoPath: '/home/kennedy/ankaa/separating/api',
      deployScript: 'deploy-production.sh',
      port: 3030,
      pm2Name: 'ankaa-api'
    },
    {
      application: DeploymentApplication.WEB,
      environment: DeploymentEnvironment.STAGING,
      repoPath: '/home/kennedy/ankaa/separating/web',
      deployScript: 'deploy-test.sh',
      port: 0, // Web apps don't have ports
      pm2Name: ''
    },
    {
      application: DeploymentApplication.WEB,
      environment: DeploymentEnvironment.PRODUCTION,
      repoPath: '/home/kennedy/ankaa/separating/web',
      deployScript: 'deploy-production.sh',
      port: 0,
      pm2Name: ''
    },
    {
      application: DeploymentApplication.MOBILE,
      environment: DeploymentEnvironment.STAGING,
      repoPath: '/home/kennedy/ankaa/separating/mobile',
      deployScript: '',
      port: 0,
      pm2Name: ''
    },
    {
      application: DeploymentApplication.MOBILE,
      environment: DeploymentEnvironment.PRODUCTION,
      repoPath: '/home/kennedy/ankaa/separating/mobile',
      deployScript: '',
      port: 0,
      pm2Name: ''
    }
  ];

  constructor(private readonly prisma: PrismaService) {}

  private getConfig(application: DeploymentApplication, environment: DeploymentEnvironment): DeploymentConfig {
    const config = this.configs.find(c => c.application === application && c.environment === environment);
    if (!config) {
      throw new BadRequestException(`Configuration not found for ${application} in ${environment}`);
    }
    return config;
  }

  async getCommits(
    application: DeploymentApplication,
    environment: DeploymentEnvironment,
    limit = 20
  ): Promise<GitCommit[]> {
    const config = this.getConfig(application, environment);

    try {
      // Fetch latest changes from remote
      await execAsync(`cd ${config.repoPath} && git fetch --all`);

      // Get commit list
      const { stdout } = await execAsync(
        `cd ${config.repoPath} && git log --pretty=format:"%H|%h|%an|%ad|%s" --date=iso -n ${limit} origin/main`,
      );

      const commits: GitCommit[] = stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [hash, shortHash, author, date, message] = line.split('|');
          return {
            hash,
            shortHash,
            author,
            date,
            message,
            branch: 'main'
          };
        });

      return commits;
    } catch (error) {
      console.error('Error fetching commits:', error);
      throw new InternalServerErrorException('Failed to fetch commits');
    }
  }

  async getCurrentDeployment(
    application: DeploymentApplication,
    environment: DeploymentEnvironment
  ) {
    return this.prisma.deployment.findFirst({
      where: {
        application,
        environment,
        status: DeploymentStatus.COMPLETED
      },
      orderBy: {
        completedAt: 'desc'
      },
      include: {
        user: true
      }
    });
  }

  async getDeploymentHistory(
    application?: DeploymentApplication,
    environment?: DeploymentEnvironment,
    limit = 50
  ) {
    const where: Prisma.DeploymentWhereInput = {};

    if (application) where.application = application;
    if (environment) where.environment = environment;

    return this.prisma.deployment.findMany({
      where,
      orderBy: {
        createdAt: 'desc'
      },
      take: limit,
      include: {
        user: true
      }
    });
  }

  async getDeploymentById(id: string) {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id },
      include: {
        user: true
      }
    });

    if (!deployment) {
      throw new NotFoundException('Deployment not found');
    }

    return deployment;
  }

  async deploy(
    application: DeploymentApplication,
    environment: DeploymentEnvironment,
    commitHash: string,
    userId?: string,
    trigger: DeploymentTrigger = DeploymentTrigger.MANUAL
  ) {
    const config = this.getConfig(application, environment);

    // Check if there's already a deployment in progress
    const inProgress = await this.prisma.deployment.findFirst({
      where: {
        application,
        environment,
        status: {
          in: [
            DeploymentStatus.PENDING,
            DeploymentStatus.IN_PROGRESS,
            DeploymentStatus.BUILDING,
            DeploymentStatus.DEPLOYING
          ]
        }
      }
    });

    if (inProgress) {
      throw new BadRequestException('A deployment is already in progress for this application and environment');
    }

    // Get commit details
    let commitMessage = '';
    let commitAuthor = '';
    try {
      const { stdout: message } = await execAsync(
        `cd ${config.repoPath} && git log -1 --pretty=format:"%s" ${commitHash}`
      );
      const { stdout: author } = await execAsync(
        `cd ${config.repoPath} && git log -1 --pretty=format:"%an" ${commitHash}`
      );
      commitMessage = message.trim();
      commitAuthor = author.trim();
    } catch (error) {
      console.error('Error fetching commit details:', error);
    }

    // Create deployment record
    const deployment = await this.prisma.deployment.create({
      data: {
        application,
        environment,
        commitSha: commitHash,
        commitMessage,
        commitAuthor,
        branch: 'main',
        status: DeploymentStatus.PENDING,
        statusOrder: 1,
        triggeredBy: trigger,
        deployedBy: userId,
        startedAt: new Date()
      }
    });

    // Start deployment in background
    this.executeDeployment(deployment.id, config, commitHash).catch(error => {
      console.error('Deployment failed:', error);
      this.updateDeploymentStatus(deployment.id, DeploymentStatus.FAILED, error.message);
    });

    return deployment;
  }

  private async checkPortAvailable(port: number): Promise<boolean> {
    if (port === 0) return true; // Web apps don't use ports

    try {
      const { stdout } = await execAsync(`lsof -i :${port}`);
      return stdout.trim() === '';
    } catch (error) {
      // If lsof returns error, it means no process is using the port
      return true;
    }
  }

  private async findAvailablePort(basePort: number, maxTries = 10): Promise<number> {
    for (let i = 0; i < maxTries; i++) {
      const port = basePort + i;
      if (await this.checkPortAvailable(port)) {
        return port;
      }
    }
    throw new Error(`No available port found starting from ${basePort}`);
  }

  private async executeDeployment(deploymentId: string, config: DeploymentConfig, commitHash: string) {
    let logs = '';

    try {
      // Update status to IN_PROGRESS
      await this.updateDeploymentStatus(deploymentId, DeploymentStatus.IN_PROGRESS);

      // Checkout the specific commit
      logs += `Checking out commit ${commitHash}\\n`;
      await this.updateDeploymentLog(deploymentId, logs);

      const { stdout: checkoutOut, stderr: checkoutErr } = await execAsync(
        `cd ${config.repoPath} && git checkout ${commitHash}`
      );
      logs += checkoutOut + checkoutErr + '\\n';
      await this.updateDeploymentLog(deploymentId, logs);

      // Update status to BUILDING
      await this.updateDeploymentStatus(deploymentId, DeploymentStatus.BUILDING);

      // Build the application
      logs += 'Building application...\\n';
      await this.updateDeploymentLog(deploymentId, logs);

      if (config.application === DeploymentApplication.API) {
        const { stdout: buildOut, stderr: buildErr } = await execAsync(
          `cd ${config.repoPath} && pnpm build`,
          { maxBuffer: 1024 * 1024 * 10 } // 10MB buffer
        );
        logs += buildOut + buildErr + '\\n';
        await this.updateDeploymentLog(deploymentId, logs);
      } else if (config.application === DeploymentApplication.WEB) {
        const envPrefix = config.environment === DeploymentEnvironment.STAGING
          ? 'VITE_API_URL=https://test.api.ankaa.live'
          : 'VITE_API_URL=https://api.ankaa.live';

        const { stdout: buildOut, stderr: buildErr } = await execAsync(
          `cd ${config.repoPath} && ${envPrefix} pnpm build`,
          { maxBuffer: 1024 * 1024 * 10 }
        );
        logs += buildOut + buildErr + '\\n';
        await this.updateDeploymentLog(deploymentId, logs);
      }

      // Update status to DEPLOYING
      await this.updateDeploymentStatus(deploymentId, DeploymentStatus.DEPLOYING);

      // Deploy the application
      logs += 'Deploying application...\\n';
      await this.updateDeploymentLog(deploymentId, logs);

      if (config.application === DeploymentApplication.API) {
        // Check port availability and find alternative if needed
        let deployPort = config.port;
        if (!await this.checkPortAvailable(config.port)) {
          logs += `Port ${config.port} is in use, finding alternative...\\n`;
          await this.updateDeploymentLog(deploymentId, logs);

          try {
            // Try to stop the existing PM2 process first
            const pm2Name = config.pm2Name;
            await execAsync(`pm2 stop ${pm2Name}`).catch(() => {});
            await execAsync(`pm2 delete ${pm2Name}`).catch(() => {}); // Ignore if doesn't exist

            // Wait a moment for port to be released
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Check again
            if (!await this.checkPortAvailable(config.port)) {
              deployPort = await this.findAvailablePort(config.port + 1);
              logs += `WARNING: Using alternative port ${deployPort} instead of ${config.port}\\n`;
              await this.updateDeploymentLog(deploymentId, logs);
            }
          } catch (error) {
            logs += `Error handling port conflict: ${error.message}\\n`;
            await this.updateDeploymentLog(deploymentId, logs);
            throw new Error(`Port ${config.port} is in use and could not be freed`);
          }
        } else {
          // Stop and restart PM2 process
          const pm2Name = config.pm2Name;
          await execAsync(`pm2 delete ${pm2Name}`).catch(() => {}); // Ignore if doesn't exist
        }

        const envVars = this.getEnvVars(config.environment);
        const pm2Name = config.pm2Name;
        const { stdout: pm2Out, stderr: pm2Err } = await execAsync(
          `cd ${config.repoPath} && ${envVars} PORT=${deployPort} pm2 start dist/main.js --name ${pm2Name}`,
          { maxBuffer: 1024 * 1024 * 10 }
        );
        logs += pm2Out + pm2Err + '\\n';
        await this.updateDeploymentLog(deploymentId, logs);

        // If we used an alternative port, log a warning
        if (deployPort !== config.port) {
          logs += `\\n⚠️ IMPORTANT: API deployed on port ${deployPort} instead of ${config.port}\\n`;
          logs += `Update nginx configuration if needed.\\n`;
          await this.updateDeploymentLog(deploymentId, logs);
        }

        // Save PM2 config
        await execAsync('pm2 save');
      } else if (config.application === DeploymentApplication.WEB) {
        // Deploy web files
        const deployDir = config.environment === DeploymentEnvironment.STAGING
          ? '/var/www/test.ankaa.live'
          : '/var/www/ankaa.live';

        const { stdout: cpOut, stderr: cpErr } = await execAsync(
          `sudo rm -rf ${deployDir}/* && sudo cp -r ${config.repoPath}/dist/* ${deployDir}/`
        );
        logs += cpOut + cpErr + '\\n';
        await this.updateDeploymentLog(deploymentId, logs);
      }

      // Update deployment as completed
      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: {
          status: DeploymentStatus.COMPLETED,
          statusOrder: 6,
          completedAt: new Date(),
          deploymentLog: logs
        }
      });

    } catch (error) {
      console.error('Deployment execution failed:', error);
      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: {
          status: DeploymentStatus.FAILED,
          statusOrder: 7,
          completedAt: new Date(),
          errorMessage: error.message,
          deploymentLog: logs
        }
      });
      throw error;
    }
  }

  private getEnvVars(environment: DeploymentEnvironment): string {
    const baseVars = `DATABASE_URL="${process.env.DATABASE_URL}" JWT_SECRET="${process.env.JWT_SECRET}" SECULLUM_EMAIL="${process.env.SECULLUM_EMAIL}" SECULLUM_PASSWORD="${process.env.SECULLUM_PASSWORD}" SECULLUM_BASE_URL="${process.env.SECULLUM_BASE_URL}" SECULLUM_DATABASE_ID="${process.env.SECULLUM_DATABASE_ID}" SECULLUM_CLIENT_ID="${process.env.SECULLUM_CLIENT_ID}" EMAIL_USER="${process.env.EMAIL_USER}" EMAIL_PASS="${process.env.EMAIL_PASS}" TWILIO_ACCOUNT_SID="${process.env.TWILIO_ACCOUNT_SID}" TWILIO_AUTH_TOKEN="${process.env.TWILIO_AUTH_TOKEN}" TWILIO_PHONE_NUMBER="${process.env.TWILIO_PHONE_NUMBER}"`;

    const nodeEnv = environment === DeploymentEnvironment.PRODUCTION ? 'production' : 'test';
    return `NODE_ENV=${nodeEnv} ${baseVars}`;
  }

  private async updateDeploymentStatus(deploymentId: string, status: DeploymentStatus, errorMessage?: string) {
    const statusOrder = this.getStatusOrder(status);

    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status,
        statusOrder,
        ...(errorMessage && { errorMessage })
      }
    });
  }

  private async updateDeploymentLog(deploymentId: string, log: string) {
    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        deploymentLog: log
      }
    });
  }

  private getStatusOrder(status: DeploymentStatus): number {
    const orders = {
      [DeploymentStatus.PENDING]: 1,
      [DeploymentStatus.IN_PROGRESS]: 2,
      [DeploymentStatus.BUILDING]: 3,
      [DeploymentStatus.TESTING]: 4,
      [DeploymentStatus.DEPLOYING]: 5,
      [DeploymentStatus.COMPLETED]: 6,
      [DeploymentStatus.FAILED]: 7,
      [DeploymentStatus.ROLLED_BACK]: 8,
      [DeploymentStatus.CANCELLED]: 9
    };
    return orders[status] || 1;
  }

  async cancelDeployment(id: string) {
    const deployment = await this.getDeploymentById(id);

    if (deployment.status === DeploymentStatus.COMPLETED ||
        deployment.status === DeploymentStatus.FAILED ||
        deployment.status === DeploymentStatus.CANCELLED) {
      throw new BadRequestException('Cannot cancel a deployment that has already finished');
    }

    await this.updateDeploymentStatus(id, DeploymentStatus.CANCELLED);

    return { success: true, message: 'Deployment cancelled' };
  }

  async getDeploymentLogs(id: string) {
    const deployment = await this.getDeploymentById(id);
    return {
      id: deployment.id,
      status: deployment.status,
      logs: deployment.deploymentLog || '',
      errorMessage: deployment.errorMessage
    };
  }

  async rollback(
    application: DeploymentApplication,
    environment: DeploymentEnvironment,
    userId?: string
  ) {
    // Get the current deployment
    const current = await this.getCurrentDeployment(application, environment);
    if (!current) {
      throw new BadRequestException('No current deployment found to rollback from');
    }

    // Get the previous successful deployment
    const previous = await this.prisma.deployment.findFirst({
      where: {
        application,
        environment,
        status: DeploymentStatus.COMPLETED,
        completedAt: {
          lt: current.completedAt
        }
      },
      orderBy: {
        completedAt: 'desc'
      }
    });

    if (!previous) {
      throw new BadRequestException('No previous deployment found to rollback to');
    }

    // Deploy the previous commit
    return this.deploy(
      application,
      environment,
      previous.commitSha,
      userId,
      DeploymentTrigger.ROLLBACK
    );
  }
}