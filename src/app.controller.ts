import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { NoRateLimit } from './modules/common/throttler/throttler.decorators';
import { Public } from './modules/common/auth/decorators/public.decorator';
import { HealthCheckResponse, BuildInfo, DeploymentInfo, VersionInfoResponse } from '@types';
import * as os from 'os';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @NoRateLimit()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Health check endpoint with comprehensive system information
   * Returns: deployment version, system metrics, uptime, and service status
   *
   * @returns {HealthCheckResponse} Comprehensive health check data
   */
  @Public()
  @NoRateLimit()
  @Get('health')
  getHealth(): HealthCheckResponse {
    return this.appService.getHealthCheck();
  }

  /**
   * Version information endpoint
   * Returns: git commit, build timestamp, deployment info
   *
   * @returns {VersionInfoResponse} Version and deployment metadata
   */
  @Public()
  @NoRateLimit()
  @Get('version')
  getVersion(): VersionInfoResponse {
    const versionData = this.appService.getVersionInfo();
    return {
      success: true,
      message: 'Version information retrieved successfully',
      data: versionData,
    };
  }

  /**
   * Simple liveness probe (minimal response for k8s/docker)
   * Used by orchestrators for basic health checks
   *
   * @returns {object} Simple status object
   */
  @Public()
  @NoRateLimit()
  @Get('ping')
  getPing(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Network discovery endpoint for mobile/web clients on LAN.
   * Returns the server's local network addresses so clients can
   * connect directly when internet/DNS is unavailable.
   *
   * Public and lightweight - designed to be called on app startup
   * and cached by clients for offline fallback.
   */
  @Public()
  @NoRateLimit()
  @Get('network-config')
  getNetworkConfig(): { addresses: { name: string; ip: string }[]; port: number } {
    const interfaces = os.networkInterfaces();
    const addresses: { name: string; ip: string }[] = [];

    for (const [name, nets] of Object.entries(interfaces)) {
      if (!nets) continue;
      for (const net of nets) {
        // Only IPv4, non-internal (skip loopback)
        if (net.family === 'IPv4' && !net.internal) {
          addresses.push({ name, ip: net.address });
        }
      }
    }

    return {
      addresses,
      port: parseInt(process.env.PORT || '3030', 10),
    };
  }
}
