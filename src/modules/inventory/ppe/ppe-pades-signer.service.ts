/**
 * PPE PAdES Signer Service
 *
 * Applies a server-side PAdES (PDF Advanced Electronic Signature) seal to
 * PPE delivery documents using the company ICP-Brasil A1 certificate.
 *
 * The seal is applied AFTER the in-app HMAC/biometric signature flow completes.
 * Result: a PDF that is both legally valid (Lei 14.063/2020 advanced signature
 * via biometric evidence) AND cryptographically sealed by the company cert
 * (Medida Provisória 2.200-2/2001 — ICP-Brasil qualified seal).
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { PDFDocument } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import signpdf from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import * as forge from 'node-forge';

export interface CertMetadata {
  subject: string;
  subjectCommonName: string;
  cnpj: string | null;
  issuer: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
}

export interface PadesSealResult {
  signedPdf: Buffer;
  cert: CertMetadata;
  sealedAt: Date;
}

@Injectable()
export class PpePadesSignerService implements OnModuleInit {
  private readonly logger = new Logger(PpePadesSignerService.name);
  private p12Buffer: Buffer | null = null;
  private password: string | null = null;
  private certMeta: CertMetadata | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const certPath = this.configService.get<string>('PPE_CERT_PATH');
    const certPassword = this.configService.get<string>('PPE_CERT_PASSWORD');

    if (!certPath || !certPassword) {
      this.logger.warn(
        'PPE PAdES seal disabled — PPE_CERT_PATH or PPE_CERT_PASSWORD not configured.',
      );
      return;
    }

    const absolutePath = resolvePath(process.cwd(), certPath);
    if (!existsSync(absolutePath)) {
      this.logger.error(`PPE certificate not found at ${absolutePath}`);
      return;
    }

    try {
      this.p12Buffer = readFileSync(absolutePath);
      this.password = certPassword;
      this.certMeta = this.parseCertMetadata(this.p12Buffer, certPassword);

      const daysToExpiry = Math.floor(
        (this.certMeta.notAfter.getTime() - Date.now()) / 86_400_000,
      );
      this.logger.log(
        `PPE PAdES signer ready — ${this.certMeta.subjectCommonName} (expires in ${daysToExpiry} days)`,
      );

      if (daysToExpiry < 0) {
        this.logger.error('PPE certificate is EXPIRED — sealing will fail.');
      } else if (daysToExpiry < 30) {
        this.logger.warn(`PPE certificate expires in ${daysToExpiry} days — renew soon.`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to load PPE certificate: ${error instanceof Error ? error.message : error}`,
      );
      this.p12Buffer = null;
      this.password = null;
      this.certMeta = null;
    }
  }

  isEnabled(): boolean {
    return this.p12Buffer !== null && this.password !== null && this.certMeta !== null;
  }

  getCertMetadata(): CertMetadata | null {
    return this.certMeta;
  }

  /**
   * Apply a PAdES-B-B seal to a PDF buffer.
   *
   * @param pdfBuffer Raw PDF bytes (e.g. produced by PDFKit)
   * @param options.reason Why the doc is being signed (e.g. delivery id)
   * @param options.location Geographic context (e.g. "Ibiporã-PR")
   * @param options.signerName Visible signer name (employer/company)
   * @param options.contactInfo Contact info embedded in the signature dict
   * @returns Signed PDF buffer + cert metadata
   */
  async sealPdf(
    pdfBuffer: Buffer,
    options: {
      reason: string;
      location: string;
      signerName: string;
      contactInfo: string;
      signingTime?: Date;
    },
  ): Promise<PadesSealResult> {
    if (!this.isEnabled() || !this.p12Buffer || !this.password || !this.certMeta) {
      throw new Error('PPE PAdES signer is not configured.');
    }

    const sealedAt = options.signingTime ?? new Date();

    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: false });

    pdflibAddPlaceholder({
      pdfDoc,
      reason: options.reason,
      contactInfo: options.contactInfo,
      name: options.signerName,
      location: options.location,
      signingTime: sealedAt,
      subFilter: SUBFILTER_ETSI_CADES_DETACHED,
      signatureLength: 16384,
      appName: 'Ankaa Design — PPE Delivery Signing',
    });

    const pdfWithPlaceholder = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));

    const signer = new P12Signer(this.p12Buffer, { passphrase: this.password });
    const signedPdf = await signpdf.sign(pdfWithPlaceholder, signer, sealedAt);

    return {
      signedPdf,
      cert: this.certMeta,
      sealedAt,
    };
  }

  private parseCertMetadata(pfx: Buffer, password: string): CertMetadata {
    const p12Asn1 = forge.asn1.fromDer(pfx.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const bag = certBags[forge.pki.oids.certBag]?.[0];
    if (!bag || !bag.cert) {
      throw new Error('Certificate not found in PFX.');
    }

    const cert = bag.cert;
    const subjectAttrs = cert.subject.attributes;
    const issuerAttrs = cert.issuer.attributes;

    const formatDn = (attrs: forge.pki.CertificateField[]): string =>
      attrs
        .map(a => `${a.shortName || a.name}=${a.value}`)
        .filter(Boolean)
        .join(', ');

    const cn = subjectAttrs.find(a => a.shortName === 'CN')?.value as string | undefined;
    const cnpjMatch = cn?.match(/:(\d{14})$/);

    return {
      subject: formatDn(subjectAttrs),
      subjectCommonName: cn || 'Unknown',
      cnpj: cnpjMatch ? cnpjMatch[1] : null,
      issuer: formatDn(issuerAttrs),
      serialNumber: cert.serialNumber.toUpperCase(),
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
    };
  }
}
