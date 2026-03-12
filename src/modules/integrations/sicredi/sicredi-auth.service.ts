import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import axios from 'axios';

@Injectable()
export class SicrediAuthService {
  private readonly logger = new Logger(SicrediAuthService.name);
  private readonly apiUrl: string;
  private readonly xApiKey: string;
  private readonly cooperativa: string;
  private readonly posto: string;
  private readonly codigoBeneficiario: string;
  private readonly codigoAcesso: string;

  private cachedToken: { accessToken: string; expiresAt: Date } | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {
    this.apiUrl = this.configService.get<string>('SICREDI_API_URL', 'https://api-parceiro.sicredi.com.br');
    this.xApiKey = this.configService.get<string>('SICREDI_X_API_KEY', '');
    this.cooperativa = this.configService.get<string>('SICREDI_COOPERATIVA', '');
    this.posto = this.configService.get<string>('SICREDI_POSTO', '');
    this.codigoBeneficiario = this.configService.get<string>('SICREDI_CODIGO_BENEFICIARIO', '');
    this.codigoAcesso = this.configService.get<string>('SICREDI_CODIGO_ACESSO', '');
  }

  get config() {
    return {
      apiUrl: this.apiUrl,
      xApiKey: this.xApiKey,
      cooperativa: this.cooperativa,
      posto: this.posto,
      codigoBeneficiario: this.codigoBeneficiario,
    };
  }

  async getAccessToken(): Promise<string> {
    // 1. Check in-memory cache
    if (this.cachedToken) {
      const timeUntilExpiry = this.cachedToken.expiresAt.getTime() - Date.now();
      if (timeUntilExpiry > 60 * 1000) {
        this.logger.debug(
          `Using cached Sicredi token (expires in ${Math.round(timeUntilExpiry / 1000)} seconds)`,
        );
        return this.cachedToken.accessToken;
      }
    }

    // 2. Check database for stored token
    const storedToken = await this.prismaService.sicrediToken.findUnique({
      where: { identifier: 'default' },
    });

    if (storedToken) {
      const now = new Date();
      const timeUntilExpiry = storedToken.expiresAt.getTime() - now.getTime();

      // If token expires in more than 1 minute, use it
      if (timeUntilExpiry > 60 * 1000) {
        this.logger.log(
          `Using stored Sicredi token (expires in ${Math.round(timeUntilExpiry / 1000)} seconds)`,
        );
        this.cachedToken = {
          accessToken: storedToken.accessToken,
          expiresAt: storedToken.expiresAt,
        };
        return storedToken.accessToken;
      }

      // If token is expiring soon but refresh token is available, try refresh
      if (timeUntilExpiry > 0 && storedToken.refreshToken) {
        const refreshTimeUntilExpiry = storedToken.refreshExpiresAt
          ? storedToken.refreshExpiresAt.getTime() - now.getTime()
          : 0;

        if (refreshTimeUntilExpiry > 30 * 1000) {
          this.logger.log('Sicredi token expiring soon, attempting refresh...');
          try {
            return await this.refreshToken(storedToken.refreshToken);
          } catch (refreshError) {
            this.logger.warn('Sicredi token refresh failed, will re-authenticate', refreshError);
          }
        }
      } else {
        this.logger.log('Stored Sicredi token has expired, will authenticate to get new token');
      }
    } else {
      this.logger.log('No stored Sicredi token found, will authenticate to get new token');
    }

    // 3. Authenticate to get a fresh token
    return await this.authenticate();
  }

  async authenticate(): Promise<string> {
    this.logger.log(`[SICREDI_AUTH] Authenticating with Sicredi API using OAuth2 password grant`);
    this.logger.log(`[SICREDI_AUTH] Config: apiUrl=${this.apiUrl}, cooperativa=${this.cooperativa}, posto=${this.posto}, codigoBeneficiario=${this.codigoBeneficiario}, xApiKey=${this.xApiKey ? this.xApiKey.slice(0, 8) + '...' : 'EMPTY'}, codigoAcesso=${this.codigoAcesso ? 'SET' : 'EMPTY'}`);

    // Username = codigoBeneficiario + cooperativa concatenated
    // Password = Código de Acesso (Master Key from Internet Banking)
    const username = `${this.codigoBeneficiario}${this.cooperativa}`;
    this.logger.log(`[SICREDI_AUTH] username=${username}, password=${this.codigoAcesso ? 'SET (' + this.codigoAcesso.length + ' chars)' : 'EMPTY'}`);

    const formData = new URLSearchParams();
    formData.append('grant_type', 'password');
    formData.append('username', username);
    formData.append('password', this.codigoAcesso);
    formData.append('scope', 'cobranca');

    let response;
    try {
      response = await axios.post(
        `${this.apiUrl}/auth/openapi/token`,
        formData.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-api-key': this.xApiKey,
            'context': 'COBRANCA',
          },
          timeout: 10000,
        },
      );
    } catch (error: any) {
      this.logger.error(
        `[SICREDI_AUTH] Authentication request failed: status=${error.response?.status}, ` +
        `body=${JSON.stringify(error.response?.data)}, message=${error.message}`,
      );
      throw error;
    }

    this.logger.log(`[SICREDI_AUTH] Auth response status: ${response.status}`);

    if (!response.data || !response.data.access_token) {
      this.logger.error(`[SICREDI_AUTH] Invalid auth response: ${JSON.stringify(response.data)}`);
      throw new Error('Invalid authentication response from Sicredi');
    }

    const {
      access_token,
      refresh_token,
      expires_in = 300,
      token_type = 'Bearer',
      refresh_expires_in = 900,
    } = response.data;

    this.logger.log(
      `[SICREDI_AUTH] Successfully authenticated (token=${access_token.slice(0, 20)}..., expires_in=${expires_in}s, refresh_expires_in=${refresh_expires_in}s, scope=${response.data.scope || 'N/A'})`,
    );

    return await this.storeToken({
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenType: token_type,
      expiresIn: expires_in,
      refreshExpiresIn: refresh_expires_in,
      scope: response.data.scope || null,
    });
  }

  async refreshToken(refreshTokenValue: string): Promise<string> {
    this.logger.log('Refreshing Sicredi token');

    const formData = new URLSearchParams();
    formData.append('grant_type', 'refresh_token');
    formData.append('refresh_token', refreshTokenValue);
    formData.append('scope', 'cobranca');

    const response = await axios.post(
      `${this.apiUrl}/auth/openapi/token`,
      formData.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-api-key': this.xApiKey,
          'context': 'COBRANCA',
        },
        timeout: 10000,
      },
    );

    if (!response.data || !response.data.access_token) {
      throw new Error('Invalid refresh response from Sicredi');
    }

    const {
      access_token,
      refresh_token,
      expires_in = 300,
      token_type = 'Bearer',
      refresh_expires_in = 900,
    } = response.data;

    this.logger.log('Successfully refreshed Sicredi token');

    return await this.storeToken({
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenType: token_type,
      expiresIn: expires_in,
      refreshExpiresIn: refresh_expires_in,
      scope: response.data.scope || null,
    });
  }

  private async storeToken(data: {
    accessToken: string;
    refreshToken?: string;
    tokenType: string;
    expiresIn: number;
    refreshExpiresIn?: number;
    scope?: string | null;
  }): Promise<string> {
    const expiresAt = new Date(Date.now() + data.expiresIn * 1000);
    const refreshExpiresAt = data.refreshExpiresIn
      ? new Date(Date.now() + data.refreshExpiresIn * 1000)
      : null;

    await this.prismaService.sicrediToken.upsert({
      where: { identifier: 'default' },
      update: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || null,
        tokenType: data.tokenType,
        expiresIn: data.expiresIn,
        expiresAt,
        refreshExpiresIn: data.refreshExpiresIn || null,
        refreshExpiresAt,
        scope: data.scope || null,
        updatedAt: new Date(),
      },
      create: {
        identifier: 'default',
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || null,
        tokenType: data.tokenType,
        expiresIn: data.expiresIn,
        expiresAt,
        refreshExpiresIn: data.refreshExpiresIn || null,
        refreshExpiresAt,
        scope: data.scope || null,
      },
    });

    // Update in-memory cache
    this.cachedToken = {
      accessToken: data.accessToken,
      expiresAt,
    };

    return data.accessToken;
  }
}
