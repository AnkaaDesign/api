/**
 * CAdES-compliant P12 signer for ICP-Brasil PAdES (DOC-ICP-15).
 *
 * Builds the PKCS#7 SignedData manually so that id-aa-signingCertificateV2
 * (RFC 5035 / ETSI EN 319 122) is included in the authenticated attributes.
 * Without this attribute, ITI's validator rejects the signature as unrecognizable
 * because ETSI.CAdES.detached requires it while node-forge's built-in p7.sign()
 * only adds contentType, signingTime and messageDigest.
 */

import * as forge from 'node-forge';
import { Signer } from '@signpdf/utils';

// OID table
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
const OID_SHA256_WITH_RSA = '1.2.840.113549.1.1.11';
const OID_CONTENT_TYPE = '1.2.840.113549.1.9.3';
const OID_SIGNING_TIME = '1.2.840.113549.1.9.5';
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_SIGNING_CERT_V2 = '1.2.840.113549.1.9.16.2.47';
const OID_DATA = '1.2.840.113549.1.7.1';
const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';

const { asn1, pki, md: forgeMd, util } = forge;

function mkAttr(oid: string, ...values: forge.asn1.Asn1[]): forge.asn1.Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oid).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, values),
  ]);
}

function algIdSha256(): forge.asn1.Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_SHA256).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
  ]);
}

export class CadesP12Signer extends Signer {
  constructor(
    private readonly p12Buffer: Buffer,
    private readonly passphrase: string,
  ) {
    super();
  }

  async sign(pdfBuffer: Buffer, signingTime: Date = new Date()): Promise<Buffer> {
    // --- Parse P12 ---
    const p12Asn1 = asn1.fromDer(this.p12Buffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, this.passphrase);

    const certBags =
      (p12.getBags({ bagType: pki.oids.certBag })[pki.oids.certBag] as forge.pkcs12.Bag[]) ?? [];
    const keyBags =
      (p12.getBags({
        bagType: pki.oids.pkcs8ShroudedKeyBag,
      })[pki.oids.pkcs8ShroudedKeyBag] as forge.pkcs12.Bag[]) ?? [];

    if (!keyBags.length) throw new Error('No private key found in PFX');
    const privateKey = keyBags[0].key as forge.pki.rsa.PrivateKey;

    let signingCert: forge.pki.Certificate | undefined;
    const allCerts: forge.pki.Certificate[] = [];
    for (const bag of certBags) {
      if (!bag.cert) continue;
      allCerts.push(bag.cert);
      const pub = bag.cert.publicKey as forge.pki.rsa.PublicKey;
      if (privateKey.n.compareTo(pub.n) === 0) signingCert = bag.cert;
    }
    if (!signingCert) throw new Error('No certificate matching private key in PFX');

    // --- messageDigest: SHA-256 of ByteRange content ---
    const msgMd = forgeMd.sha256.create();
    msgMd.update(pdfBuffer.toString('binary'));
    const msgDigestBytes = msgMd.digest().getBytes();

    // --- certHash: SHA-256 of DER-encoded signing certificate ---
    const certDerBytes = asn1.toDer(pki.certificateToAsn1(signingCert)).getBytes();
    const certMd = forgeMd.sha256.create();
    certMd.update(certDerBytes);
    const certHashBytes = certMd.digest().getBytes();

    // --- ESSCertIDv2 (RFC 5035 §4.1) ---
    const essCertIDv2 = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      algIdSha256(),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, certHashBytes),
    ]);
    const signingCertV2Value = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [essCertIDv2]),
    ]);

    // --- Signing time ---
    const jan1950 = new Date('1950-01-01T00:00:00Z');
    const jan2050 = new Date('2050-01-01T00:00:00Z');
    const signingTimeAsn1 =
      signingTime >= jan1950 && signingTime < jan2050
        ? asn1.create(
            asn1.Class.UNIVERSAL,
            asn1.Type.UTCTIME,
            false,
            asn1.dateToUtcTime(signingTime),
          )
        : asn1.create(
            asn1.Class.UNIVERSAL,
            asn1.Type.GENERALIZEDTIME,
            false,
            asn1.dateToGeneralizedTime(signingTime),
          );

    // --- Authenticated attributes ---
    const authAttrList: forge.asn1.Asn1[] = [
      mkAttr(
        OID_CONTENT_TYPE,
        asn1.create(
          asn1.Class.UNIVERSAL,
          asn1.Type.OID,
          false,
          asn1.oidToDer(OID_DATA).getBytes(),
        ),
      ),
      mkAttr(OID_SIGNING_TIME, signingTimeAsn1),
      mkAttr(
        OID_MESSAGE_DIGEST,
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, msgDigestBytes),
      ),
      mkAttr(OID_SIGNING_CERT_V2, signingCertV2Value),
    ];

    // RFC 5652 §5.4: sign the SET OF authenticated attributes with tag 0x31 (not [0])
    const attrsSet = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, authAttrList);
    const attrsDer = asn1.toDer(attrsSet).getBytes();

    // [0] IMPLICIT form used inside SignerInfo
    const authAttrsCtx = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, authAttrList);

    // --- Sign ---
    const signMd = forgeMd.sha256.create();
    signMd.update(attrsDer);
    const signatureBytes = (privateKey as forge.pki.rsa.PrivateKey).sign(
      signMd,
      'RSASSA-PKCS1-V1_5',
    );

    // --- Issuer + serial extracted from cert ASN.1 to avoid encoding drift ---
    const certAsn1 = pki.certificateToAsn1(signingCert);
    const tbsCert = certAsn1.value[0] as forge.asn1.Asn1;
    const issuerAsn1 = tbsCert.value[3] as forge.asn1.Asn1; // Name (issuer)
    const serialAsn1 = tbsCert.value[1] as forge.asn1.Asn1; // CertificateSerialNumber

    // --- SignerInfo (RFC 5652 §5.3) ---
    const signerInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, '\x01'), // version 1
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        issuerAsn1,
        serialAsn1,
      ]),
      algIdSha256(),
      authAttrsCtx,
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(
          asn1.Class.UNIVERSAL,
          asn1.Type.OID,
          false,
          asn1.oidToDer(OID_SHA256_WITH_RSA).getBytes(),
        ),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
      ]),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, signatureBytes),
    ]);

    // --- SignedData (RFC 5652 §5.1) ---
    const signedData = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, '\x01'), // version 1
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [algIdSha256()]),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        // encapContentInfo: id-data OID only (detached — no eContent)
        asn1.create(
          asn1.Class.UNIVERSAL,
          asn1.Type.OID,
          false,
          asn1.oidToDer(OID_DATA).getBytes(),
        ),
      ]),
      // certificates [0] IMPLICIT — full chain from P12
      asn1.create(
        asn1.Class.CONTEXT_SPECIFIC,
        0,
        true,
        allCerts.map(c => pki.certificateToAsn1(c)),
      ),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [signerInfo]),
    ]);

    // --- ContentInfo wrapper ---
    const contentInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.OID,
        false,
        asn1.oidToDer(OID_SIGNED_DATA).getBytes(),
      ),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData]),
    ]);

    return Buffer.from(asn1.toDer(contentInfo).getBytes(), 'binary');
  }
}
