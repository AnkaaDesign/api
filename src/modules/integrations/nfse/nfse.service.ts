import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NfseCertificateService } from './nfse-certificate.service';
import { NfseXmlBuilderService } from './nfse-xml-builder.service';
import { NfseXmlSignerService } from './nfse-xml-signer.service';
import { DpsDto } from './dto';
import axios, { AxiosInstance } from 'axios';
import { NfseStatus } from '@prisma/client';
import { gunzipSync } from 'node:zlib';

/** SEFIN Nacional (Secretaria de Finanças) API URLs */
const SEFIN_URLS: Record<number, string> = {
  1: 'https://sefin.nfse.gov.br/sefinnacional',
  2: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
};

/** ADN (Ambiente de Dados Nacional) URLs */
const ADN_URLS: Record<number, string> = {
  1: 'https://adn.nfse.gov.br',
  2: 'https://adn.producaorestrita.nfse.gov.br',
};

interface EmitNfseInput {
  id: string;
  totalAmount: number;
  customer: {
    cnpj?: string;
    cpf?: string;
    name: string;
    email?: string;
    phone?: string;
    address?: {
      cityCode: number;
      zipCode: string;
      street: string;
      number: string;
      complement?: string;
      neighborhood: string;
    };
  };
  task: {
    id: string;
    name: string;
  };
  description?: string;
}

@Injectable()
export class NfseService {
  private readonly logger = new Logger(NfseService.name);
  private httpClient: AxiosInstance;
  private adnHttpClient: AxiosInstance;

  private readonly environment: 1 | 2;
  private readonly sefinUrl: string;
  private readonly adnUrl: string;
  private readonly cnpj: string;
  private readonly inscricaoMunicipal: string;
  private readonly municipalServiceCode: string;
  private readonly nationalServiceCode: string;
  private readonly issRate: number;
  private readonly cityCode: number;
  private readonly serie: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly certificateService: NfseCertificateService,
    private readonly xmlBuilderService: NfseXmlBuilderService,
    private readonly xmlSignerService: NfseXmlSignerService,
  ) {
    this.environment = this.configService.get<number>(
      'NFSE_ENVIRONMENT',
      2,
    ) as 1 | 2;
    this.sefinUrl = this.configService.get<string>(
      'NFSE_API_URL',
      SEFIN_URLS[this.environment],
    );
    this.adnUrl = this.configService.get<string>(
      'NFSE_ADN_URL',
      ADN_URLS[this.environment],
    );
    this.cnpj = this.configService.get<string>('NFSE_CNPJ', '');
    this.inscricaoMunicipal = this.configService.get<string>(
      'NFSE_INSCRICAO_MUNICIPAL',
      '',
    );
    this.municipalServiceCode = this.configService.get<string>(
      'NFSE_MUNICIPAL_SERVICE_CODE',
      '',
    );
    this.nationalServiceCode = this.configService.get<string>(
      'NFSE_NATIONAL_SERVICE_CODE',
      '',
    );
    this.issRate = this.configService.get<number>('NFSE_ISS_RATE', 0);
    this.cityCode = this.configService.get<number>('NFSE_CITY_CODE', 0);
    this.serie = this.configService.get<string>('NFSE_SERIE', '1');

    this.initHttpClients();
  }

  private initHttpClients(): void {
    try {
      const httpsAgent = this.certificateService.getHttpsAgent();
      const commonConfig = {
        timeout: 30000,
        httpsAgent,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      };

      this.httpClient = axios.create({
        ...commonConfig,
        baseURL: this.sefinUrl,
      });
      this.adnHttpClient = axios.create({
        ...commonConfig,
        baseURL: this.adnUrl,
      });
    } catch (error) {
      this.logger.warn(
        `Could not initialize NFS-e HTTP clients: ${error.message}. Will retry on first request.`,
      );
    }
  }

  private ensureHttpClient(): AxiosInstance {
    if (!this.httpClient) {
      this.initHttpClients();
    }
    if (!this.httpClient) {
      throw new Error(
        'NFS-e HTTP client not available. Check certificate configuration.',
      );
    }
    return this.httpClient;
  }

  private ensureAdnClient(): AxiosInstance {
    if (!this.adnHttpClient) {
      this.initHttpClients();
    }
    if (!this.adnHttpClient) {
      throw new Error(
        'ADN HTTP client not available. Check certificate configuration.',
      );
    }
    return this.adnHttpClient;
  }

  /**
   * Get next sequential DPS number using a PostgreSQL sequence.
   * This is fully atomic — concurrent calls are guaranteed to get unique values.
   */
  private async getNextNDps(): Promise<number> {
    const [result] = await this.prisma.$queryRaw<[{ nextval: bigint }]>`
      SELECT nextval('nfse_ndps_seq')
    `;
    return Number(result.nextval);
  }

  /**
   * Decode a GZip+Base64 encoded string to UTF-8 text.
   */
  private decodeGzipBase64(encoded: string): string {
    const buffer = Buffer.from(encoded, 'base64');
    const decompressed = gunzipSync(buffer);
    return decompressed.toString('utf-8');
  }

  /**
   * Extract NFS-e number from NFS-e XML.
   */
  private extractNfseNumber(xml: string | null): string | null {
    if (!xml) return null;
    const match = xml.match(/<nNFSe>(\d+)<\/nNFSe>/);
    return match ? match[1] : null;
  }

  /**
   * Emit an NFS-e for the given invoice via SEFIN Nacional API.
   *
   * Flow: Build DPS XML → Sign → GZip → Base64 → POST JSON { dpsXmlGZipB64 } to /nfse
   */
  async emitNfse(invoice: EmitNfseInput): Promise<Record<string, any>> {
    this.logger.log(
      `Emitting NFS-e for invoice ${invoice.id} (task: ${invoice.task.id}).`,
    );

    let nfseDoc = await this.prisma.nfseDocument.findUnique({
      where: { invoiceId: invoice.id },
    });

    // Guard: skip if already authorized
    if (nfseDoc && nfseDoc.status === NfseStatus.AUTHORIZED) {
      this.logger.warn(
        `NFS-e already authorized for invoice ${invoice.id} (chaveAcesso=${nfseDoc.chaveAcesso}), skipping emission.`,
      );
      return { skipped: true, reason: 'ALREADY_AUTHORIZED', chaveAcesso: nfseDoc.chaveAcesso };
    }

    // Atomically claim the document for processing (PENDING/ERROR → PROCESSING)
    // Also accepts PROCESSING status (already claimed by scheduler)
    if (nfseDoc && nfseDoc.status !== NfseStatus.PROCESSING) {
      const claimed = await this.prisma.nfseDocument.updateMany({
        where: {
          id: nfseDoc.id,
          status: { in: [NfseStatus.PENDING, NfseStatus.ERROR] },
        },
        data: {
          status: NfseStatus.PROCESSING,
          errorMessage: null,
        },
      });
      if (claimed.count === 0) {
        this.logger.warn(
          `Could not claim NfseDocument ${nfseDoc.id} for processing (current status may have changed), skipping.`,
        );
        return { skipped: true, reason: 'CLAIM_FAILED' };
      }
      // Re-fetch after claiming
      nfseDoc = await this.prisma.nfseDocument.findUnique({
        where: { id: nfseDoc.id },
      });
    }

    let nDps: number;
    try {
      nDps = nfseDoc?.nDps || (await this.getNextNDps());
    } catch (seqError) {
      const msg = seqError instanceof Error ? seqError.message : String(seqError);
      this.logger.error(`Failed to get next nDps sequence: ${msg}`);
      if (nfseDoc) {
        await this.prisma.nfseDocument.update({
          where: { id: nfseDoc.id },
          data: {
            status: NfseStatus.ERROR,
            errorMessage: `Falha ao obter sequência nDps: ${msg}`.slice(0, 1000),
            errorCount: { increment: 1 },
            retryAfter: new Date(Date.now() + 5 * 60 * 1000),
          },
        });
      }
      throw seqError;
    }

    if (!nfseDoc) {
      nfseDoc = await this.prisma.nfseDocument.create({
        data: {
          invoiceId: invoice.id,
          totalAmount: invoice.totalAmount,
          municipalServiceCode: this.municipalServiceCode,
          description:
            invoice.description || `Serviço ref. OS ${invoice.task.name}`,
          issRate: this.issRate,
          issAmount: invoice.totalAmount * this.issRate,
          status: NfseStatus.PROCESSING,
          nDps,
        },
      });
    } else if (!nfseDoc.nDps) {
      // Update nDps if it wasn't set yet
      nfseDoc = await this.prisma.nfseDocument.update({
        where: { id: nfseDoc.id },
        data: { nDps },
      });
    }

    try {
      // Build DPS DTO
      const dps = this.buildDps(invoice, nDps);

      // Build XML
      const xml = this.xmlBuilderService.buildDpsXml(dps);

      // Sign, compress to GZip, and encode as Base64
      const dpsXmlGZipB64 = this.xmlSignerService.signAndCompress(xml);

      // Store the raw DPS XML
      await this.prisma.nfseDocument.update({
        where: { id: nfseDoc.id },
        data: { xml },
      });

      // Send to SEFIN Nacional API as JSON
      const client = this.ensureHttpClient();
      const response = await client.post('/nfse', { dpsXmlGZipB64 });
      const result = response.data;

      // Decode the NFS-e XML from the response
      let nfseXml: string | null = null;
      if (result.nfseXmlGZipB64) {
        nfseXml = this.decodeGzipBase64(result.nfseXmlGZipB64);
      }

      // Update NfseDocument with the authorized result
      await this.prisma.nfseDocument.update({
        where: { id: nfseDoc.id },
        data: {
          chaveAcesso: result.chaveAcesso || null,
          nfseNumber:
            result.nNFSe || this.extractNfseNumber(nfseXml) || null,
          verificationCode: result.cVerif || null,
          issuedAt: result.dhProc ? new Date(result.dhProc) : new Date(),
          status: NfseStatus.AUTHORIZED,
          xml: nfseXml || xml,
        },
      });

      this.logger.log(
        `NFS-e authorized for invoice ${invoice.id}: chaveAcesso=${result.chaveAcesso}`,
      );

      return result;
    } catch (error) {
      // SEFIN returns errors in { erros: [{ Codigo, Descricao, Complemento }] } format
      const sefinErros = error.response?.data?.erros;
      let errorMsg: string;
      if (Array.isArray(sefinErros) && sefinErros.length > 0) {
        errorMsg = sefinErros
          .map((e: any) => `[${e.Codigo}] ${e.Descricao}${e.Complemento ? ': ' + e.Complemento : ''}`)
          .join('; ');
      } else {
        errorMsg =
          error.response?.data?.xMotivo ||
          error.response?.data?.message ||
          (typeof error.response?.data === 'string'
            ? error.response.data
            : null) ||
          error.message ||
          'Unknown error';
      }

      await this.prisma.nfseDocument.update({
        where: { id: nfseDoc.id },
        data: {
          status: NfseStatus.ERROR,
          errorMessage: String(errorMsg).slice(0, 1000),
          errorCount: { increment: 1 },
          retryAfter: new Date(Date.now() + 5 * 60 * 1000),
        },
      });

      this.logger.error(
        `Failed to emit NFS-e for invoice ${invoice.id}: ${errorMsg}`,
      );
      if (error.response?.data) {
        this.logger.debug(
          `SEFIN response: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw error;
    }
  }

  /**
   * Query an NFS-e by its access key (chaveAcesso).
   */
  async queryNfse(chaveAcesso: string): Promise<Record<string, any>> {
    this.logger.log(`Querying NFS-e: ${chaveAcesso}`);

    const client = this.ensureHttpClient();
    const response = await client.get(
      `/nfse/${encodeURIComponent(chaveAcesso)}`,
    );
    const result = response.data;

    // Update local record if we have one
    const nfseDoc = await this.prisma.nfseDocument.findFirst({
      where: { chaveAcesso },
    });

    if (nfseDoc && result.nfseXmlGZipB64) {
      const nfseXml = this.decodeGzipBase64(result.nfseXmlGZipB64);
      await this.prisma.nfseDocument.update({
        where: { id: nfseDoc.id },
        data: {
          nfseNumber:
            this.extractNfseNumber(nfseXml) || nfseDoc.nfseNumber,
          xml: nfseXml,
        },
      });
    }

    return result;
  }

  /**
   * Cancel an authorized NFS-e via the SEFIN events API.
   *
   * Uses POST /nfse/{chaveAcesso}/eventos with event type e101101 (cancellation by emitter).
   */
  async cancelNfse(
    chaveAcesso: string,
    reason: string,
  ): Promise<Record<string, any>> {
    this.logger.log(
      `Cancelling NFS-e: ${chaveAcesso}. Reason: ${reason}`,
    );

    const client = this.ensureHttpClient();

    // Build cancellation event XML
    const eventXml = this.xmlBuilderService.buildCancelEventXml({
      tpAmb: this.environment,
      chNFSe: chaveAcesso,
      dhEvento: new Date().toISOString(),
      nPedRegEvento: 1,
      xMotivo: reason,
    });

    // Sign, compress, and encode the event XML
    const pedRegEventoXmlGZipB64 = this.xmlSignerService.signAndCompress(
      eventXml,
      'infPedReg',
    );

    const response = await client.post(
      `/nfse/${encodeURIComponent(chaveAcesso)}/eventos`,
      { pedRegEventoXmlGZipB64 },
    );

    const result = response.data;

    // Update local record
    const nfseDoc = await this.prisma.nfseDocument.findFirst({
      where: { chaveAcesso },
    });

    if (nfseDoc) {
      await this.prisma.nfseDocument.update({
        where: { id: nfseDoc.id },
        data: {
          status: NfseStatus.CANCELLED,
          cancelledAt: new Date(),
          errorMessage: null,
        },
      });
    }

    this.logger.log(`NFS-e cancel event registered for ${chaveAcesso}`);

    return result;
  }

  /**
   * Download the DANFS-e PDF for an NFS-e by access key.
   * Uses the ADN (Ambiente de Dados Nacional) contributors API.
   */
  async downloadDanfse(chaveAcesso: string): Promise<Buffer> {
    this.logger.log(
      `Downloading DANFS-e PDF for NFS-e: ${chaveAcesso}`,
    );

    const client = this.ensureAdnClient();
    const response = await client.get(
      `/contribuintes/danfse/${encodeURIComponent(chaveAcesso)}`,
      {
        responseType: 'arraybuffer',
        headers: { Accept: 'application/pdf' },
      },
    );

    return Buffer.from(response.data);
  }

  /**
   * Format a Date as TSDateTimeUTC: AAAA-MM-DDThh:mm:ss-03:00
   * SEFIN requires no milliseconds and explicit timezone offset (not 'Z').
   */
  private formatSefinDateTime(date: Date): string {
    // Use São Paulo timezone offset (-03:00)
    const offset = '-03:00';
    const pad = (n: number) => String(n).padStart(2, '0');
    // Adjust to -03:00
    const local = new Date(date.getTime() - 3 * 60 * 60 * 1000);
    return (
      `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
      `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${offset}`
    );
  }

  private buildDps(invoice: EmitNfseInput, nDps: number): DpsDto {
    const now = new Date();

    const toma: DpsDto['toma'] = {
      xNome: invoice.customer.name,
    };

    if (invoice.customer.cnpj) {
      toma.CNPJ = invoice.customer.cnpj.replace(/\D/g, '');
    } else if (invoice.customer.cpf) {
      toma.CPF = invoice.customer.cpf.replace(/\D/g, '');
    }

    if (invoice.customer.email) {
      toma.email = invoice.customer.email;
    }
    if (invoice.customer.phone) {
      toma.fone = invoice.customer.phone.replace(/\D/g, '');
    }

    if (invoice.customer.address) {
      const addr = invoice.customer.address;
      toma.end = {
        endNac: {
          cMun: addr.cityCode || this.cityCode,
          CEP: addr.zipCode.replace(/\D/g, ''),
        },
        xLgr: addr.street,
        nro: addr.number,
        xCpl: addr.complement,
        xBairro: addr.neighborhood,
      };
    }

    // Format dhEmi as TSDateTimeUTC: AAAA-MM-DDThh:mm:ss-03:00 (no millis, no Z)
    const brOffset = -3 * 60 * 60 * 1000;
    const local = new Date(now.getTime() + brOffset);
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const dhEmi = `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}T${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())}-03:00`;

    return {
      tpAmb: this.environment,
      dhEmi,
      verAplic: 'ANKAA-1.0',
      serie: this.serie,
      nDPS: nDps,
      dCompet: now.toISOString().slice(0, 10),
      tpEmit: 1,
      cLocEmi: this.cityCode,
      prest: {
        CNPJ: this.cnpj.replace(/\D/g, ''),
        IM: this.inscricaoMunicipal || undefined,
        regTrib: {
          opSimpNac: 1, // 1 = Não Optante pelo Simples Nacional
          regEspTrib: 0, // 0 = Nenhum regime especial
        },
      },
      toma,
      serv: {
        locPrest: {
          cLocPrestacao: this.cityCode,
        },
        cServ: {
          cTribNac: this.nationalServiceCode,
          cTribMun: this.municipalServiceCode || undefined,
          xDescServ:
            invoice.description ||
            `Serviço ref. OS ${invoice.task.name}`,
        },
      },
      valores: {
        vServPrest: { vServ: invoice.totalAmount },
        trib: {
          tribMun: {
            tribISSQN: 1, // 1 = Operação tributável
            tpRetISSQN: 2, // 2 = Retido pelo tomador
          },
          totTrib: { indTotTrib: 0 },
        },
      },
    };
  }
}
