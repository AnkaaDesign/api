import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

export interface SecurityEvent {
  type:
    | 'CSP_VIOLATION'
    | 'SUSPICIOUS_REQUEST'
    | 'FAILED_LOGIN'
    | 'RATE_LIMIT'
    | 'MALICIOUS_PAYLOAD';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  source: string; // IP address
  userAgent?: string;
  details: any;
  timestamp: Date;
}

export interface SecurityMetrics {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsBySeverity: Record<string, number>;
  uniqueIPs: Set<string>;
  topSources: Array<{ ip: string; count: number }>;
  timeRange: { start: Date; end: Date };
}

@Injectable()
export class SecurityMonitoringService {
  private readonly logger = new Logger(SecurityMonitoringService.name);
  private events: SecurityEvent[] = [];
  private readonly maxEvents = 10000; // Keep last 10k events in memory
  private blockedIPs: Set<string> = new Set();
  private suspiciousIPs: Map<string, number> = new Map();

  /**
   * Record a security event
   */
  recordEvent(event: Omit<SecurityEvent, 'timestamp'>): void {
    const securityEvent: SecurityEvent = {
      ...event,
      timestamp: new Date(),
    };

    // Add to events array
    this.events.push(securityEvent);

    // Maintain memory limit
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    // Update suspicious IP tracking
    this.updateSuspiciousIPTracking(event.source, event.severity);

    // Log based on severity
    this.logSecurityEvent(securityEvent);

    // Check if action needed
    this.checkForAutomaticActions(securityEvent);
  }

  /**
   * Get security metrics for a time period
   */
  getMetrics(hours: number = 24): SecurityMetrics {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recentEvents = this.events.filter(event => event.timestamp >= cutoff);

    const eventsByType: Record<string, number> = {};
    const eventsBySeverity: Record<string, number> = {};
    const ipCounts: Map<string, number> = new Map();

    recentEvents.forEach(event => {
      // Count by type
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;

      // Count by severity
      eventsBySeverity[event.severity] = (eventsBySeverity[event.severity] || 0) + 1;

      // Count by IP
      ipCounts.set(event.source, (ipCounts.get(event.source) || 0) + 1);
    });

    // Get top sources
    const topSources = Array.from(ipCounts.entries())
      .map(([ip, count]) => ({ ip, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalEvents: recentEvents.length,
      eventsByType,
      eventsBySeverity,
      uniqueIPs: new Set(recentEvents.map(e => e.source)),
      topSources,
      timeRange: {
        start: cutoff,
        end: new Date(),
      },
    };
  }

  /**
   * Get blocked IPs
   */
  getBlockedIPs(): string[] {
    return Array.from(this.blockedIPs);
  }

  /**
   * Block an IP address
   */
  blockIP(ip: string, reason: string): void {
    this.blockedIPs.add(ip);
    this.logger.warn(`IP blocked: ${ip} - Reason: ${reason}`);

    this.recordEvent({
      type: 'SUSPICIOUS_REQUEST',
      severity: 'HIGH',
      source: ip,
      details: { action: 'IP_BLOCKED', reason },
    });
  }

  /**
   * Unblock an IP address
   */
  unblockIP(ip: string): void {
    this.blockedIPs.delete(ip);
    this.suspiciousIPs.delete(ip);
    this.logger.log(`IP unblocked: ${ip}`);
  }

  /**
   * Check if an IP is blocked
   */
  isIPBlocked(ip: string): boolean {
    return this.blockedIPs.has(ip);
  }

  /**
   * Get security alert summary
   */
  getSecurityAlerts(): Array<{
    type: string;
    message: string;
    severity: string;
    count: number;
    recommendation: string;
  }> {
    const metrics = this.getMetrics(24);
    const alerts: Array<{
      type: string;
      message: string;
      severity: string;
      count: number;
      recommendation: string;
    }> = [];

    // Check for high volume of CSP violations
    if (metrics.eventsByType.CSP_VIOLATION > 100) {
      alerts.push({
        type: 'CSP_VIOLATIONS',
        message: 'High number of CSP violations detected',
        severity: 'MEDIUM',
        count: metrics.eventsByType.CSP_VIOLATION,
        recommendation: 'Review and update Content Security Policy directives',
      });
    }

    // Check for critical events
    if (metrics.eventsBySeverity.CRITICAL > 0) {
      alerts.push({
        type: 'CRITICAL_EVENTS',
        message: 'Critical security events detected',
        severity: 'CRITICAL',
        count: metrics.eventsBySeverity.CRITICAL,
        recommendation: 'Immediate investigation required',
      });
    }

    // Check for suspicious activity patterns
    if (metrics.topSources.length > 0 && metrics.topSources[0].count > 50) {
      alerts.push({
        type: 'SUSPICIOUS_ACTIVITY',
        message: `High activity from single source: ${metrics.topSources[0].ip}`,
        severity: 'HIGH',
        count: metrics.topSources[0].count,
        recommendation: 'Consider blocking or rate limiting this IP',
      });
    }

    // Check for blocked IPs
    if (this.blockedIPs.size > 20) {
      alerts.push({
        type: 'MANY_BLOCKED_IPS',
        message: 'Large number of blocked IPs',
        severity: 'MEDIUM',
        count: this.blockedIPs.size,
        recommendation: 'Review blocking criteria and consider cleanup',
      });
    }

    return alerts;
  }

  /**
   * Generate security report
   */
  generateSecurityReport(): any {
    const metrics = this.getMetrics(24);
    const alerts = this.getSecurityAlerts();

    return {
      timestamp: new Date().toISOString(),
      summary: {
        totalEvents: metrics.totalEvents,
        uniqueIPs: metrics.uniqueIPs.size,
        blockedIPs: this.blockedIPs.size,
        suspiciousIPs: this.suspiciousIPs.size,
        activeAlerts: alerts.length,
      },
      metrics,
      alerts,
      recommendations: this.generateRecommendations(metrics, alerts),
    };
  }

  /**
   * Update suspicious IP tracking
   */
  private updateSuspiciousIPTracking(ip: string, severity: string): void {
    const current = this.suspiciousIPs.get(ip) || 0;
    const increment =
      severity === 'CRITICAL' ? 10 : severity === 'HIGH' ? 5 : severity === 'MEDIUM' ? 2 : 1;

    this.suspiciousIPs.set(ip, current + increment);

    // Auto-block if score is too high
    if (this.suspiciousIPs.get(ip)! > 50 && !this.blockedIPs.has(ip)) {
      this.blockIP(ip, 'Automatic blocking due to high suspicious activity score');
    }
  }

  /**
   * Log security event based on severity
   */
  private logSecurityEvent(event: SecurityEvent): void {
    const logMessage = `Security Event: ${event.type} from ${event.source}`;

    switch (event.severity) {
      case 'CRITICAL':
        this.logger.error(logMessage, event.details);
        break;
      case 'HIGH':
        this.logger.warn(logMessage, event.details);
        break;
      case 'MEDIUM':
        this.logger.warn(logMessage);
        break;
      case 'LOW':
        this.logger.debug(logMessage);
        break;
    }
  }

  /**
   * Check if automatic actions are needed
   */
  private checkForAutomaticActions(event: SecurityEvent): void {
    // Auto-block for critical events
    if (event.severity === 'CRITICAL' && !this.blockedIPs.has(event.source)) {
      this.blockIP(event.source, `Critical security event: ${event.type}`);
    }

    // Check for repeated failures from same IP
    const recentEventsFromIP = this.events
      .filter(e => e.source === event.source)
      .filter(e => Date.now() - e.timestamp.getTime() < 10 * 60 * 1000); // Last 10 minutes

    if (recentEventsFromIP.length > 20) {
      this.blockIP(event.source, 'Too many security events in short time period');
    }
  }

  /**
   * Generate security recommendations
   */
  private generateRecommendations(metrics: SecurityMetrics, alerts: any[]): string[] {
    const recommendations: string[] = [];

    if (metrics.eventsByType.CSP_VIOLATION > 50) {
      recommendations.push('Review and update Content Security Policy to reduce violations');
    }

    if (metrics.eventsByType.FAILED_LOGIN > 20) {
      recommendations.push('Consider implementing stronger password policies or account lockout');
    }

    if (this.blockedIPs.size > 10) {
      recommendations.push(
        'Review blocked IPs list and consider implementing geographic restrictions',
      );
    }

    if (alerts.length > 5) {
      recommendations.push(
        'High number of active security alerts - consider increasing monitoring frequency',
      );
    }

    if (metrics.uniqueIPs.size > 1000) {
      recommendations.push(
        'High traffic volume detected - ensure adequate rate limiting is in place',
      );
    }

    return recommendations;
  }

  /**
   * Periodic cleanup of old events and suspicious IPs
   */
  @Cron(CronExpression.EVERY_HOUR)
  private cleanupOldData(): void {
    // Clean up events older than 7 days
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    this.events = this.events.filter(event => event.timestamp >= cutoff);

    // Decay suspicious IP scores
    for (const [ip, score] of this.suspiciousIPs.entries()) {
      const newScore = Math.max(0, score - 1);
      if (newScore === 0) {
        this.suspiciousIPs.delete(ip);
      } else {
        this.suspiciousIPs.set(ip, newScore);
      }
    }

    this.logger.debug('Security monitoring data cleanup completed');
  }

  /**
   * Daily security report
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  private generateDailyReport(): void {
    const report = this.generateSecurityReport();

    this.logger.log('Daily Security Report Generated', {
      summary: report.summary,
      alertCount: report.alerts.length,
    });

    // In production, you might want to send this report via email or to a monitoring service
    if (process.env.NODE_ENV === 'production') {
      // Example: await this.emailService.sendSecurityReport(report);
    }
  }
}
