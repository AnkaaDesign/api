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
import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import signpdf from '@signpdf/signpdf';
import * as forge from 'node-forge';
import { CadesP12Signer } from './ppe-cades-signer';
import { PpeTsaClient, TsaHashAlgorithm } from './ppe-tsa-client';

export interface CertMetadata {
  subject: string;
  subjectCommonName: string;
  cnpj: string | null;
  issuer: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
}

export interface PadesTimestampInfo {
  /** True when an RFC 3161 token was embedded (B-T achieved). */
  applied: boolean;
  /** TSA-asserted time (TSTInfo.genTime) when parseable. */
  genTime: Date | null;
  /** TSA endpoint used. */
  url: string | null;
  /** Reason a configured TSA produced no token (non-required mode). */
  error?: string;
}

export interface PadesSealResult {
  signedPdf: Buffer;
  cert: CertMetadata;
  sealedAt: Date;
  /** Achieved baseline level — B-T when a trusted timestamp was embedded. */
  level: 'PAdES-B-T' | 'PAdES-B-B';
  timestamp: PadesTimestampInfo;
}

@Injectable()
export class PpePadesSignerService implements OnModuleInit {
  private readonly logger = new Logger(PpePadesSignerService.name);
  private p12Buffer: Buffer | null = null;
  private password: string | null = null;
  private certMeta: CertMetadata | null = null;
  private tsaClient: PpeTsaClient | null = null;
  private tsaRequired = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const certPath = this.configService.get<string>('PPE_CERT_PATH');
    const certPassword = this.configService.get<string>('PPE_CERT_PASSWORD');

    this.initTsa();

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

  isTimestampEnabled(): boolean {
    return this.tsaClient !== null;
  }

  /**
   * Configure the RFC 3161 TSA client from env. When PPE_TSA_URL is unset, the
   * seal stays at PAdES-B-B (server-clock signing time). Set PPE_TSA_REQUIRED=true
   * to fail sealing when the TSA is unreachable instead of degrading to B-B.
   */
  private initTsa() {
    const url = this.configService.get<string>('PPE_TSA_URL');
    if (!url) {
      this.logger.warn(
        'PPE trusted timestamp disabled — PPE_TSA_URL not set (seals will be PAdES-B-B).',
      );
      return;
    }

    const hashAlgorithm = (
      this.configService.get<string>('PPE_TSA_HASH_ALGO') || 'sha256'
    ).toLowerCase() as TsaHashAlgorithm;
    const timeoutRaw = this.configService.get<string>('PPE_TSA_TIMEOUT_MS');
    this.tsaRequired = this.configService.get<string>('PPE_TSA_REQUIRED') === 'true';

    try {
      this.tsaClient = new PpeTsaClient({
        url,
        username: this.configService.get<string>('PPE_TSA_USERNAME') || undefined,
        password: this.configService.get<string>('PPE_TSA_PASSWORD') || undefined,
        hashAlgorithm: hashAlgorithm === 'sha512' ? 'sha512' : 'sha256',
        timeoutMs: timeoutRaw ? Number(timeoutRaw) : undefined,
      });
      this.logger.log(
        `PPE trusted timestamp ready — TSA ${url} (${hashAlgorithm}, required=${this.tsaRequired})`,
      );
    } catch (error) {
      this.tsaClient = null;
      this.logger.error(
        `Failed to configure PPE TSA client: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  getCertMetadata(): CertMetadata | null {
    return this.certMeta;
  }

  /**
   * Apply a PAdES seal to a PDF buffer — PAdES-B-T when a TSA is configured and
   * reachable, otherwise PAdES-B-B (or it throws when PPE_TSA_REQUIRED=true).
   *
   * @param pdfBuffer Raw PDF bytes (e.g. produced by PDFKit)
   * @param options.reason Why the doc is being signed (e.g. delivery id)
   * @param options.location Geographic context (e.g. "Ibiporã-PR")
   * @param options.signerName Visible signer name (employer/company)
   * @param options.contactInfo Contact info embedded in the signature dict
   * @returns Signed PDF buffer + cert metadata + achieved level/timestamp
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

    // plainAddPlaceholder appends the signature field as a proper PDF incremental
    // update (new XRef + trailer), preserving the original document revision.
    // This produces the 2-revision structure that strict PAdES validators require.
    const pdfWithPlaceholder = plainAddPlaceholder({
      pdfBuffer,
      reason: options.reason,
      contactInfo: options.contactInfo,
      name: options.signerName,
      location: options.location,
      signingTime: sealedAt,
      subFilter: SUBFILTER_ETSI_CADES_DETACHED,
      // Larger reservation: a B-T token embeds the TSA's full cert chain on top of
      // the CAdES structure, which routinely exceeds the 32 KB B-B placeholder.
      signatureLength: this.tsaClient ? 65536 : 32768,
    });

    const signer = new CadesP12Signer(this.p12Buffer, this.password, {
      tsaClient: this.tsaClient ?? undefined,
      tsaRequired: this.tsaRequired,
    });
    const signedPdf = await signpdf.sign(pdfWithPlaceholder, signer, sealedAt);

    const ts = signer.timestamp;
    const applied = ts?.applied === true;
    if (this.tsaClient && !applied) {
      this.logger.warn(
        `PAdES seal degraded to B-B — trusted timestamp not embedded: ${ts?.error ?? 'unknown'}`,
      );
    }

    return {
      signedPdf,
      cert: this.certMeta,
      sealedAt,
      level: applied ? 'PAdES-B-T' : 'PAdES-B-B',
      timestamp: {
        applied,
        genTime: ts?.genTime ?? null,
        url: this.tsaClient?.url ?? null,
        error: ts?.error,
      },
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
