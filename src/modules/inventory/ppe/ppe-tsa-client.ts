/**
 * RFC 3161 Time-Stamp Protocol (TSP) client for PAdES-B-T.
 *
 * Obtains a trusted timestamp token (carimbo de tempo) from a TSA — ideally one
 * accredited by ICP-Brasil (DOC-ICP-12) — over the CMS SignatureValue. The token
 * is embedded as the `id-aa-signatureTimeStampToken` unsigned attribute by the
 * CAdES signer, proving the signature existed at a moment attested by an
 * independent trusted authority rather than the signing server's own clock.
 *
 * Brazilian relevance: Lei 14.063/2020 + MP 2.200-2/2001. A TSA timestamp removes
 * the "untrusted clock" objection an opposing party can raise against a signing
 * time set by a server the signer controls.
 *
 * No external dependency: the TimeStampReq is built and the TimeStampResp parsed
 * with node-forge ASN.1 primitives (forge has no built-in RFC 3161 support).
 */

import * as crypto from 'crypto';
import * as forge from 'node-forge';

const { asn1, md: forgeMd } = forge;

// Hash algorithm OIDs for the MessageImprint
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
const OID_SHA512 = '2.16.840.1.101.3.4.2.3';

export type TsaHashAlgorithm = 'sha256' | 'sha512';

export interface TimestampToken {
  /** DER-encoded RFC 3161 TimeStampToken — a CMS ContentInfo (SignedData/TSTInfo). */
  tokenDer: Buffer;
  /** TSA-asserted time parsed from TSTInfo.genTime (best-effort; null if unparsable). */
  genTime: Date | null;
  /** Hash algorithm used for the message imprint. */
  hashAlgorithm: TsaHashAlgorithm;
}

export interface TsaClientOptions {
  /** TSA endpoint that accepts application/timestamp-query POSTs. */
  url: string;
  /** Optional HTTP Basic auth (many ICP-Brasil TSAs are paid/authenticated). */
  username?: string;
  password?: string;
  /** Message-imprint hash algorithm (default sha256). */
  hashAlgorithm?: TsaHashAlgorithm;
  /** Request timeout in ms (default 10s). */
  timeoutMs?: number;
}

export class PpeTsaClient {
  readonly url: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly hashAlgorithm: TsaHashAlgorithm;
  private readonly timeoutMs: number;

  constructor(options: TsaClientOptions) {
    if (!options.url) throw new Error('PpeTsaClient requires a TSA url');
    this.url = options.url;
    this.username = options.username;
    this.password = options.password;
    this.hashAlgorithm = options.hashAlgorithm ?? 'sha256';
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Request a timestamp token over `message` (a node-forge binary string —
   * typically the CMS SignatureValue bytes).
   */
  async requestToken(message: string): Promise<TimestampToken> {
    const reqDer = this.buildRequest(message);
    const respBuffer = await this.post(reqDer);
    return this.parseResponse(respBuffer);
  }

  // --- TimeStampReq (RFC 3161 §2.4.1) ---
  private buildRequest(message: string): Buffer {
    const hashOid = this.hashAlgorithm === 'sha512' ? OID_SHA512 : OID_SHA256;
    const digest =
      this.hashAlgorithm === 'sha512'
        ? forgeMd.sha512.create()
        : forgeMd.sha256.create();
    digest.update(message);
    const hashedMessage = digest.digest().getBytes();

    const algorithmIdentifier = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(hashOid).getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
    ]);

    const messageImprint = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      algorithmIdentifier,
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, hashedMessage),
    ]);

    // nonce: positive INTEGER for replay protection (high bit cleared to stay positive)
    const nonceBytes = crypto.randomBytes(8);
    nonceBytes[0] &= 0x7f;
    if (nonceBytes[0] === 0) nonceBytes[0] = 0x01;

    const request = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, '\x01'), // version v1
      messageImprint,
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, nonceBytes.toString('binary')),
      // certReq TRUE — TSA must embed its signing cert chain in the token so the
      // token is verifiable standalone (required for PAdES LTV-readiness).
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BOOLEAN, false, String.fromCharCode(0xff)),
    ]);

    return Buffer.from(asn1.toDer(request).getBytes(), 'binary');
  }

  private async post(reqDer: Buffer): Promise<Buffer> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/timestamp-query',
      Accept: 'application/timestamp-reply',
    };
    if (this.username) {
      const token = Buffer.from(`${this.username}:${this.password ?? ''}`).toString('base64');
      headers.Authorization = `Basic ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers,
        body: reqDer,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`TSA HTTP ${response.status} ${response.statusText}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`TSA request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  // --- TimeStampResp (RFC 3161 §2.4.2) ---
  private parseResponse(respBuffer: Buffer): TimestampToken {
    const resp = asn1.fromDer(respBuffer.toString('binary'));
    // TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken TimeStampToken OPTIONAL }
    const statusInfo = resp.value[0] as forge.asn1.Asn1;
    const statusInt = (statusInfo.value as forge.asn1.Asn1[])[0];
    const status = this.readInteger(statusInt.value as string);

    // 0 = granted, 1 = grantedWithMods; anything else is a rejection.
    if (status !== 0 && status !== 1) {
      throw new Error(`TSA rejected request (PKIStatus ${status})`);
    }

    const respChildren = resp.value as forge.asn1.Asn1[];
    if (respChildren.length < 2) {
      throw new Error('TSA response is missing the timeStampToken');
    }

    const token = respChildren[1]; // ContentInfo
    const tokenDer = Buffer.from(asn1.toDer(token).getBytes(), 'binary');
    const genTime = this.extractGenTime(token);

    return { tokenDer, genTime, hashAlgorithm: this.hashAlgorithm };
  }

  /** Decode a small DER INTEGER content octet string to a JS number. */
  private readInteger(bytes: string): number {
    let value = 0;
    for (let i = 0; i < bytes.length; i++) {
      value = (value << 8) | (bytes.charCodeAt(i) & 0xff);
    }
    return value;
  }

  /**
   * Best-effort extraction of TSTInfo.genTime from the token for audit display.
   * Returns null on any structural deviation — the token itself is still embedded.
   */
  private extractGenTime(token: forge.asn1.Asn1): Date | null {
    try {
      // ContentInfo: SEQUENCE { contentType OID, content [0] EXPLICIT SignedData }
      const content = (token.value as forge.asn1.Asn1[])[1]; // [0] EXPLICIT
      const signedData = (content.value as forge.asn1.Asn1[])[0]; // SignedData SEQUENCE
      // SignedData: version, digestAlgorithms, encapContentInfo, ...
      const encapContentInfo = (signedData.value as forge.asn1.Asn1[])[2];
      // EncapsulatedContentInfo: eContentType OID, eContent [0] EXPLICIT OCTET STRING
      const eContentExplicit = (encapContentInfo.value as forge.asn1.Asn1[])[1];
      const octet = (eContentExplicit.value as forge.asn1.Asn1[])[0];
      const tstInfo = asn1.fromDer(octet.value as string);
      // TSTInfo: version, policy, messageImprint, serialNumber, genTime, ...
      const genTimeAsn1 = (tstInfo.value as forge.asn1.Asn1[])[4];
      return asn1.generalizedTimeToDate(genTimeAsn1.value as string);
    } catch {
      return null;
    }
  }
}
