import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NfseCertificateService } from './nfse-certificate.service';
import { NfseXmlBuilderService } from './nfse-xml-builder.service';
import { NfseXmlSignerService } from './nfse-xml-signer.service';
import axios, { AxiosInstance } from 'axios';

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

  constructor(
    private readonly configService: ConfigService,
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

  // NOTE: getNextNDps() removed — nfse_ndps_seq sequence and nDps field no longer exist.

  /**
   * Emit an NFS-e for the given invoice via SEFIN Nacional API.
   *
   * Flow: Build DPS XML → Sign → GZip → Base64 → POST JSON { dpsXmlGZipB64 } to /nfse
   */
  // NOTE: This SEFIN Nacional emitNfse is disabled — Ibiporã still uses municipal emission.
  // Stubbed to compile cleanly with the simplified NfseDocument schema.
  async emitNfse(invoice: EmitNfseInput): Promise<Record<string, any>> {
    this.logger.warn(
      `SEFIN Nacional emitNfse called for invoice ${invoice.id} but this integration is disabled.`,
    );
    return { skipped: true, reason: 'SEFIN_DISABLED' };
  }

  /**
   * Query an NFS-e by its access key (chaveAcesso).
   * NOTE: SEFIN Nacional integration is disabled. This method is preserved for future use.
   */
  async queryNfse(chaveAcesso: string): Promise<Record<string, any>> {
    this.logger.log(`Querying NFS-e: ${chaveAcesso}`);

    const client = this.ensureHttpClient();
    const response = await client.get(
      `/nfse/${encodeURIComponent(chaveAcesso)}`,
    );
    return response.data;
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

}
