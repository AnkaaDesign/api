import { Injectable, Logger } from '@nestjs/common';
import { SignedXml } from 'xml-crypto';
import { gzipSync } from 'node:zlib';
import { NfseCertificateService } from './nfse-certificate.service';

@Injectable()
export class NfseXmlSignerService {
  private readonly logger = new Logger(NfseXmlSignerService.name);

  constructor(private readonly certificateService: NfseCertificateService) {}

  /**
   * Sign an XML document using RSA-SHA256 with the A1 certificate.
   *
   * @param xml - The XML string to sign
   * @param referenceTag - The element to sign (default: 'infDPS', use 'infPedReg' for events)
   */
  signXml(xml: string, referenceTag = 'infDPS'): string {
    const privateKey = this.certificateService.getPrivateKey();
    const certificate = this.certificateService.getCertificate();

    const sig = new SignedXml();

    sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
    sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';

    sig.addReference({
      xpath: `//*[local-name(.)='${referenceTag}']`,
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#',
      ],
    });

    // Strip PEM headers for KeyInfo X509Certificate element
    const certBase64 = certificate
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s+/g, '');

    (sig as any).keyInfoProvider = {
      getKeyInfo: () => `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`,
      getKey: () => Buffer.from(privateKey),
    };

    sig.privateKey = Buffer.from(privateKey);

    sig.computeSignature(xml, {
      prefix: '',
      location: {
        reference: `//*[local-name(.)='${referenceTag}']`,
        action: 'after',
      },
    });

    const signedXml = sig.getSignedXml();
    this.logger.debug(`XML signed successfully (ref: ${referenceTag}).`);

    return signedXml;
  }

  /**
   * Sign, GZip compress, and Base64 encode an XML document.
   *
   * @param xml - The XML string to sign and compress
   * @param referenceTag - The element to sign (default: 'infDPS')
   */
  signAndCompress(xml: string, referenceTag = 'infDPS'): string {
    const signedXml = this.signXml(xml, referenceTag);
    const compressed = gzipSync(Buffer.from(signedXml, 'utf-8'));
    const base64 = compressed.toString('base64');

    this.logger.debug(
      `XML signed and compressed: ${signedXml.length} bytes -> ${base64.length} bytes (base64).`,
    );

    return base64;
  }
}
