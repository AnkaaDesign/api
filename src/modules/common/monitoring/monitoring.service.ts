import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ServerService } from '../server/server.service';
import * as os from 'os';

interface HealthMetric {
  timestamp: string;
  status: 'healthy' | 'warning' | 'critical';
  resources: {
    cpu: {
      usage: number;
      loadAverage: number[];
    };
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    disk: {
      used: number;
      total: number;
      percentage: number;
    };
  };
  services?: {
    healthy: number;
    unhealthy: number;
    total: number;
  };
  alerts: Array<{
    type: string;
    severity: 'warning' | 'critical';
    message: string;
  }>;
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private healthHistory: HealthMetric[] = [];
  private readonly MAX_HISTORY_SIZE = 720; // Store up to 30 days (720 hours) of hourly data
  private readonly HISTORY_RETENTION_HOURS = 720;

  constructor(private readonly serverService: ServerService) {
    // Initialize with current health on startup
    this.collectHealthMetrics().catch((err) =>
      this.logger.error('Failed to collect initial health metrics', err),
    );
  }

  /**
   * Collect health metrics every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async collectHealthMetrics() {
    try {
      const health = await this.calculateHealth();

      // Add to history
      this.healthHistory.push(health);

      // Cleanup old entries (keep only HISTORY_RETENTION_HOURS)
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - this.HISTORY_RETENTION_HOURS);

      this.healthHistory = this.healthHistory.filter(
        (metric) => new Date(metric.timestamp) > cutoffTime,
      );

      // Limit array size as additional safeguard
      if (this.healthHistory.length > this.MAX_HISTORY_SIZE) {
        this.healthHistory = this.healthHistory.slice(-this.MAX_HISTORY_SIZE);
      }

      this.logger.log(`Health metrics collected. History size: ${this.healthHistory.length}`);
    } catch (error) {
      this.logger.error('Failed to collect health metrics', error);
    }
  }

  /**
   * Get current health status
   */
  async getCurrentHealth(): Promise<HealthMetric> {
    // Return the most recent metric from history if available
    if (this.healthHistory.length > 0) {
      return this.healthHistory[this.healthHistory.length - 1];
    }

    // Otherwise calculate fresh metrics
    return this.calculateHealth();
  }

  /**
   * Get health history for the specified number of hours
   */
  async getHealthHistory(hours: number): Promise<HealthMetric[]> {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - hours);

    const filteredHistory = this.healthHistory.filter(
      (metric) => new Date(metric.timestamp) > cutoffTime,
    );

    // If no history available, return at least current health
    if (filteredHistory.length === 0) {
      const currentHealth = await this.getCurrentHealth();
      return [currentHealth];
    }

    return filteredHistory;
  }

  /**
   * Calculate current health metrics
   */
  private async calculateHealth(): Promise<HealthMetric> {
    const alerts: Array<{ type: string; severity: 'warning' | 'critical'; message: string }> = [];

    // Get system metrics
    let metrics;
    try {
      metrics = await this.serverService.getSystemMetrics();
    } catch (error) {
      this.logger.error('Failed to get system metrics', error);
      metrics = this.getDefaultMetrics();
    }

    const cpuUsage = metrics.cpu?.usage || 0;
    const memoryPercentage = metrics.memory?.percentage || 0;
    const diskPercentage = metrics.disk?.percentage || 0;

    // CPU alerts
    if (cpuUsage >= 90) {
      alerts.push({
        type: 'CPU',
        severity: 'critical',
        message: `Uso de CPU crítico: ${cpuUsage.toFixed(1)}%`,
      });
    } else if (cpuUsage >= 75) {
      alerts.push({
        type: 'CPU',
        severity: 'warning',
        message: `Uso de CPU elevado: ${cpuUsage.toFixed(1)}%`,
      });
    }

    // Memory alerts
    if (memoryPercentage >= 90) {
      alerts.push({
        type: 'Memory',
        severity: 'critical',
        message: `Uso de memória crítico: ${memoryPercentage.toFixed(1)}%`,
      });
    } else if (memoryPercentage >= 75) {
      alerts.push({
        type: 'Memory',
        severity: 'warning',
        message: `Uso de memória elevado: ${memoryPercentage.toFixed(1)}%`,
      });
    }

    // Disk alerts
    if (diskPercentage >= 90) {
      alerts.push({
        type: 'Disk',
        severity: 'critical',
        message: `Uso de disco crítico: ${diskPercentage.toFixed(1)}%`,
      });
    } else if (diskPercentage >= 85) {
      alerts.push({
        type: 'Disk',
        severity: 'warning',
        message: `Uso de disco elevado: ${diskPercentage.toFixed(1)}%`,
      });
    }

    // Determine overall status
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (alerts.some((a) => a.severity === 'critical')) {
      status = 'critical';
    } else if (alerts.length > 0) {
      status = 'warning';
    }

    // Get service health if available
    let services;
    try {
      const systemServices = await this.serverService.getSystemServices();
      const healthyCount = systemServices.filter((s) => s.status === 'running').length;
      const totalCount = systemServices.length;

      services = {
        healthy: healthyCount,
        unhealthy: totalCount - healthyCount,
        total: totalCount,
      };

      // Add service alerts
      if (services.unhealthy > 0) {
        alerts.push({
          type: 'Services',
          severity: services.unhealthy >= 3 ? 'critical' : 'warning',
          message: `${services.unhealthy} serviço(s) não está(ão) em execução`,
        });

        if (status === 'healthy') {
          status = 'warning';
        }
      }
    } catch (error) {
      this.logger.warn('Failed to get service health', error);
    }

    return {
      timestamp: new Date().toISOString(),
      status,
      resources: {
        cpu: {
          usage: cpuUsage,
          loadAverage: metrics.cpu?.loadAverage || [0, 0, 0],
        },
        memory: {
          used: metrics.memory?.used || 0,
          total: metrics.memory?.total || 0,
          percentage: memoryPercentage,
        },
        disk: {
          used: metrics.disk?.used || 0,
          total: metrics.disk?.total || 0,
          percentage: diskPercentage,
        },
      },
      services,
      alerts,
    };
  }

  /**
   * Get default metrics when ServerService fails
   */
  private getDefaultMetrics() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    return {
      cpu: {
        usage: 0,
        loadAverage: os.loadavg(),
        cores: os.cpus().length,
      },
      memory: {
        total: totalMemory,
        used: usedMemory,
        available: freeMemory,
        percentage: (usedMemory / totalMemory) * 100,
      },
      disk: {
        total: 0,
        used: 0,
        available: 0,
        percentage: 0,
      },
      network: {
        interfaces: [],
      },
      uptime: os.uptime(),
      hostname: os.hostname(),
    };
  }
}
