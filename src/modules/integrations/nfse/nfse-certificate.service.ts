import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as https from 'node:https';

@Injectable()
export class NfseCertificateService implements OnModuleInit {
  private readonly logger = new Logger(NfseCertificateService.name);

  private privateKeyPem: string;
  private certificatePem: string;
  private httpsAgent: https.Agent;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const certPath = this.configService.get<string>('NFSE_CERTIFICATE_PATH');
    const certPassword = this.configService.get<string>('NFSE_CERTIFICATE_PASSWORD');

    if (!certPath || !certPassword) {
      this.logger.warn(
        'NFS-e certificate not configured (NFSE_CERTIFICATE_PATH / NFSE_CERTIFICATE_PASSWORD missing). NFS-e integration will not work.',
      );
      return;
    }

    try {
      this.loadCertificate(certPath, certPassword);
      this.logger.log('NFS-e digital certificate loaded successfully.');
    } catch (error) {
      this.logger.error(`Failed to load NFS-e certificate from ${certPath}: ${error.message}`);
    }
  }

  private loadCertificate(pfxPath: string, password: string): void {
    const pfxBuffer = fs.readFileSync(pfxPath);

    // Extract private key via openssl (Node crypto doesn't support pkcs12 format directly)
    try {
      const { execSync } = require('node:child_process');
      const keyPem = execSync(
        `openssl pkcs12 -in "${pfxPath}" -nocerts -nodes -passin pass:"${password}" 2>/dev/null`,
        { encoding: 'utf-8' },
      );
      const keyMatch = keyPem.match(
        /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/,
      );
      if (keyMatch) {
        this.privateKeyPem = keyMatch[0];
        this.logger.log('Private key extracted from PFX via openssl.');
      } else {
        this.logger.warn('Could not extract private key PEM from openssl output.');
      }
    } catch {
      this.logger.warn(
        'Could not extract private key from PFX via openssl. XML signing will not work.',
      );
    }

    const certObjects = this.extractCertFromPfx(pfxPath, password);

    if (certObjects) {
      this.certificatePem = certObjects;
    } else {
      this.logger.warn(
        'Could not extract certificate PEM. Install openssl or place a .pem sidecar file alongside the .pfx.',
      );
    }

    this.httpsAgent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: password,
      rejectUnauthorized: true,
    });
  }

  private extractCertFromPfx(pfxPath: string, password: string): string {
    // Primary method: use openssl CLI to extract the certificate from PFX
    try {
      const { execSync } = require('node:child_process');
      const certPem = execSync(
        `openssl pkcs12 -in "${pfxPath}" -clcerts -nokeys -passin pass:"${password}" 2>/dev/null`,
        { encoding: 'utf-8' },
      );

      const match = certPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
      if (match) {
        this.logger.log('Certificate PEM extracted from PFX via openssl.');
        return match[0];
      }
    } catch {
      this.logger.debug('openssl extraction failed, trying sidecar file.');
    }

    // Fallback: attempt to read a .pem sidecar file alongside the .pfx
    return this.tryReadSidecarCert();
  }

  private tryReadSidecarCert(): string {
    const certPath = this.configService.get<string>('NFSE_CERTIFICATE_PATH');
    const pemPath = certPath?.replace(/\.pfx$/i, '.pem');
    if (pemPath && fs.existsSync(pemPath)) {
      this.logger.log(`Loading certificate PEM from sidecar file: ${pemPath}`);
      return fs.readFileSync(pemPath, 'utf-8');
    }
    this.logger.warn(
      'Could not extract certificate PEM from PFX. Place a .pem sidecar file alongside the .pfx if XML signing fails.',
    );
    return '';
  }

  getHttpsAgent(): https.Agent {
    if (!this.httpsAgent) {
      throw new Error(
        'NFS-e certificate not loaded. Check NFSE_CERTIFICATE_PATH and NFSE_CERTIFICATE_PASSWORD.',
      );
    }
    return this.httpsAgent;
  }

  getPrivateKey(): string {
    if (!this.privateKeyPem) {
      throw new Error('NFS-e private key not available.');
    }
    return this.privateKeyPem;
  }

  getCertificate(): string {
    if (!this.certificatePem) {
      throw new Error('NFS-e certificate PEM not available. Provide a .pem sidecar file.');
    }
    return this.certificatePem;
  }
}
