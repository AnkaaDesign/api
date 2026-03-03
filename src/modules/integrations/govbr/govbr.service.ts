import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { getGovbrConfig } from './govbr.config';
import {
  GovbrEnvironment,
  SignDocumentResponse,
  GetCertificateResponse,
} from './dto/sign-document.dto';

@Injectable()
export class GovbrService {
  private readonly logger = new Logger(GovbrService.name);

  constructor(private readonly configService: ConfigService) {}

  private createClient(baseURL: string): AxiosInstance {
    return axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }

  async exchangeToken(
    code: string,
    environment: GovbrEnvironment,
    redirectUri: string,
  ): Promise<string> {
    const config = getGovbrConfig(this.configService, environment);

    if (!config.clientId || !config.clientSecret) {
      throw new BadRequestException(
        `Gov.br ${environment} credentials not configured`,
      );
    }

    this.logger.log(
      `Exchanging authorization code for token (${environment})`,
    );

    try {
      const response = await axios.post(
        config.tokenUrl,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15000,
        },
      );

      const accessToken = response.data?.access_token;
      if (!accessToken) {
        throw new BadRequestException(
          'Token exchange failed: no access_token in response',
        );
      }

      this.logger.log('Token exchange successful');
      return accessToken;
    } catch (error) {
      this.handleApiError(error, 'token exchange');
    }
  }

  async signHash(
    accessToken: string,
    hashBase64: string,
    environment: GovbrEnvironment,
  ): Promise<SignDocumentResponse> {
    const config = getGovbrConfig(this.configService, environment);

    this.logger.log(`Signing document hash (${environment})`);

    try {
      const response = await axios.post(
        config.signUrl,
        { hashBase64 },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 30000,
        },
      );

      this.logger.log('Document signed successfully');

      return {
        signature: response.data?.signature || response.data,
        signedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.handleApiError(error, 'document signing');
    }
  }

  async getCertificate(
    accessToken: string,
    environment: GovbrEnvironment,
  ): Promise<GetCertificateResponse> {
    const config = getGovbrConfig(this.configService, environment);

    this.logger.log(`Retrieving public certificate (${environment})`);

    try {
      const response = await axios.get(config.certificateUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 15000,
      });

      this.logger.log('Certificate retrieved successfully');

      return {
        certificate: response.data?.certificate || response.data,
        subjectDN: response.data?.subjectDN,
        issuerDN: response.data?.issuerDN,
        notBefore: response.data?.notBefore,
        notAfter: response.data?.notAfter,
      };
    } catch (error) {
      this.handleApiError(error, 'certificate retrieval');
    }
  }

  async exchangeAndSign(
    code: string,
    hashBase64: string,
    environment: GovbrEnvironment,
    redirectUri: string,
  ): Promise<SignDocumentResponse> {
    const accessToken = await this.exchangeToken(code, environment, redirectUri);
    return this.signHash(accessToken, hashBase64, environment);
  }

  async exchangeAndGetCertificate(
    code: string,
    environment: GovbrEnvironment,
    redirectUri: string,
  ): Promise<GetCertificateResponse> {
    const accessToken = await this.exchangeToken(code, environment, redirectUri);
    return this.getCertificate(accessToken, environment);
  }

  private handleApiError(error: unknown, operation: string): never {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;

      this.logger.error(
        `Gov.br API error during ${operation}: ${status} - ${JSON.stringify(data)}`,
      );

      if (status === 401) {
        throw new BadRequestException(
          'Código de autorização inválido ou expirado. Tente novamente.',
        );
      }
      if (status === 403) {
        throw new BadRequestException(
          'Acesso negado. Verifique as permissões da conta Gov.br.',
        );
      }
      if (status === 400) {
        throw new BadRequestException(
          `Erro na requisição: ${data?.error_description || data?.message || 'Parâmetros inválidos'}`,
        );
      }

      throw new BadRequestException(
        `Erro na comunicação com Gov.br (${operation}): ${status || 'sem resposta'}`,
      );
    }

    this.logger.error(`Unexpected error during ${operation}:`, error);
    throw new BadRequestException(
      `Erro inesperado durante ${operation}`,
    );
  }
}
