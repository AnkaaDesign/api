/**
 * Cifragem em envelope dos certificados A1 dos prestadores e leitura do PFX.
 *
 * Duas decisões que valem explicar, porque ambas divergem do que já existia no
 * repositório:
 *
 * 1. **KEK própria, não JWT_SECRET.** `SecretsManager` (common/config/secrets.manager.ts)
 *    deriva a chave de `env.JWT_SECRET`. Isso é aceitável para segredos
 *    descartáveis, mas aqui significaria que rotacionar o JWT — operação de
 *    rotina, feita sem pensar em fisco — tornaria TODOS os certificados
 *    indecifráveis de uma vez. Usamos `FISCAL_CERT_KEK` dedicada, com fallback
 *    derivado do JWT_SECRET só para ambiente de desenvolvimento (com aviso).
 *
 * 2. **node-forge, não `openssl` via execSync.** `NfseCertificateService` monta
 *    `openssl pkcs12 ... -passin pass:"${password}"` numa string de shell: a
 *    senha vaza para a tabela de processos e um caractere especial vira injeção.
 *    Com N certificados de terceiros isso deixa de ser teórico.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import * as forge from 'node-forge';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // recomendado para GCM (NIST SP 800-38D §8.2)
const KEY_BYTES = 32;

/** Versão corrente da KEK. Incrementar ao rotacionar; ver `rewrapDek`. */
export const CURRENT_KEK_VERSION = 1;

/** OID ICP-Brasil do CNPJ dentro de subjectAltName/otherName. */
const OID_CNPJ = '2.16.76.1.3.3';
/** OID ICP-Brasil do CPF (pessoa física) — e-CPF em vez de e-CNPJ. */
const OID_CPF = '2.16.76.1.3.1';

export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: string;
  authTag: string;
}

export interface CertificateMaterial {
  /** Chave privada em PEM (PKCS#8), pronta para o xml-crypto. */
  privateKeyPem: string;
  /** Certificado folha em PEM — vai no <X509Certificate> do KeyInfo. */
  certificatePem: string;
  /** Intermediárias, quando o PFX as traz. Usadas para completar a cadeia no mTLS. */
  chainPem: string[];
}

export interface CertificateMetadata {
  /** CNPJ (14) ou CPF (11) lido de dentro do certificado, só dígitos. */
  holderDocument: string | null;
  /** true quando o documento veio do OID de CPF — e-CPF, não e-CNPJ. */
  holderIsIndividual: boolean;
  subjectCommonName: string;
  issuer: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
}

export type ParsedCertificate = CertificateMaterial & CertificateMetadata;

/**
 * Resolve a KEK a partir do ambiente.
 *
 * `FISCAL_CERT_KEK` deve ser 32 bytes em base64 (`openssl rand -base64 32`).
 * Sem ela, deriva do JWT_SECRET apenas para não travar o ambiente de dev — mas
 * então a rotação do JWT invalida os certificados guardados, e é por isso que a
 * função avisa.
 */
export function resolveKek(env: NodeJS.ProcessEnv = process.env): {
  key: Buffer;
  derivedFromJwt: boolean;
} {
  const configured = env.FISCAL_CERT_KEK?.trim();

  if (configured) {
    const key = Buffer.from(configured, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `FISCAL_CERT_KEK precisa ter exatamente ${KEY_BYTES} bytes em base64 (recebeu ${key.length}). Gere com: openssl rand -base64 32`,
      );
    }
    return { key, derivedFromJwt: false };
  }

  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error(
      'Nem FISCAL_CERT_KEK nem JWT_SECRET estão definidos — impossível cifrar certificados.',
    );
  }

  return {
    key: scryptSync(jwtSecret, 'ankaa-fiscal-cert-kek-v1', KEY_BYTES),
    derivedFromJwt: true,
  };
}

function encrypt(plaintext: Buffer, key: Buffer, aad: string): EncryptedBlob {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf-8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext,
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

function decrypt(blob: EncryptedBlob, key: Buffer, aad: string): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(blob.iv, 'hex'));
  decipher.setAAD(Buffer.from(aad, 'utf-8'));
  decipher.setAuthTag(Buffer.from(blob.authTag, 'hex'));
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
}

/**
 * Gera uma DEK nova e a embrulha com a KEK.
 *
 * A AAD amarra o embrulho ao certificado (`fingerprint`) e à versão da KEK, de
 * modo que mover o blob de uma linha para outra quebra a autenticação em vez de
 * decifrar silenciosamente.
 */
export function wrapNewDek(
  fingerprint: string,
  kek: Buffer,
  kekVersion = CURRENT_KEK_VERSION,
): { dek: Buffer; wrappedDek: string } {
  const dek = randomBytes(KEY_BYTES);
  const blob = encrypt(dek, kek, `${fingerprint}|kek|${kekVersion}`);
  return {
    dek,
    wrappedDek: `${blob.iv}:${blob.authTag}:${blob.ciphertext.toString('hex')}`,
  };
}

export function unwrapDek(
  wrappedDek: string,
  fingerprint: string,
  kek: Buffer,
  kekVersion = CURRENT_KEK_VERSION,
): Buffer {
  const parts = wrappedDek.split(':');
  if (parts.length !== 3) {
    throw new Error('Formato inválido de DEK embrulhada (esperado iv:authTag:ciphertext).');
  }
  const [iv, authTag, ciphertext] = parts;
  return decrypt(
    { iv, authTag, ciphertext: Buffer.from(ciphertext, 'hex') },
    kek,
    `${fingerprint}|kek|${kekVersion}`,
  );
}

export function encryptPfx(pfx: Buffer, dek: Buffer, fingerprint: string): EncryptedBlob {
  return encrypt(pfx, dek, `${fingerprint}|pfx`);
}

export function decryptPfx(blob: EncryptedBlob, dek: Buffer, fingerprint: string): Buffer {
  return decrypt(blob, dek, `${fingerprint}|pfx`);
}

export function encryptPassword(
  password: string,
  dek: Buffer,
  fingerprint: string,
): { ciphertext: string; iv: string; authTag: string } {
  const blob = encrypt(Buffer.from(password, 'utf-8'), dek, `${fingerprint}|pwd`);
  return {
    ciphertext: blob.ciphertext.toString('hex'),
    iv: blob.iv,
    authTag: blob.authTag,
  };
}

export function decryptPassword(
  stored: { ciphertext: string; iv: string; authTag: string },
  dek: Buffer,
  fingerprint: string,
): string {
  return decrypt(
    {
      ciphertext: Buffer.from(stored.ciphertext, 'hex'),
      iv: stored.iv,
      authTag: stored.authTag,
    },
    dek,
    `${fingerprint}|pwd`,
  ).toString('utf-8');
}

/** SHA-256 do PFX cru — identidade estável do arquivo, usada como AAD e unique key. */
export function fingerprintPfx(pfx: Buffer): string {
  return createHash('sha256').update(pfx).digest('hex');
}

/**
 * Extrai CNPJ/CPF da extensão subjectAltName.
 *
 * node-forge NÃO decodifica `otherName`: em lib/x509.js o switch de tipos trata
 * 1/2/6/7/8 e joga o tipo 0 no default, deixando `value` como o DER cru do
 * SEQUENCE. Então parseamos o DER na mão.
 */
function readDocumentFromSan(cert: forge.pki.Certificate): {
  document: string | null;
  isIndividual: boolean;
} {
  const san = cert.extensions?.find(e => e.name === 'subjectAltName');
  const altNames: Array<{ type: number; value: string }> = san?.altNames ?? [];

  for (const alt of altNames) {
    if (alt.type !== 0) continue; // 0 = otherName

    try {
      const seq = forge.asn1.fromDer(alt.value) as forge.asn1.Asn1;
      const children = seq.value as forge.asn1.Asn1[];
      if (!Array.isArray(children) || children.length < 2) continue;

      const oid = forge.asn1.derToOid(children[0].value as string);
      if (oid !== OID_CNPJ && oid !== OID_CPF) continue;

      // [0] EXPLICIT { valor }
      const wrapper = children[1].value as forge.asn1.Asn1[];
      const raw = (Array.isArray(wrapper) ? (wrapper[0]?.value as string) : '') ?? '';
      const digits = String(raw).replace(/\D/g, '');
      if (!digits) continue;

      if (oid === OID_CNPJ) {
        return { document: digits.slice(0, 14).padStart(14, '0'), isIndividual: false };
      }
      // O bloco de e-CPF começa com data de nascimento (8) + CPF (11) + ...
      const cpf = digits.length > 11 ? digits.slice(8, 19) : digits;
      return { document: cpf.padStart(11, '0'), isIndividual: true };
    } catch {
      // otherName ilegível: segue para o próximo, o fallback de CN resolve.
    }
  }

  return { document: null, isIndividual: false };
}

function formatDn(attrs: forge.pki.CertificateField[]): string {
  return attrs
    .map(a => `${a.shortName || a.name}=${a.value}`)
    .filter(Boolean)
    .join(', ');
}

/**
 * Abre o PFX e devolve chave, certificado folha, cadeia e metadados.
 *
 * A folha é escolhida por comparação de MÓDULO RSA com a chave privada, e não por
 * `friendlyName`/`localKeyId` — as ACs brasileiras são inconsistentes nesses
 * rótulos, e um PFX com cadeia completa tem várias entradas em certBag. Mesmo
 * critério já usado por `CadesP12Signer`.
 *
 * Lança com mensagem em pt-BR: essas mensagens sobem direto para a tela de
 * cadastro do certificado.
 */
export function parsePfx(pfx: Buffer, password: string): ParsedCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(pfx.toString('binary'));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/mac could not be verified|invalid password/i.test(message)) {
      throw new Error('Senha do certificado incorreta.');
    }
    throw new Error(`Arquivo de certificado inválido ou corrompido: ${message}`);
  }

  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ??
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ??
    [];

  const privateKey = keyBags[0]?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!privateKey) {
    // Acontece com certificado cuja chave é marcada como não exportável (típico
    // de A3/token). Não há contorno em software: o arquivo não serve para
    // assinatura no servidor.
    throw new Error(
      'O certificado não contém chave privada exportável. Só certificados A1 (.pfx/.p12) podem ser usados para emissão automática.',
    );
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const certs = certBags.map(b => b.cert).filter((c): c is forge.pki.Certificate => Boolean(c));
  if (certs.length === 0) {
    throw new Error('O arquivo não contém nenhum certificado.');
  }

  const leaf =
    certs.find(c => {
      const pub = c.publicKey as forge.pki.rsa.PublicKey | undefined;
      return Boolean(pub?.n) && privateKey.n.compareTo(pub!.n) === 0;
    }) ?? certs[0];

  const chain = certs.filter(c => c !== leaf);

  const commonName = leaf.subject.attributes.find(a => a.shortName === 'CN')?.value as
    | string
    | undefined;

  const fromSan = readDocumentFromSan(leaf);
  // Fallback: convenção ICP-Brasil de CN "RAZÃO SOCIAL:CNPJ".
  const fromCn = commonName?.match(/:(\d{11,14})$/)?.[1] ?? null;
  const document = fromSan.document ?? fromCn;

  return {
    privateKeyPem: forge.pki.privateKeyToPem(privateKey),
    certificatePem: forge.pki.certificateToPem(leaf),
    chainPem: chain.map(c => forge.pki.certificateToPem(c)),
    holderDocument: document,
    holderIsIndividual: fromSan.document ? fromSan.isIndividual : document?.length === 11,
    subjectCommonName: commonName ?? 'Desconhecido',
    issuer: formatDn(leaf.issuer.attributes),
    serialNumber: leaf.serialNumber.toUpperCase(),
    notBefore: leaf.validity.notBefore,
    notAfter: leaf.validity.notAfter,
  };
}

/** Comparação de documentos em tempo constante, para não virar oráculo. */
export function documentsMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a.replace(/\D/g, ''));
  const bufB = Buffer.from(b.replace(/\D/g, ''));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
