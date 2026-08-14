/**
 * Assinatura XMLDSig da DPS e dos eventos, com o certificado do próprio prestador.
 *
 * A assinatura é OBRIGATÓRIA na via API. A dispensa de certificado que o art.
 * 106-A §3º II dá ao MEI vale só para o emissor web/app: o ANEXO I, na linha
 * `Signature` do leiaute, diz "Obrigatório quando for enviado para API".
 *
 * ─── Por que esta classe existe em vez de reusar NfseXmlSignerService ───
 * O assinador antigo tem três defeitos que o tornam inutilizável aqui:
 *
 *   1. Usa `keyInfoProvider`, API REMOVIDA no xml-crypto v4. Em v6 o campo é
 *      ignorado em silêncio e o resultado sai SEM <KeyInfo>/<X509Certificate> —
 *      que o esquema da NFS-e exige. Falha como "assinatura inválida", sem pista.
 *      O correto é `publicCert`, que alimenta o `getKeyInfoContent` padrão.
 *   2. Declara canonicalização EXCLUSIVA. O xmldsig-core-schema restrito da
 *      NFS-e fixa a INCLUSIVA (REC-xml-c14n-20010315).
 *   3. Lê o certificado de um singleton global — não há como assinar com o
 *      certificado de um pintor específico.
 *
 * ─── Sobre SHA-1 ───
 * Parece anacrônico, mas é o que o layout exige: o xmldsig-core-schema.xsd
 * restrito distribuído com o esquema 1.00 fixa `rsa-sha1`/`sha1` com
 * `fixed="..."`, e todas as implementações de referência usam esse par (mesma
 * escolha da NF-e). O esquema 1.01 traz a versão irrestrita do xmldsig, na qual
 * SHA-256 seria válido — mas usar SHA-1 é aceito pelos DOIS, então é a escolha
 * segura. `NFSE_SIGNATURE_ALGORITHM=sha256` inverte isso sem alterar código, caso
 * a SEFIN passe a exigir.
 */

import { Injectable, Logger } from '@nestjs/common';
import { SignedXml } from 'xml-crypto';
import { gzipSync } from 'node:zlib';
import type { CertificateMaterial } from './fiscal-certificate.crypto';

const C14N_INCLUSIVE = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const TRANSFORM_ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

const ALGORITHMS = {
  sha1: {
    signature: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    digest: 'http://www.w3.org/2000/09/xmldsig#sha1',
  },
  sha256: {
    signature: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    digest: 'http://www.w3.org/2001/04/xmlenc#sha256',
  },
} as const;

@Injectable()
export class DpsSignerService {
  private readonly logger = new Logger(DpsSignerService.name);

  private algorithms() {
    const choice = process.env.NFSE_SIGNATURE_ALGORITHM === 'sha256' ? 'sha256' : 'sha1';
    return ALGORITHMS[choice];
  }

  /**
   * Assina o elemento indicado e devolve o XML assinado.
   *
   * A string devolvida é a que precisa ser transmitida BYTE A BYTE. Reindentar,
   * reparsear ou reescapar depois daqui invalida o digest.
   *
   * @param referenceTag `infDPS` para a DPS, `infPedReg` para eventos.
   */
  sign(xml: string, material: CertificateMaterial, referenceTag: 'infDPS' | 'infPedReg'): string {
    const { signature, digest } = this.algorithms();
    const xpath = `//*[local-name(.)='${referenceTag}']`;

    const sig = new SignedXml({
      idAttribute: 'Id',
      privateKey: material.privateKeyPem,
      // É ESTE campo que produz <KeyInfo><X509Data><X509Certificate>.
      publicCert: material.certificatePem,
      signatureAlgorithm: signature,
      canonicalizationAlgorithm: C14N_INCLUSIVE,
    });

    sig.addReference({
      xpath,
      digestAlgorithm: digest,
      // A ordem importa e o esquema aceita exatamente duas: enveloped primeiro,
      // canonicalização depois.
      transforms: [TRANSFORM_ENVELOPED, C14N_INCLUSIVE],
    });

    sig.computeSignature(xml, {
      // Namespace padrão, sem prefixo "ds:". Os validadores brasileiros são
      // rígidos nisso e toda implementação de referência emite sem prefixo.
      prefix: '',
      location: { reference: xpath, action: 'after' },
    });

    const signed = sig.getSignedXml();

    if (!signed.includes('<X509Certificate>')) {
      // Guarda contra regressão silenciosa: foi exatamente esta ausência que
      // deixou o assinador antigo produzindo XML recusado sem explicação.
      throw new Error(
        'Assinatura gerada sem X509Certificate — o certificado não foi aplicado ao KeyInfo.',
      );
    }

    return signed;
  }

  /**
   * Assina, comprime e codifica para o corpo JSON da SEFIN.
   *
   * A ordem é GZIP e DEPOIS base64. Invertida, a resposta é a rejeição E1225
   * ("falha na descompactação da base 64").
   */
  signAndPack(
    xml: string,
    material: CertificateMaterial,
    referenceTag: 'infDPS' | 'infPedReg',
  ): { signedXml: string; packed: string } {
    const signedXml = this.sign(xml, material, referenceTag);
    const packed = gzipSync(Buffer.from(signedXml, 'utf-8')).toString('base64');

    this.logger.debug(
      `[DPS_SIGN] ${referenceTag} assinado: ${signedXml.length} bytes -> ${packed.length} bytes em base64.`,
    );

    return { signedXml, packed };
  }
}
