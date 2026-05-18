import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { SiegDownloadParams, SiegXmlResponseItem } from './types/sieg.types';

/**
 * Token-bucket limiter (in-process). SIEG documents a 30 req/min cap on the
 * BaixarXmls endpoint. We enforce ≤ 30 requests in any 60s sliding window.
 */
class TokenBucket {
  private readonly windowMs = 60_000;
  private readonly maxRequests = 30;
  private timestamps: number[] = [];

  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (now - oldest) + 50;
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}

@Injectable()
export class SiegService {
  private readonly logger = new Logger(SiegService.name);
  private readonly http: AxiosInstance;
  private readonly bucket = new TokenBucket();
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('SIEG_API_KEY') || undefined;
    this.baseUrl = this.config.get<string>('SIEG_BASE_URL', 'https://api.sieg.com');
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30_000,
      headers: { Accept: 'application/json' },
    });
  }

  /**
   * Feature-flag: `true` when `SIEG_API_KEY` is configured.
   */
  isEnabled(): boolean {
    return !!this.apiKey;
  }

  /**
   * Fetches a single page (≤ 50 items) of XMLs from SIEG.
   * Retries with exponential backoff on 429 / 5xx (max 3 attempts).
   */
  async downloadXmls(params: SiegDownloadParams): Promise<SiegXmlResponseItem[]> {
    if (!this.apiKey) {
      throw new Error('SIEG integration disabled (SIEG_API_KEY not set)');
    }

    const body: Record<string, unknown> = {
      XmlType: params.xmlType,
      Take: Math.min(params.take ?? 50, 50),
      Skip: params.skip ?? 0,
      DataInicio: params.dateStart,
      DataFim: params.dateEnd,
    };
    if (params.cnpjEmit) body.CnpjEmit = params.cnpjEmit;
    if (params.cnpjDest) body.CnpjDest = params.cnpjDest;

    let attempt = 0;
    let lastError: unknown;
    while (attempt < 3) {
      await this.bucket.acquire();
      try {
        const url = `/BaixarXmls?api_key=${encodeURIComponent(this.apiKey)}`;
        const response = await this.http.post(url, body);
        const data = response.data;

        // SIEG response shape varies; normalize to array
        if (Array.isArray(data)) return data as SiegXmlResponseItem[];
        if (data && Array.isArray(data.Xmls)) return data.Xmls as SiegXmlResponseItem[];
        if (data && Array.isArray(data.xmls)) return data.xmls as SiegXmlResponseItem[];
        if (typeof data === 'string') {
          // Single base64 XML response — wrap it
          return [{ xml: data }];
        }
        this.logger.warn(`Unexpected SIEG response shape: ${typeof data}`);
        return [];
      } catch (err) {
        lastError = err;
        const ax = err as AxiosError;
        const status = ax.response?.status;
        if (status === 429 || (status && status >= 500)) {
          const backoff = Math.min(1000 * 2 ** attempt, 8000);
          this.logger.warn(
            `SIEG ${status} on attempt ${attempt + 1}; backing off ${backoff}ms`,
          );
          await new Promise(r => setTimeout(r, backoff));
          attempt += 1;
          continue;
        }
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('SIEG download failed');
  }

  /**
   * Paginates through SIEG until an empty page is returned.
   */
  async *downloadAllXmls(
    params: Omit<SiegDownloadParams, 'skip' | 'take'>,
  ): AsyncGenerator<SiegXmlResponseItem, void, void> {
    let skip = 0;
    const take = 50;
    while (true) {
      const page = await this.downloadXmls({ ...params, skip, take });
      if (page.length === 0) return;
      for (const item of page) yield item;
      if (page.length < take) return;
      skip += take;
    }
  }
}
