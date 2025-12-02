import { Injectable, Logger } from '@nestjs/common';
import {
  BuildInfo,
  DeploymentInfo,
  HealthCheckResponse,
  SystemInfo,
  ServiceHealthStatus,
} from '@types';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  private readonly startTime = Date.now();
  private buildInfo: (BuildInfo & DeploymentInfo) | null = null;

  constructor() {
    this.loadBuildInfo();
  }

  getHello(): string {
    return 'Ankaa API - Manufacturing Management System';
  }

  /**
   * Load build information from build-info.json
   * This file is generated during the build process
   */
  private loadBuildInfo(): void {
    try {
      // Try multiple locations for build-info.json
      const possiblePaths = [
        path.join(__dirname, '..', 'build-info.json'),
        path.join(__dirname, '..', '..', 'build-info.json'),
        path.join(__dirname, '..', '..', '..', 'build-info.json'),
        path.join(process.cwd(), 'build-info.json'),
        path.join(process.cwd(), 'dist', 'build-info.json'),
      ];

      for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          this.buildInfo = JSON.parse(fileContent);
          this.logger.log(`Build info loaded from: ${filePath}`);
          this.logger.log(
            `Version: ${this.buildInfo?.version}, Commit: ${this.buildInfo?.gitCommitShort}`,
          );
          return;
        }
      }

      this.logger.warn('build-info.json not found, using fallback values');
      this.buildInfo = this.getFallbackBuildInfo();
    } catch (error) {
      this.logger.error('Failed to load build info:', error);
      this.buildInfo = this.getFallbackBuildInfo();
    }
  }

  /**
   * Fallback build info when file is not available
   */
  private getFallbackBuildInfo(): BuildInfo & DeploymentInfo {
    return {
      version: process.env.npm_package_version || '0.0.1',
      gitCommitSha: process.env.GIT_COMMIT_SHA || 'unknown',
      gitCommitShort: process.env.GIT_COMMIT_SHORT || 'unknown',
      gitBranch: process.env.GIT_BRANCH || 'unknown',
      buildTimestamp: new Date().toISOString(),
      buildNumber: process.env.BUILD_NUMBER || 'local',
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      deployedBy: process.env.USER || 'unknown',
      deployedAt: new Date().toISOString(),
      deploymentMethod: 'manual',
    };
  }

  /**
   * Get comprehensive health check information
   */
  getHealthCheck(): HealthCheckResponse {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000), // in seconds
      version: {
        version: this.buildInfo?.version || '0.0.1',
        gitCommitSha: this.buildInfo?.gitCommitSha || 'unknown',
        gitCommitShort: this.buildInfo?.gitCommitShort || 'unknown',
        gitBranch: this.buildInfo?.gitBranch || 'unknown',
        buildTimestamp: this.buildInfo?.buildTimestamp || new Date().toISOString(),
        buildNumber: this.buildInfo?.buildNumber,
        environment: this.buildInfo?.environment || process.env.NODE_ENV || 'development',
        nodeVersion: this.buildInfo?.nodeVersion || process.version,
      },
      deployment: {
        deployedBy: this.buildInfo?.deployedBy,
        deployedAt: this.buildInfo?.deployedAt,
        deploymentId: this.buildInfo?.deploymentId,
        deploymentMethod: this.buildInfo?.deploymentMethod,
      },
      system: {
        platform: process.platform,
        nodeVersion: process.version,
        memoryUsage: {
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
          external: Math.round(memUsage.external / 1024 / 1024), // MB
          rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        },
        cpuUsage: {
          user: cpuUsage.user,
          system: cpuUsage.system,
        },
      },
    };
  }

  /**
   * Get version information only
   */
  getVersionInfo(): BuildInfo & DeploymentInfo {
    return (
      this.buildInfo || {
        version: '0.0.1',
        gitCommitSha: 'unknown',
        gitCommitShort: 'unknown',
        gitBranch: 'unknown',
        buildTimestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version,
      }
    );
  }

  /**
   * Add service health check capability
   * This can be extended to check database, redis, external APIs, etc.
   */
  async checkServicesHealth(): Promise<ServiceHealthStatus[]> {
    const services: ServiceHealthStatus[] = [];

    // Database check would go here
    // Redis check would go here
    // External API checks would go here

    return services;
  }
}
