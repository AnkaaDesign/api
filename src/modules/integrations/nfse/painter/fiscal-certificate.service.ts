/**
 * Cofre dos certificados A1 dos prestadores.
 *
 * Responsável por cadastrar, validar, decifrar sob demanda e servir agentes mTLS
 * por certificado. Substitui, para o caminho de terceiros, o
 * `NfseCertificateService` — que é um singleton de um único PFX lido do ambiente
 * no boot e não tem como ser parametrizado por emitente.
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type { FiscalCertificate } from '@prisma/client';
import * as https from 'node:https';
import {
  CURRENT_KEK_VERSION,
  type CertificateMaterial,
  decryptPassword,
  decryptPfx,
  documentsMatch,
  encryptPassword,
  encryptPfx,
  fingerprintPfx,
  parsePfx,
  resolveKek,
  unwrapDek,
  wrapNewDek,
} from './fiscal-certificate.crypto';

/** Quantos certificados mantemos decifrados em memória ao mesmo tempo. */
const MAX_CACHED_CERTIFICATES = 25;
/** Tempo de vida da entrada no cache. Curto de propósito: chave privada em RAM. */
const CACHE_TTL_MS = 15 * 60 * 1000;

interface CachedCertificate {
  material: CertificateMaterial;
  agent: https.Agent;
  expiresAt: number;
  lastUsedAt: number;
}

export interface CertificateSummary {
  id: string;
  profileId: string;
  holderDocument: string;
  subjectCommonName: string;
  issuer: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
  isActive: boolean;
  revokedAt: Date | null;
  daysUntilExpiry: number;
  isExpired: boolean;
  createdAt: Date;
}

@Injectable()
export class FiscalCertificateService {
  private readonly logger = new Logger(FiscalCertificateService.name);
  private readonly cache = new Map<string, CachedCertificate>();
  private kek: Buffer | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private getKek(): Buffer {
    if (!this.kek) {
      const { key, derivedFromJwt } = resolveKek();
      if (derivedFromJwt) {
        this.logger.warn(
          'FISCAL_CERT_KEK não configurada — a chave está sendo derivada do JWT_SECRET. ' +
            'Rotacionar o JWT tornará TODOS os certificados indecifráveis. ' +
            'Defina FISCAL_CERT_KEK (openssl rand -base64 32) antes de produção.',
        );
      }
      this.kek = key;
    }
    return this.kek;
  }

  /**
   * Cadastra (ou substitui) o certificado A1 de um emitente.
   *
   * Valida na ordem em que as coisas dão errado na prática: senha, chave
   * exportável, validade, e por último o casamento do documento — que é o erro
   * mais caro de descobrir só na hora da emissão, quando a SEFIN devolve E1209.
   */
  async upload(params: {
    profileId: string;
    pfx: Buffer;
    password: string;
  }): Promise<CertificateSummary> {
    const { profileId, pfx, password } = params;

    const profile = await this.prisma.fiscalEmitterProfile.findUnique({
      where: { id: profileId },
      select: { id: true, cnpj: true, corporateName: true },
    });
    if (!profile) {
      throw new NotFoundException('Perfil fiscal não encontrado.');
    }

    if (!pfx?.length) {
      throw new BadRequestException('Arquivo de certificado vazio.');
    }
    if (!password) {
      throw new BadRequestException('Informe a senha do certificado.');
    }

    // parsePfx já lança mensagens em pt-BR prontas para a tela.
    const parsed = parsePfx(pfx, password);

    const now = new Date();
    if (parsed.notAfter <= now) {
      throw new BadRequestException(
        `Certificado vencido em ${parsed.notAfter.toLocaleDateString('pt-BR')}. Envie um certificado válido.`,
      );
    }
    if (parsed.notBefore > now) {
      throw new BadRequestException(
        `Certificado só passa a valer em ${parsed.notBefore.toLocaleDateString('pt-BR')}.`,
      );
    }

    if (parsed.holderIsIndividual) {
      throw new BadRequestException(
        'O arquivo enviado é um e-CPF. A emissão de NFS-e pelo MEI exige e-CNPJ (o certificado precisa conter o CNPJ).',
      );
    }

    if (!documentsMatch(parsed.holderDocument, profile.cnpj)) {
      throw new BadRequestException(
        `O CNPJ do certificado (${parsed.holderDocument ?? 'não identificado'}) não corresponde ao CNPJ cadastrado no perfil fiscal (${profile.cnpj}).`,
      );
    }

    const fingerprint = fingerprintPfx(pfx);

    const duplicate = await this.prisma.fiscalCertificate.findUnique({
      where: { fingerprint },
      select: { id: true, profileId: true, isActive: true },
    });
    if (duplicate && duplicate.profileId !== profileId) {
      throw new BadRequestException(
        'Este mesmo arquivo de certificado já está cadastrado para outro emitente.',
      );
    }

    const kek = this.getKek();
    const { dek, wrappedDek } = wrapNewDek(fingerprint, kek);
    const pfxBlob = encryptPfx(pfx, dek, fingerprint);
    const pwdBlob = encryptPassword(password, dek, fingerprint);

    // Desativa o anterior e insere o novo na mesma transação: o índice parcial
    // único (isActive) rejeitaria os dois ativos ao mesmo tempo.
    const created = await this.prisma.$transaction(async tx => {
      await tx.fiscalCertificate.updateMany({
        where: { profileId, isActive: true },
        data: { isActive: false, revokedAt: now },
      });

      if (duplicate) {
        return tx.fiscalCertificate.update({
          where: { id: duplicate.id },
          data: {
            holderDocument: parsed.holderDocument!,
            subjectCommonName: parsed.subjectCommonName,
            issuer: parsed.issuer,
            serialNumber: parsed.serialNumber,
            notBefore: parsed.notBefore,
            notAfter: parsed.notAfter,
            kekVersion: CURRENT_KEK_VERSION,
            wrappedDek,
            // Prisma tipa Bytes como Uint8Array<ArrayBuffer>; Buffer do Node é
            // Uint8Array<ArrayBufferLike> e não satisfaz o tipo mais estreito.
            pfxCiphertext: new Uint8Array(pfxBlob.ciphertext),
            pfxIv: pfxBlob.iv,
            pfxAuthTag: pfxBlob.authTag,
            passwordCiphertext: pwdBlob.ciphertext,
            passwordIv: pwdBlob.iv,
            passwordAuthTag: pwdBlob.authTag,
            isActive: true,
            revokedAt: null,
          },
        });
      }

      return tx.fiscalCertificate.create({
        data: {
          profileId,
          holderDocument: parsed.holderDocument!,
          subjectCommonName: parsed.subjectCommonName,
          issuer: parsed.issuer,
          serialNumber: parsed.serialNumber,
          notBefore: parsed.notBefore,
          notAfter: parsed.notAfter,
          fingerprint,
          kekVersion: CURRENT_KEK_VERSION,
          wrappedDek,
          pfxCiphertext: new Uint8Array(pfxBlob.ciphertext),
          pfxIv: pfxBlob.iv,
          pfxAuthTag: pfxBlob.authTag,
          passwordCiphertext: pwdBlob.ciphertext,
          passwordIv: pwdBlob.iv,
          passwordAuthTag: pwdBlob.authTag,
          isActive: true,
        },
      });
    });

    this.evict(created.id);
    this.logger.log(
      `[FISCAL_CERT] Certificado cadastrado para ${profile.corporateName} (CNPJ ${profile.cnpj}), ` +
        `série ${parsed.serialNumber}, válido até ${parsed.notAfter.toISOString().slice(0, 10)}.`,
    );

    return this.toSummary(created);
  }

  /** Certificado ativo do emitente, ou null. Nunca devolve material sensível. */
  async getActive(profileId: string): Promise<CertificateSummary | null> {
    const cert = await this.prisma.fiscalCertificate.findFirst({
      where: { profileId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    return cert ? this.toSummary(cert) : null;
  }

  async listForProfile(profileId: string): Promise<CertificateSummary[]> {
    const certs = await this.prisma.fiscalCertificate.findMany({
      where: { profileId },
      orderBy: { createdAt: 'desc' },
    });
    return certs.map(c => this.toSummary(c));
  }

  async revoke(certificateId: string): Promise<CertificateSummary> {
    const cert = await this.prisma.fiscalCertificate.update({
      where: { id: certificateId },
      data: { isActive: false, revokedAt: new Date() },
    });
    this.evict(certificateId);
    return this.toSummary(cert);
  }

  /**
   * Decifra o certificado e devolve o material de assinatura mais um agente mTLS.
   *
   * O agente é reaproveitado por certificado: um agente novo por requisição
   * significaria handshake TLS novo a cada nota e um pool de sockets que nunca é
   * coletado.
   */
  async getSigningContext(
    certificateId: string,
  ): Promise<{ material: CertificateMaterial; agent: https.Agent; record: FiscalCertificate }> {
    const record = await this.prisma.fiscalCertificate.findUnique({
      where: { id: certificateId },
    });
    if (!record) {
      throw new NotFoundException('Certificado não encontrado.');
    }
    if (!record.isActive) {
      throw new BadRequestException('Certificado revogado — cadastre um novo para voltar a emitir.');
    }
    if (record.notAfter <= new Date()) {
      throw new BadRequestException(
        `Certificado vencido em ${record.notAfter.toLocaleDateString('pt-BR')} — cadastre um novo para voltar a emitir.`,
      );
    }

    const cached = this.cache.get(certificateId);
    if (cached && cached.expiresAt > Date.now()) {
      cached.lastUsedAt = Date.now();
      return { material: cached.material, agent: cached.agent, record };
    }
    if (cached) this.evict(certificateId);

    const kek = this.getKek();
    const dek = unwrapDek(record.wrappedDek, record.fingerprint, kek, record.kekVersion);
    const pfx = decryptPfx(
      {
        ciphertext: Buffer.from(record.pfxCiphertext),
        iv: record.pfxIv,
        authTag: record.pfxAuthTag,
      },
      dek,
      record.fingerprint,
    );
    const password = decryptPassword(
      {
        ciphertext: record.passwordCiphertext,
        iv: record.passwordIv,
        authTag: record.passwordAuthTag,
      },
      dek,
      record.fingerprint,
    );

    const parsed = parsePfx(pfx, password);

    // `ca` fica DELIBERADAMENTE sem definir: essa opção SUBSTITUI a trust store
    // padrão em vez de somar a ela, então apontar as raízes ICP-Brasil aqui
    // quebraria a validação do certificado DO SERVIDOR da SEFIN.
    const agent = new https.Agent({
      pfx,
      passphrase: password,
      rejectUnauthorized: true,
      keepAlive: true,
      maxSockets: 4,
      maxFreeSockets: 2,
      timeout: 60_000,
    });

    this.enforceCacheBound();
    this.cache.set(certificateId, {
      material: {
        privateKeyPem: parsed.privateKeyPem,
        certificatePem: parsed.certificatePem,
        chainPem: parsed.chainPem,
      },
      agent,
      expiresAt: Date.now() + CACHE_TTL_MS,
      lastUsedAt: Date.now(),
    });

    return {
      material: {
        privateKeyPem: parsed.privateKeyPem,
        certificatePem: parsed.certificatePem,
        chainPem: parsed.chainPem,
      },
      agent,
      record,
    };
  }

  /** Certificados ativos vencendo dentro de N dias — alimenta o alerta diário. */
  async findExpiring(withinDays: number): Promise<CertificateSummary[]> {
    const limit = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
    const certs = await this.prisma.fiscalCertificate.findMany({
      where: { isActive: true, notAfter: { lte: limit } },
      orderBy: { notAfter: 'asc' },
    });
    return certs.map(c => this.toSummary(c));
  }

  private evict(certificateId: string): void {
    const entry = this.cache.get(certificateId);
    if (entry) {
      entry.agent.destroy();
      this.cache.delete(certificateId);
    }
  }

  private enforceCacheBound(): void {
    while (this.cache.size >= MAX_CACHED_CERTIFICATES) {
      let oldestKey: string | null = null;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [key, value] of this.cache) {
        if (value.lastUsedAt < oldestAt) {
          oldestAt = value.lastUsedAt;
          oldestKey = key;
        }
      }
      if (!oldestKey) return;
      this.evict(oldestKey);
    }
  }

  private toSummary(cert: FiscalCertificate): CertificateSummary {
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysUntilExpiry = Math.floor((cert.notAfter.getTime() - Date.now()) / msPerDay);
    return {
      id: cert.id,
      profileId: cert.profileId,
      holderDocument: cert.holderDocument,
      subjectCommonName: cert.subjectCommonName,
      issuer: cert.issuer,
      serialNumber: cert.serialNumber,
      notBefore: cert.notBefore,
      notAfter: cert.notAfter,
      isActive: cert.isActive,
      revokedAt: cert.revokedAt,
      daysUntilExpiry,
      isExpired: daysUntilExpiry < 0,
      createdAt: cert.createdAt,
    };
  }
}
