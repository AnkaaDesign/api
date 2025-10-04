import { Injectable, Logger } from '@nestjs/common';

export interface SecurityMetrics {
  cspViolations: number;
  suspiciousRequests: number;
  blockedIPs: string[];
  lastSecurityScan: Date;
}

export interface SecurityConfiguration {
  cspEnabled: boolean;
  hstsEnabled: boolean;
  frameProtectionEnabled: boolean;
  contentTypeNoSniffEnabled: boolean;
  xssProtectionEnabled: boolean;
}

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);
  private securityMetrics: SecurityMetrics = {
    cspViolations: 0,
    suspiciousRequests: 0,
    blockedIPs: [],
    lastSecurityScan: new Date(),
  };

  /**
   * Get current security configuration status
   */
  getSecurityConfiguration(): SecurityConfiguration {
    return {
      cspEnabled: true,
      hstsEnabled: process.env.NODE_ENV === 'production',
      frameProtectionEnabled: true,
      contentTypeNoSniffEnabled: true,
      xssProtectionEnabled: true,
    };
  }

  /**
   * Get security metrics for monitoring
   */
  getSecurityMetrics(): SecurityMetrics {
    return { ...this.securityMetrics };
  }

  /**
   * Record a CSP violation
   */
  recordCSPViolation(violation: any): void {
    this.securityMetrics.cspViolations++;
    this.logger.warn('CSP violation recorded', {
      violatedDirective: violation.violatedDirective,
      blockedUri: violation.blockedUri,
      total: this.securityMetrics.cspViolations,
    });
  }

  /**
   * Record suspicious request activity
   */
  recordSuspiciousActivity(ip: string, userAgent: string, reason: string): void {
    this.securityMetrics.suspiciousRequests++;

    // Track suspicious IPs
    if (!this.securityMetrics.blockedIPs.includes(ip)) {
      this.securityMetrics.blockedIPs.push(ip);
    }

    this.logger.warn('Suspicious activity recorded', {
      ip,
      userAgent,
      reason,
      total: this.securityMetrics.suspiciousRequests,
    });
  }

  /**
   * Validate security headers in response
   */
  validateSecurityHeaders(headers: Record<string, string>): boolean {
    const requiredHeaders = [
      'x-frame-options',
      'x-content-type-options',
      'content-security-policy',
      'referrer-policy',
    ];

    const missingHeaders = requiredHeaders.filter(header => !headers[header]);

    if (missingHeaders.length > 0) {
      this.logger.warn('Missing security headers', { missingHeaders });
      return false;
    }

    return true;
  }

  /**
   * Generate security report for monitoring
   */
  generateSecurityReport(): any {
    const config = this.getSecurityConfiguration();
    const metrics = this.getSecurityMetrics();

    return {
      timestamp: new Date().toISOString(),
      configuration: config,
      metrics,
      recommendations: this.getSecurityRecommendations(config, metrics),
    };
  }

  /**
   * Get security recommendations based on current state
   */
  private getSecurityRecommendations(
    config: SecurityConfiguration,
    metrics: SecurityMetrics,
  ): string[] {
    const recommendations: string[] = [];

    if (!config.hstsEnabled && process.env.NODE_ENV === 'production') {
      recommendations.push('Enable HSTS in production environment');
    }

    if (metrics.cspViolations > 100) {
      recommendations.push('High number of CSP violations detected - review policy');
    }

    if (metrics.suspiciousRequests > 50) {
      recommendations.push('High number of suspicious requests - consider rate limiting');
    }

    if (metrics.blockedIPs.length > 20) {
      recommendations.push('Many blocked IPs detected - review security policies');
    }

    return recommendations;
  }

  /**
   * Reset security metrics (for testing or periodic cleanup)
   */
  resetMetrics(): void {
    this.securityMetrics = {
      cspViolations: 0,
      suspiciousRequests: 0,
      blockedIPs: [],
      lastSecurityScan: new Date(),
    };
    this.logger.log('Security metrics reset');
  }
}
