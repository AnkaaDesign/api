import { Controller, Post, Body, Req, Logger, HttpCode, HttpStatus, Get } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { SecurityMonitoringService } from './security-monitoring.service';

interface CSPReport {
  'csp-report'?: {
    'document-uri'?: string;
    referrer?: string;
    'violated-directive': string; // This is required
    'effective-directive'?: string;
    'original-policy'?: string;
    disposition?: string;
    'blocked-uri'?: string;
    'line-number'?: number;
    'column-number'?: number;
    'source-file'?: string;
    'status-code'?: number;
    'script-sample'?: string;
  };
}

@Controller('security')
export class SecurityController {
  private readonly logger = new Logger(SecurityController.name);

  constructor(private readonly securityMonitoringService: SecurityMonitoringService) {}

  @Post('csp-report')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async handleCSPReport(@Body() report: CSPReport, @Req() req: Request): Promise<void> {
    try {
      // Validate that the report exists and has the expected structure
      if (!report || !report['csp-report']) {
        this.logger.warn('Invalid CSP report received', {
          report,
          userAgent: req.headers['user-agent'],
          ip: req.ip,
        });
        return;
      }

      const cspReport = report['csp-report'];

      // Validate required fields
      if (!cspReport['violated-directive']) {
        this.logger.warn('CSP report missing violated-directive', {
          report,
          userAgent: req.headers['user-agent'],
          ip: req.ip,
        });
        return;
      }

      // Log CSP violation for monitoring
      // Record in monitoring service
      this.securityMonitoringService.recordEvent({
        type: 'CSP_VIOLATION',
        severity: this.getCSPViolationSeverity(cspReport['violated-directive']),
        source: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] as string,
        details: {
          documentUri: cspReport['document-uri'] || 'unknown',
          violatedDirective: cspReport['violated-directive'],
          blockedUri: cspReport['blocked-uri'] || 'unknown',
          sourceFile: cspReport['source-file'] || 'unknown',
          lineNumber: cspReport['line-number'] || 0,
          columnNumber: cspReport['column-number'] || 0,
        },
      });

      this.logger.warn('CSP Violation Detected', {
        documentUri: cspReport['document-uri'] || 'unknown',
        violatedDirective: cspReport['violated-directive'],
        blockedUri: cspReport['blocked-uri'] || 'unknown',
        sourceFile: cspReport['source-file'] || 'unknown',
        lineNumber: cspReport['line-number'] || 0,
        columnNumber: cspReport['column-number'] || 0,
        userAgent: req.headers['user-agent'] || 'unknown',
        ip: req.ip || 'unknown',
        timestamp: new Date().toISOString(),
      });

      // In production, you might want to send this to a monitoring service
      if (process.env.NODE_ENV === 'production') {
        // Example: Send to monitoring service
        // await this.monitoringService.reportCSPViolation(cspReport);

        // For now, just log the critical violations
        const criticalDirectives = ['script-src', 'object-src', 'base-uri', 'frame-ancestors'];

        if (
          criticalDirectives.some(directive => cspReport['violated-directive'].includes(directive))
        ) {
          this.logger.error('Critical CSP Violation', {
            violatedDirective: cspReport['violated-directive'],
            blockedUri: cspReport['blocked-uri'] || 'unknown',
            documentUri: cspReport['document-uri'] || 'unknown',
            ip: req.ip || 'unknown',
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to process CSP report', error);
    }
  }

  @Post('security-report')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async handleSecurityReport(@Body() report: any, @Req() req: Request): Promise<void> {
    try {
      // Record in monitoring service
      this.securityMonitoringService.recordEvent({
        type: 'SUSPICIOUS_REQUEST',
        severity: 'MEDIUM',
        source: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] as string,
        details: { report, type: 'general_security_report' },
      });

      // Handle other security reports (HPKP, HSTS, etc.)
      this.logger.warn('Security Report Received', {
        report,
        userAgent: req.headers['user-agent'],
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('Failed to process security report', error);
    }
  }

  @Get('metrics')
  async getSecurityMetrics(): Promise<any> {
    try {
      return this.securityMonitoringService.getMetrics(24);
    } catch (error) {
      this.logger.error('Failed to get security metrics', error);
      throw error;
    }
  }

  @Get('alerts')
  async getSecurityAlerts(): Promise<any> {
    try {
      return this.securityMonitoringService.getSecurityAlerts();
    } catch (error) {
      this.logger.error('Failed to get security alerts', error);
      throw error;
    }
  }

  @Get('report')
  async getSecurityReport(): Promise<any> {
    try {
      return this.securityMonitoringService.generateSecurityReport();
    } catch (error) {
      this.logger.error('Failed to generate security report', error);
      throw error;
    }
  }

  @Get('blocked-ips')
  async getBlockedIPs(): Promise<{ blockedIPs: string[] }> {
    try {
      return { blockedIPs: this.securityMonitoringService.getBlockedIPs() };
    } catch (error) {
      this.logger.error('Failed to get blocked IPs', error);
      throw error;
    }
  }

  /**
   * Determine CSP violation severity based on the violated directive
   */
  private getCSPViolationSeverity(
    violatedDirective: string,
  ): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const criticalDirectives = ['script-src', 'object-src', 'base-uri'];
    const highDirectives = ['frame-ancestors', 'form-action'];
    const mediumDirectives = ['img-src', 'style-src', 'font-src'];

    if (criticalDirectives.some(directive => violatedDirective.includes(directive))) {
      return 'CRITICAL';
    }
    if (highDirectives.some(directive => violatedDirective.includes(directive))) {
      return 'HIGH';
    }
    if (mediumDirectives.some(directive => violatedDirective.includes(directive))) {
      return 'MEDIUM';
    }
    return 'LOW';
  }
}
